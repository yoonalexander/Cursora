import { sanitizeExample, validateExample } from "./trainingExample.js";

/**
 * Local backups and a persistent outbox for automatic website collection.
 */
export class TrainingDataStore {
    async saveExample(_example) {
        throw new Error("TrainingDataStore.saveExample must be implemented by an adapter.");
    }

    async listExamples() {
        throw new Error("TrainingDataStore.listExamples must be implemented by an adapter.");
    }

    async count() {
        const examples = await this.listExamples();
        return examples.length;
    }
}

export class LocalTrainingDataStore extends TrainingDataStore {
    constructor({ storageKey = "cursora.trainingExamples.v1", debug = false, storage = globalThis.localStorage } = {}) {
        super();
        this.storageKey = storageKey;
        this.debug = debug;
        this.storage = storage;
    }

    async saveExample(example) {
        const examples = this.readExamples();
        const sanitized = sanitizeExample(example);
        examples.push(sanitized);
        this.storage.setItem(this.storageKey, JSON.stringify(examples));
        if (this.debug) console.info("Saved local training example:", sanitized);
        return sanitized;
    }

    async listExamples() {
        return this.readExamples();
    }

    readExamples() {
        try {
            const raw = this.storage.getItem(this.storageKey);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn("Could not read local training examples:", error);
            return [];
        }
    }

    async exportExamples() {
        const examples = await this.listExamples();
        const blob = new Blob([JSON.stringify({
            schema: "cursora.trainingExamples.v1",
            exportedAt: new Date().toISOString(),
            examples
        }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `cursora-training-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }
}

export class HttpTrainingDataStore extends LocalTrainingDataStore {
    constructor({ endpoint = "/api/training-examples", fetcher = globalThis.fetch?.bind(globalThis), onChange = () => {}, ...options } = {}) {
        super(options);
        this.endpoint = endpoint;
        this.fetcher = fetcher;
        this.onChange = onChange;
        try { this.enabled = this.storage.getItem("cursora.shareDrawings") !== "false"; }
        catch { this.enabled = true; }
        this.syncing = null;
        this.retryAt = 0;
        this.status = "idle";
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        try { this.storage.setItem("cursora.shareDrawings", String(enabled)); }
        catch { this.status = "waiting"; }
        if (enabled) void this.flush();
        this.onChange();
    }

    async saveExample(example) {
        if (!this.enabled) return null;
        const saved = await super.saveExample(validateExample(sanitizeExample(example)));
        this.onChange();
        void this.flush();
        return saved;
    }

    // A single worker avoids racing writes while new drawings enter the outbox.
    flush() {
        if (this.syncing) return this.syncing;
        if (!this.enabled || Date.now() < this.retryAt) return Promise.resolve();
        this.syncing = this.uploadPending().catch(error => {
            this.status = "waiting";
            this.retryAt = Math.max(this.retryAt, Date.now() + 30000);
            if (this.debug) console.info("Drawing upload queued for retry:", error.message);
        }).finally(() => {
            this.syncing = null;
            this.onChange();
        });
        return this.syncing;
    }

    async uploadPending() {
        this.status = "uploading";
        this.onChange();
        while (this.enabled) {
            const examples = this.readExamples();
            const example = examples.find(item => !item.uploadedAt && !item.uploadError);
            if (!example) { this.status = "synced"; return; }
            // Existing local references join the queue automatically, with stable IDs.
            if (!/^[0-9a-f-]{36}$/i.test(example.id || "")) example.id = globalThis.crypto.randomUUID();
            // Persist a migrated ID, but retain the original strokes in the backup.
            this.storage.setItem(this.storageKey, JSON.stringify(examples));
            let permanentError;
            let prepared;
            try { prepared = validateExample(sanitizeExample(example)); } catch (error) { permanentError = error.message; }
            if (!permanentError) {
                const body = JSON.stringify(prepared);
                const response = await this.fetcher(this.endpoint, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body,
                    keepalive: new TextEncoder().encode(body).length < 60000,
                    signal: AbortSignal.timeout(10000)
                });
                if ([400, 413, 422].includes(response.status)) permanentError = "This reference could not be uploaded.";
                else if (!response.ok) {
                    this.retryAt = Date.now() + Math.max(30, Math.min(300, Number(response.headers.get("retry-after")) || 30)) * 1000;
                    throw new Error("Collection is unavailable.");
                }
                else {
                    const result = await response.json();
                    if (result.saved !== true || result.id !== prepared.id) throw new Error("Collection did not confirm the drawing.");
                }
            }
            const latest = this.readExamples();
            this.storage.setItem(this.storageKey, JSON.stringify(latest.map(item => item.id !== example.id ? item : {
                ...item, ...(permanentError ? { uploadError: permanentError } : { uploadedAt: new Date().toISOString() })
            })));
            this.onChange();
        }
        this.status = "idle";
    }
}
