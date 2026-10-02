export async function fetchWebsiteTrainingExamples(website, { token = process.env.TRAINING_ADMIN_TOKEN, fetcher = fetch } = {}) {
    if (!token) throw new Error("Set TRAINING_ADMIN_TOKEN to read the website's approved drawings.");
    const site = new URL(website);
    if (site.protocol !== "https:" && !(site.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname))) throw new Error("Use HTTPS for a hosted website.");
    if (site.username || site.password) throw new Error("Do not include credentials in the website URL.");
    const endpoint = new URL("/api/training-examples", site);
    endpoint.searchParams.set("status", "approved");
    endpoint.searchParams.set("limit", "100");
    const examples = [];
    const visited = new Set();
    while (true) {
        const response = await fetcher(endpoint, {
            headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error(`Website collection returned HTTP ${response.status}. Check its configuration and owner token.`);
        const page = await response.json();
        if (!Array.isArray(page.examples) || page.examples.some(example => example.reviewStatus !== "approved")) throw new Error("Website returned an invalid approved-data page.");
        examples.push(...page.examples);
        if (!page.nextCursor) break;
        if (typeof page.nextCursor !== "string" || !/^[0-9a-f-]{36}$/i.test(page.nextCursor) || visited.has(page.nextCursor)) throw new Error("Website returned an invalid pagination cursor.");
        visited.add(page.nextCursor);
        endpoint.searchParams.set("cursor", page.nextCursor);
    }
    return examples;
}
