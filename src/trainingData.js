/**
 * Static-site friendly training data capture.
 *
 * The game can save missed drawings locally today, then this adapter can later
 * be swapped for an HTTP/API-backed collector without changing mission logic.
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
    constructor({ storageKey = "cursora.trainingExamples.v1", debug = false } = {}) {
        super();
        this.storageKey = storageKey;
        this.debug = debug;
    }

    async saveExample(example) {
        const examples = await this.listExamples();
        const sanitized = sanitizeExample(example);
        examples.push(sanitized);
        window.localStorage.setItem(this.storageKey, JSON.stringify(examples));
        if (this.debug) console.info("Saved local training example:", sanitized);
        return sanitized;
    }

    async listExamples() {
        try {
            const raw = window.localStorage.getItem(this.storageKey);
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

function sanitizeExample(example) {
    return {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: String(example.label || "unknown").toLowerCase(),
        outcome: example.outcome === "recognized" ? "recognized" : "missed",
        durationMs: Math.round(Number(example.durationMs) || 0),
        canvas: {
            width: Math.round(Number(example.canvas?.width) || 0),
            height: Math.round(Number(example.canvas?.height) || 0)
        },
        predictions: Array.isArray(example.predictions)
            ? example.predictions.slice(0, 5).map(prediction => ({
                label: String(prediction.label),
                confidence: Number(prediction.confidence) || 0
            }))
            : [],
        strokes: Array.isArray(example.strokes)
            ? example.strokes.map(stroke => stroke.map(point => ({
                x: Math.round(Number(point.x) || 0),
                y: Math.round(Number(point.y) || 0),
                t: Math.round(Number(point.t) || 0)
            })))
            : [],
        createdAt: new Date().toISOString()
    };
}

/**
 * Future backend seam:
 * class HttpTrainingDataStore extends TrainingDataStore {
 *   constructor(endpoint) { super(); this.endpoint = endpoint; }
 *   async saveExample(example) {
 *     await fetch(this.endpoint, {
 *       method: "POST",
 *       headers: { "content-type": "application/json" },
 *       body: JSON.stringify(sanitizeExample(example))
 *     });
 *   }
 * }
 */
