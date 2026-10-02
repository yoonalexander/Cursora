import assert from "node:assert/strict";
import test from "node:test";
import { SketchPad } from "../src/sketch.js";
import { INK_COLORS, inkIndexFromKey } from "../src/ink.js";
import { HeuristicSketchRecognizer, normalizeStrokes } from "../src/recognizer.js";
import { preprocessNormalizedStrokes } from "../src/sketchPreprocessing.js";

function createPad() {
    const rendered = [];
    let path = [];
    const context = {
        clearRect() { rendered.length = 0; },
        setTransform() {},
        beginPath() { path = []; },
        moveTo(...values) { path.push(["move", ...values]); },
        quadraticCurveTo(...values) { path.push(["curve", ...values]); },
        lineTo(...values) { path.push(["line", ...values]); },
        stroke() { rendered.push({ color: this.strokeStyle, path: [...path] }); }
    };
    const pad = new SketchPad({ width: 100, height: 100, style: {}, getContext: () => context });
    return { pad, rendered };
}

function draw(pad, changeColors = false) {
    pad.begin({ x: 20, y: 80, t: 0 });
    const points = [[20, 35], [50, 10], [80, 35], [80, 80], [20, 80]];
    points.forEach(([x, y], index) => {
        if (changeColors) pad.setColor(INK_COLORS[index].value);
        pad.add({ x, y, t: (index + 1) * 16 });
    });
    pad.end();
}

test("switching ink mid-stroke preserves geometry, monochrome AI input and predictions", async () => {
    const plain = createPad();
    const colorful = createPad();
    draw(plain.pad);
    draw(colorful.pad, true);
    assert.deepEqual(colorful.pad.strokes, plain.pad.strokes);
    assert.equal(colorful.pad.strokes.length, 1);
    assert.equal(colorful.pad.pointCount, plain.pad.pointCount);
    assert.deepEqual(
        colorful.rendered.flatMap(segment => segment.path.filter(command => command[0] !== "move")),
        plain.rendered.flatMap(segment => segment.path.filter(command => command[0] !== "move"))
    );
    assert.deepEqual(colorful.rendered.map(segment => segment.color), INK_COLORS.slice(0, 5).map(ink => ink.value));
    for (const point of colorful.pad.strokes.flat()) assert.deepEqual(Object.keys(point), ["x", "y", "t"]);
    const monochrome = pad => preprocessNormalizedStrokes(normalizeStrokes(pad.strokes, 100, 100));
    assert.deepEqual(monochrome(colorful.pad), monochrome(plain.pad));
    const recognizer = new HeuristicSketchRecognizer();
    assert.deepEqual(await recognizer.predict(colorful.pad.strokes, 100, 100), await recognizer.predict(plain.pad.strokes, 100, 100));
});

test("old ink survives new selections and resize; clear keeps the selected pencil", () => {
    const { pad, rendered } = createPad();
    pad.setColor(INK_COLORS[1].value);
    draw(pad);
    pad.setColor(INK_COLORS[3].value);
    pad.begin({ x: 10, y: 10, t: 100 });
    pad.add({ x: 40, y: 30, t: 116 });
    pad.end();
    assert.deepEqual(rendered.map(segment => segment.color), [INK_COLORS[1].value, INK_COLORS[3].value]);
    const previousWindow = globalThis.window;
    globalThis.window = { devicePixelRatio: 2 };
    try { pad.resize(150, 120); } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
    assert.deepEqual(rendered.map(segment => segment.color), [INK_COLORS[1].value, INK_COLORS[3].value]);
    pad.clear();
    assert.equal(rendered.length, 0);
    assert.equal(pad.pointCount, 0);
    draw(pad);
    assert.deepEqual(rendered.map(segment => segment.color), [INK_COLORS[3].value]);
});

test("a dot keeps its original ink if the pencil changes before release", () => {
    const { pad, rendered } = createPad();
    pad.begin({ x: 15, y: 25, t: 0 });
    pad.setColor(INK_COLORS[2].value);
    pad.end();
    assert.equal(rendered[0].color, INK_COLORS[0].value);
    assert.equal(pad.pointCount, 2);
});

test("ink shortcuts pick and cycle colors without interfering with editing or browser shortcuts", () => {
    for (let index = 0; index < INK_COLORS.length; index++) {
        assert.equal(inkIndexFromKey({ key: String(index + 1) }, 0), index);
    }
    assert.equal(inkIndexFromKey({ key: "c" }, 5), 0);
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing"]) {
        assert.equal(inkIndexFromKey({ key: "2", [modifier]: true }, 0), null);
    }
    assert.equal(inkIndexFromKey({ key: "2", target: { closest: () => ({}) } }, 0), null);
    assert.equal(inkIndexFromKey({ key: "7" }, 0), null);
    assert.equal(inkIndexFromKey({ key: "Enter" }, 0), null);
});
