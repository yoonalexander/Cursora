import { SKETCH_CATEGORIES } from "./sketchCategories.js";

export const MAX_POINTS = 2000;
export const MAX_STROKES = 128;
export const MAX_BODY_BYTES = 256 * 1024;

// Preserve stroke boundaries and endpoints while bounding upload/storage size.
export function sanitizeExample(example) {
    const source = (example.strokes || []).filter(stroke => Array.isArray(stroke) && stroke.length).slice(0, MAX_STROKES);
    const count = source.reduce((sum, stroke) => sum + stroke.length, 0);
    const remaining = MAX_POINTS - source.length * 2;
    const strokes = source.map(stroke => {
        const budget = count <= MAX_POINTS ? stroke.length : Math.min(stroke.length, 2 + Math.floor(remaining * stroke.length / count));
        return Array.from({ length: budget }, (_, index) => {
            const point = stroke[Math.round(index * (stroke.length - 1) / Math.max(1, budget - 1))];
            return { x: Math.round(point.x), y: Math.round(point.y), t: Math.round(point.t || 0) };
        });
    });
    return {
        id: example.id || globalThis.crypto.randomUUID(),
        label: String(example.label || "").toLowerCase(),
        outcome: example.outcome === "recognized" ? "recognized" : "missed",
        durationMs: Math.round(Number(example.durationMs) || 0),
        canvas: { width: Math.round(example.canvas?.width || 0), height: Math.round(example.canvas?.height || 0) },
        predictions: (example.predictions || []).slice(0, 5).map(({ label, confidence }) => ({ label, confidence })),
        strokes,
        createdAt: example.createdAt || new Date().toISOString()
    };
}

export function validateExample(example) {
    if (!example || typeof example !== "object" || Array.isArray(example)) throw new Error("Expected a drawing example.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(example.id)) throw new Error("Invalid example ID.");
    if (!SKETCH_CATEGORIES.includes(example.label)) throw new Error("Unknown drawing label.");
    if (!["missed", "recognized"].includes(example.outcome)) throw new Error("Invalid drawing outcome.");
    if (!Number.isFinite(example.durationMs) || example.durationMs < 0 || example.durationMs > 3600000) throw new Error("Invalid drawing duration.");
    const { width, height } = example.canvas || {};
    if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 20000)) throw new Error("Invalid canvas size.");
    if (!Array.isArray(example.strokes) || !example.strokes.length || example.strokes.length > MAX_STROKES) throw new Error("Invalid strokes.");
    let count = 0;
    for (const stroke of example.strokes) {
        if (!Array.isArray(stroke) || !stroke.length) throw new Error("Invalid stroke.");
        count += stroke.length;
        if (count > MAX_POINTS) throw new Error("Too many drawing points.");
        for (const point of stroke) {
            if (!point || ![point.x, point.y, point.t].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x > width || point.y > height || point.t < 0) throw new Error("Invalid drawing point.");
        }
    }
    if (count < 8) throw new Error("Drawing needs at least eight points.");
    if (!Array.isArray(example.predictions) || example.predictions.length > 5 || example.predictions.some(p => !p || !SKETCH_CATEGORIES.includes(p.label) || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1)) throw new Error("Invalid predictions.");
    if (!Number.isFinite(Date.parse(example.createdAt))) throw new Error("Invalid creation date.");
    // Whitelist fields: clients cannot set review status or database metadata.
    return sanitizeExample(example);
}
