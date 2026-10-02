import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export class CollectionUnavailable extends Error {}
export class CollectionRateLimit extends Error {}

export class SupabaseTrainingRepository {
    constructor({ url, key, fetcher = fetch } = {}) {
        this.url = `${url.replace(/\/$/, "")}/rest/v1/`;
        this.key = key;
        this.fetcher = fetcher;
    }

    async request(resource, options = {}) {
        const response = await this.fetcher(this.url + resource, {
            ...options,
            headers: {
                apikey: this.key,
                ...(this.key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${this.key}` }),
                "Content-Type": "application/json", ...options.headers
            },
            signal: AbortSignal.timeout(10000)
        });
        if (response.status === 429) throw new CollectionRateLimit();
        if (!response.ok) throw new CollectionUnavailable("Database request failed.");
        const body = await response.text();
        return body ? JSON.parse(body) : null;
    }

    async insert(example, collector) {
        const result = await this.request("rpc/cursora_collect_example", {
            method: "POST", body: JSON.stringify({ drawing: example, collector })
        });
        if (result === "rate_limited") throw new CollectionRateLimit();
    }

    async list({ status, cursor, limit }) {
        const params = new URLSearchParams({ select: "id,label,review_status,example,created_at", order: "id.asc", limit: String(limit + 1), review_status: `eq.${status}` });
        if (cursor) params.set("id", `gt.${cursor}`);
        const rows = await this.request(`cursora_training_examples?${params}`);
        return page(rows.map(row => ({ ...row.example, id: row.id, label: row.label, reviewStatus: row.review_status, receivedAt: row.created_at })), limit);
    }

    async review(id, { status, label }) {
        const rows = await this.request(`cursora_training_examples?id=eq.${id}&select=id`, {
            method: "PATCH", headers: { Prefer: "return=representation" },
            body: JSON.stringify({ review_status: status, ...(label ? { label } : {}) })
        });
        return rows.length > 0;
    }
}

// Local development only. Never use the serverless filesystem as live storage.
export class FileTrainingRepository {
    constructor(directory) { this.directory = directory; this.rates = new Map(); }

    async insert(example, collector) {
        const bucket = Math.floor(Date.now() / 60000);
        const previous = this.rates.get(collector);
        const count = previous?.bucket === bucket ? previous.count + 1 : 1;
        if (count > 30) throw new CollectionRateLimit();
        this.rates.set(collector, { bucket, count });
        await mkdir(this.directory, { recursive: true });
        try {
            await writeFile(path.join(this.directory, `${example.id}.json`), JSON.stringify({ ...example, reviewStatus: "pending", receivedAt: new Date().toISOString() }), { flag: "wx" });
        } catch (error) { if (error.code !== "EEXIST") throw error; }
    }

    async list({ status, cursor, limit }) {
        let names;
        try { names = await readdir(this.directory); } catch (error) { if (error.code === "ENOENT") return page([], limit); throw error; }
        const rows = [];
        for (const name of names.filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).sort()) {
            if (cursor && name.slice(0, -5) <= cursor) continue;
            const example = JSON.parse(await readFile(path.join(this.directory, name), "utf8"));
            if (example.reviewStatus === status) rows.push(example);
            if (rows.length > limit) break;
        }
        return page(rows, limit);
    }

    async review(id, { status, label }) {
        const filename = path.join(this.directory, `${id}.json`);
        let example;
        try { example = JSON.parse(await readFile(filename, "utf8")); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
        await writeFile(filename, JSON.stringify({ ...example, reviewStatus: status, ...(label ? { label } : {}) }));
        return true;
    }
}

function page(rows, limit) {
    const examples = rows.slice(0, limit);
    return { examples, nextCursor: rows.length > limit ? examples.at(-1).id : null };
}

export function createTrainingRepository(env = process.env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new CollectionUnavailable("Collection is not configured.");
    return new SupabaseTrainingRepository({ url: env.SUPABASE_URL, key: env.SUPABASE_SECRET_KEY });
}
