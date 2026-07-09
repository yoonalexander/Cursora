import { SKETCH_CATEGORIES, normalizeStrokes } from "../src/recognizer.js";
import { DEFAULT_IMAGE_SIZE, preprocessNormalizedStrokes } from "../src/sketchPreprocessing.js";

export function unwrapTrainingExport(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.examples)) return raw.examples;
    throw new Error("Expected a Cursora training export array or { examples } object.");
}

export function validateTrainingExample(example, index = 0) {
    const errors = [];
    const label = String(example?.label || "").toLowerCase();
    if (!SKETCH_CATEGORIES.includes(label)) errors.push(`label "${label || "missing"}" is not in SKETCH_CATEGORIES`);
    if (!Array.isArray(example?.strokes) || !example.strokes.length) errors.push("strokes are missing");
    const width = Number(example?.canvas?.width);
    const height = Number(example?.canvas?.height);
    if (!Number.isFinite(width) || width <= 0) errors.push("canvas.width must be positive");
    if (!Number.isFinite(height) || height <= 0) errors.push("canvas.height must be positive");
    return {
        ok: errors.length === 0,
        index,
        label,
        errors
    };
}

export function exampleToModelInput(example, { size = DEFAULT_IMAGE_SIZE } = {}) {
    const validation = validateTrainingExample(example);
    if (!validation.ok) {
        throw new Error(`Invalid training example: ${validation.errors.join("; ")}`);
    }
    const normalized = normalizeStrokes(
        example.strokes,
        Number(example.canvas.width),
        Number(example.canvas.height)
    );
    return preprocessNormalizedStrokes(normalized, { size });
}

export function prepareTrainingExamples(examples, { size = DEFAULT_IMAGE_SIZE } = {}) {
    const prepared = [];
    const skipped = [];

    examples.forEach((example, index) => {
        const validation = validateTrainingExample(example, index);
        if (!validation.ok) {
            skipped.push(validation);
            return;
        }
        const { input } = exampleToModelInput(example, { size });
        prepared.push({
            label: validation.label,
            labelIndex: SKETCH_CATEGORIES.indexOf(validation.label),
            input
        });
    });

    return { prepared, skipped };
}
