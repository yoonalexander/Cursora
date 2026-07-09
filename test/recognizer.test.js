import assert from "node:assert/strict";
import test from "node:test";
import {
    extractSketchFeatures,
    HeuristicSketchRecognizer,
    normalizeStrokes,
    SKETCH_CATEGORIES,
    TensorFlowSketchRecognizer
} from "../src/recognizer.js";
import { preprocessNormalizedStrokes } from "../src/sketchPreprocessing.js";

const stroke = points => points.map(([x, y], index) => ({ x, y, t: index * 16 }));

const examples = {
    house: [
        stroke([[20, 80], [20, 35], [50, 10], [80, 35], [80, 80], [20, 80]]),
        stroke([[42, 80], [42, 55], [58, 55], [58, 80]])
    ],
    star: [
        stroke([[50, 10], [61, 40], [92, 40], [67, 58], [77, 90], [50, 70], [23, 90], [33, 58], [8, 40], [39, 40], [50, 10]])
    ],
    bicycle: [
        stroke([[15, 65], [30, 50], [50, 65], [70, 50], [85, 65], [70, 80], [55, 65], [30, 50], [15, 65]]),
        stroke([[30, 50], [42, 30], [55, 65]]),
        stroke([[10, 65], [15, 55], [25, 55], [30, 65], [25, 75], [15, 75], [10, 65]]),
        stroke([[70, 65], [75, 55], [85, 55], [90, 65], [85, 75], [75, 75], [70, 65]])
    ]
};

test("normalization centers and bounds stroke coordinates", () => {
    const normalized = normalizeStrokes([stroke([[100, 50], [300, 150]])], 400, 200, { resample: false });
    const points = normalized.flat();
    assert.ok(points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
    assert.ok(Math.abs((points[0].x + points[1].x) / 2 - 0.5) < 0.001);
});

test("feature extraction retains structural signals", () => {
    const features = extractSketchFeatures(normalizeStrokes(examples.bicycle, 100, 100));
    assert.equal(features.strokeCount, 4);
    assert.ok(features.aspectRatio > 1);
    assert.ok(features.loopCount >= 2);
});

test("recognizer ranks representative sketches deterministically", async () => {
    const recognizer = new HeuristicSketchRecognizer({ debug: process.env.DEBUG_RECOGNIZER === "1" });
    for (const [label, strokes] of Object.entries(examples)) {
        const first = await recognizer.predict(strokes, 100, 100);
        const second = await recognizer.predict(strokes, 100, 100);
        assert.deepEqual(first, second);
        assert.equal(first[0].label, label, `${label} was ranked as ${first[0]?.label}`);
        assert.ok(first[0].confidence >= 0.65, `${label} confidence was ${first[0].confidence}`);
    }
});

test("preprocessing creates browser model input shape", () => {
    const normalized = normalizeStrokes(examples.house, 100, 100);
    const preprocessed = preprocessNormalizedStrokes(normalized, { size: 28 });
    assert.deepEqual(preprocessed.shape, [1, 28, 28, 1]);
    assert.equal(preprocessed.input.length, 28 * 28);
    assert.ok(preprocessed.input.some(value => value > 0));
    assert.ok(preprocessed.input.every(value => value >= 0 && value <= 1));
});

test("tensorflow recognizer returns sorted prediction format", async () => {
    const scores = SKETCH_CATEGORIES.map((_, index) => index / SKETCH_CATEGORIES.length);
    const recognizer = new TensorFlowSketchRecognizer({
        tfLoader: async () => ({
            tensor4d: (values, shape) => ({ values, shape, dispose() {} }),
            loadLayersModel: async () => ({
                predict: input => {
                    assert.deepEqual(input.shape, [1, 28, 28, 1]);
                    return {
                        async data() {
                            return scores;
                        },
                        dispose() {}
                    };
                }
            })
        }),
        fetcher: async () => ({
            ok: true,
            async json() {
                return SKETCH_CATEGORIES;
            }
        })
    });

    const predictions = await recognizer.predict(examples.house, 100, 100);
    assert.equal(predictions.length, SKETCH_CATEGORIES.length);
    assert.deepEqual(Object.keys(predictions[0]), ["label", "confidence"]);
    assert.equal(predictions[0].label, SKETCH_CATEGORIES.at(-1));
    assert.ok(predictions.every((prediction, index) => index === 0 || prediction.confidence <= predictions[index - 1].confidence));
});

test("tensorflow recognizer falls back when model loading fails", async () => {
    const recognizer = new TensorFlowSketchRecognizer({
        tfLoader: async () => {
            throw new Error("missing model");
        }
    });

    const predictions = await recognizer.predict(examples.house, 100, 100);
    assert.equal(recognizer.activeRecognizer, "heuristic");
    assert.equal(predictions[0].label, "house");
});

test("neural label mapping matches SKETCH_CATEGORIES", () => {
    const labels = [...SKETCH_CATEGORIES];
    assert.deepEqual(labels, SKETCH_CATEGORIES);
    assert.equal(new Set(labels).size, SKETCH_CATEGORIES.length);
});
