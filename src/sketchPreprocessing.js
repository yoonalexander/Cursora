export const DEFAULT_IMAGE_SIZE = 28;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function drawSoftPoint(pixels, size, x, y, radius) {
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(size - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(size - 1, Math.ceil(y + radius));

    for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
            const distance = Math.hypot(px - x, py - y);
            if (distance > radius) continue;
            const value = clamp(1 - distance / Math.max(radius, 0.001));
            const index = py * size + px;
            pixels[index] = Math.max(pixels[index], value);
        }
    }
}

function drawSegment(pixels, size, start, end, lineWidth) {
    const x0 = start.x * (size - 1);
    const y0 = start.y * (size - 1);
    const x1 = end.x * (size - 1);
    const y1 = end.y * (size - 1);
    const distance = Math.max(Math.hypot(x1 - x0, y1 - y0), 1);
    const steps = Math.ceil(distance * 2);
    const radius = Math.max(0.75, lineWidth / 2);

    for (let step = 0; step <= steps; step += 1) {
        const ratio = step / steps;
        drawSoftPoint(
            pixels,
            size,
            x0 + (x1 - x0) * ratio,
            y0 + (y1 - y0) * ratio,
            radius
        );
    }
}

export function rasterizeNormalizedStrokes(normalizedStrokes, { size = DEFAULT_IMAGE_SIZE, lineWidth = 2 } = {}) {
    const pixels = new Float32Array(size * size);
    for (const stroke of normalizedStrokes) {
        if (!Array.isArray(stroke) || !stroke.length) continue;
        if (stroke.length === 1) {
            drawSoftPoint(pixels, size, stroke[0].x * (size - 1), stroke[0].y * (size - 1), lineWidth / 2);
            continue;
        }
        for (let index = 1; index < stroke.length; index += 1) {
            drawSegment(pixels, size, stroke[index - 1], stroke[index], lineWidth);
        }
    }
    return pixels;
}

export function imagePixelsToModelInput(pixels, { size = DEFAULT_IMAGE_SIZE } = {}) {
    if (!(pixels instanceof Float32Array) || pixels.length !== size * size) {
        throw new Error(`Expected ${size}x${size} Float32Array pixels.`);
    }
    return Array.from(pixels, value => clamp(value));
}

export function createInputTensor(tf, pixels, { size = DEFAULT_IMAGE_SIZE } = {}) {
    if (!tf?.tensor4d) throw new Error("TensorFlow.js instance with tensor4d is required.");
    return tf.tensor4d(imagePixelsToModelInput(pixels, { size }), [1, size, size, 1]);
}

export function preprocessNormalizedStrokes(normalizedStrokes, options = {}) {
    const size = options.size || DEFAULT_IMAGE_SIZE;
    const pixels = rasterizeNormalizedStrokes(normalizedStrokes, { ...options, size });
    return {
        size,
        pixels,
        input: imagePixelsToModelInput(pixels, { size }),
        shape: [1, size, size, 1]
    };
}

export function rasterizeStrokesToCanvas(normalizedStrokes, { size = DEFAULT_IMAGE_SIZE, lineWidth = 2 } = {}) {
    const CanvasClass = globalThis.OffscreenCanvas;
    const canvas = CanvasClass
        ? new CanvasClass(size, size)
        : globalThis.document?.createElement?.("canvas");
    if (!canvas) return null;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, size, size);
    context.strokeStyle = "white";
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";

    for (const stroke of normalizedStrokes) {
        if (!Array.isArray(stroke) || !stroke.length) continue;
        context.beginPath();
        context.moveTo(stroke[0].x * (size - 1), stroke[0].y * (size - 1));
        for (let index = 1; index < stroke.length; index += 1) {
            context.lineTo(stroke[index].x * (size - 1), stroke[index].y * (size - 1));
        }
        context.stroke();
    }
    return canvas;
}
