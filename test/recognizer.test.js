import assert from "node:assert/strict";
import test from "node:test";
import {
    extractSketchFeatures,
    HeuristicSketchRecognizer,
    normalizeStrokes
} from "../src/recognizer.js";

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
