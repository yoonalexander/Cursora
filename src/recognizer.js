export const SKETCH_CATEGORIES = [
    "cat", "dog", "house", "tree", "car", "bicycle",
    "rocket", "fish", "robot", "hamburger", "star", "umbrella"
];

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const near = (value, target, spread) => clamp(1 - Math.abs(value - target) / spread);
const high = (value, start, end) => clamp((value - start) / (end - start));
const low = (value, start, end) => 1 - high(value, start, end);

function resampleStroke(stroke, spacing = 0.025) {
    if (stroke.length < 2) return stroke.map(point => ({ ...point }));
    const result = [{ ...stroke[0] }];
    let carried = 0;
    let previous = { ...stroke[0] };

    for (let index = 1; index < stroke.length; index += 1) {
        const target = stroke[index];
        let distance = Math.hypot(target.x - previous.x, target.y - previous.y);
        if (!distance) continue;

        while (carried + distance >= spacing) {
            const ratio = (spacing - carried) / distance;
            previous = {
                x: previous.x + (target.x - previous.x) * ratio,
                y: previous.y + (target.y - previous.y) * ratio,
                t: previous.t + (target.t - previous.t) * ratio
            };
            result.push({ ...previous });
            distance = Math.hypot(target.x - previous.x, target.y - previous.y);
            carried = 0;
        }
        carried += distance;
        previous = { ...target };
    }
    const finalPoint = stroke[stroke.length - 1];
    const last = result[result.length - 1];
    if (Math.hypot(finalPoint.x - last.x, finalPoint.y - last.y) > spacing * 0.35) {
        result.push({ ...finalPoint });
    }
    return result;
}

/**
 * Fits the drawing into a centered 0..1 coordinate space while preserving
 * stroke boundaries, point order, and timestamps.
 */
export function normalizeStrokes(strokes, canvasWidth, canvasHeight, options = {}) {
    const valid = strokes
        .filter(stroke => Array.isArray(stroke) && stroke.length)
        .map(stroke => stroke.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    const points = valid.flat();
    if (!points.length) return [];

    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const sourceWidth = Math.max(maxX - minX, canvasWidth * 0.01, 1);
    const sourceHeight = Math.max(maxY - minY, canvasHeight * 0.01, 1);
    const scale = 0.86 / Math.max(sourceWidth, sourceHeight);
    const drawingWidth = sourceWidth * scale;
    const drawingHeight = sourceHeight * scale;
    const offsetX = (1 - drawingWidth) / 2;
    const offsetY = (1 - drawingHeight) / 2;

    const normalized = valid.map(stroke => stroke.map(point => ({
        x: offsetX + (point.x - minX) * scale,
        y: offsetY + (point.y - minY) * scale,
        t: point.t
    })));
    return options.resample === false
        ? normalized
        : normalized.map(stroke => resampleStroke(stroke, options.spacing || 0.025));
}

function strokeMetrics(stroke) {
    let length = 0;
    let horizontal = 0;
    let vertical = 0;
    let diagonal = 0;
    let corners = 0;
    let signedArea = 0;

    for (let index = 1; index < stroke.length; index += 1) {
        const previous = stroke[index - 1];
        const point = stroke[index];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const segmentLength = Math.hypot(dx, dy);
        length += segmentLength;
        const angle = Math.abs(Math.atan2(dy, dx));
        const horizontalDistance = Math.min(angle, Math.abs(Math.PI - angle));
        const verticalDistance = Math.abs(Math.PI / 2 - angle);
        if (horizontalDistance < Math.PI / 9) horizontal += segmentLength;
        else if (verticalDistance < Math.PI / 9) vertical += segmentLength;
        else diagonal += segmentLength;
        signedArea += previous.x * point.y - point.x * previous.y;
    }

    for (let index = 2; index < stroke.length; index += 1) {
        const a = stroke[index - 2];
        const b = stroke[index - 1];
        const c = stroke[index];
        const angleA = Math.atan2(b.y - a.y, b.x - a.x);
        const angleB = Math.atan2(c.y - b.y, c.x - b.x);
        const turn = Math.abs(Math.atan2(Math.sin(angleB - angleA), Math.cos(angleB - angleA)));
        if (turn > 0.72) corners += 1;
    }

    const start = stroke[0];
    const end = stroke[stroke.length - 1];
    const closure = length ? clamp(1 - Math.hypot(end.x - start.x, end.y - start.y) / Math.min(length * 0.3, 0.3)) : 0;
    const area = Math.abs(signedArea) / 2;
    const circularity = length ? clamp((4 * Math.PI * area) / (length * length)) : 0;
    return { length, horizontal, vertical, diagonal, corners, closure, circularity };
}

function occupancyFeatures(strokes) {
    const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
    for (const point of strokes.flat()) {
        const x = Math.min(3, Math.max(0, Math.floor(point.x * 4)));
        const y = Math.min(3, Math.max(0, Math.floor(point.y * 4)));
        grid[y][x] += 1;
    }
    const maximum = Math.max(1, ...grid.flat());
    const cells = grid.map(row => row.map(value => value / maximum));
    let verticalDifference = 0;
    let horizontalDifference = 0;
    for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 2; x += 1) {
            verticalDifference += Math.abs(cells[y][x] - cells[y][3 - x]);
            horizontalDifference += Math.abs(cells[x][y] - cells[3 - x][y]);
        }
    }
    const sumRegion = (x0, x1, y0, y1) => {
        let value = 0;
        for (let y = y0; y < y1; y += 1) {
            for (let x = x0; x < x1; x += 1) value += cells[y][x];
        }
        return value;
    };
    return {
        grid: cells.flat(),
        verticalSymmetry: clamp(1 - verticalDifference / 8),
        horizontalSymmetry: clamp(1 - horizontalDifference / 8),
        upperDensity: sumRegion(0, 4, 0, 2) / 8,
        lowerDensity: sumRegion(0, 4, 2, 4) / 8,
        centerDensity: sumRegion(1, 3, 1, 3) / 4
    };
}

export function extractSketchFeatures(normalizedStrokes) {
    const points = normalizedStrokes.flat();
    if (!points.length) return null;
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const width = Math.max(0.001, maxX - minX);
    const height = Math.max(0.001, maxY - minY);
    const metrics = normalizedStrokes.map(strokeMetrics);
    const totalLength = Math.max(0.001, metrics.reduce((sum, metric) => sum + metric.length, 0));
    const loopCount = metrics.filter(metric => metric.closure > 0.62).length;
    const circularLoops = metrics.filter(metric => metric.closure > 0.55 && metric.circularity > 0.22).length;
    const occupancy = occupancyFeatures(normalizedStrokes);

    return {
        strokeCount: normalizedStrokes.length,
        pointCount: points.length,
        aspectRatio: width / height,
        totalLength,
        cornerCount: metrics.reduce((sum, metric) => sum + metric.corners, 0),
        cornerDensity: metrics.reduce((sum, metric) => sum + metric.corners, 0) / totalLength,
        loopCount,
        circularLoops,
        loopRatio: loopCount / normalizedStrokes.length,
        circularity: metrics.reduce((sum, metric) => sum + metric.circularity, 0) / metrics.length,
        horizontalRatio: metrics.reduce((sum, metric) => sum + metric.horizontal, 0) / totalLength,
        verticalRatio: metrics.reduce((sum, metric) => sum + metric.vertical, 0) / totalLength,
        diagonalRatio: metrics.reduce((sum, metric) => sum + metric.diagonal, 0) / totalLength,
        endpointCount: normalizedStrokes.length * 2,
        ...occupancy
    };
}

export class SketchRecognizer {
    async predict(_strokes, _canvasWidth, _canvasHeight) {
        throw new Error("SketchRecognizer.predict must be implemented by an adapter.");
    }
}

/**
 * Deterministic feature classifier. It is intentionally lightweight, but uses
 * geometry rather than random answers. Replace this class with a model adapter
 * without changing game code.
 */
export class HeuristicSketchRecognizer extends SketchRecognizer {
    constructor({ debug = false } = {}) {
        super();
        this.debug = debug;
    }

    async predict(strokes, canvasWidth, canvasHeight) {
        const normalizedStrokes = normalizeStrokes(strokes, canvasWidth, canvasHeight);
        const f = extractSketchFeatures(normalizedStrokes);
        if (!f || f.pointCount < 8 || f.totalLength < 0.22) return [];

        const strokesMany = high(f.strokeCount, 3, 8);
        const wide = high(f.aspectRatio, 1.15, 2.2);
        const tall = low(f.aspectRatio, 0.45, 1.05);
        const angular = high(f.cornerDensity, 2.2, 8);
        const round = clamp(f.circularity * 2.2 + f.circularLoops * 0.2);
        const loops = clamp(f.loopCount / 3);
        const details = high(f.totalLength, 1.6, 5.5);
        const scores = {
            cat: 0.35 + 1.1 * near(f.aspectRatio, 1.0, 0.8) + 0.9 * f.verticalSymmetry + 1.15 * angular + 0.45 * f.horizontalRatio + 0.45 * strokesMany + 0.3 * round,
            dog: 0.35 + 1.0 * near(f.aspectRatio, 1.1, 0.9) + 0.6 * f.verticalSymmetry + 0.75 * round + 0.85 * strokesMany + 0.7 * details + 0.3 * angular,
            house: 0.2 + 1.25 * near(f.aspectRatio, 1.0, 0.65) + 1.3 * angular + 1.05 * f.verticalRatio + 1.05 * f.horizontalRatio + 0.8 * loops + 0.4 * f.verticalSymmetry + 1.35 * near(f.strokeCount, 2, 1.1) + 0.75 * near(f.loopCount, 1, 1.5),
            tree: 0.25 + 1.5 * tall + 1.05 * f.verticalRatio + 0.9 * high(f.upperDensity - f.lowerDensity, -0.08, 0.25) + 0.65 * details + 0.35 * strokesMany,
            car: 0.25 + 1.55 * wide + 0.9 * f.horizontalRatio + 1.0 * round + 0.95 * high(f.circularLoops, 0, 2) + 0.55 * details + 0.35 * f.horizontalSymmetry,
            bicycle: 0.15 + 1.55 * wide + 1.65 * high(f.circularLoops, 0, 2) + 0.85 * f.diagonalRatio + 0.7 * strokesMany + 0.45 * f.horizontalSymmetry + 1.35 * near(f.circularLoops, 2, 1.1) + 0.55 * high(f.strokeCount, 2, 4),
            rocket: 0.2 + 1.65 * tall + 1.05 * f.verticalSymmetry + 1.0 * f.diagonalRatio + 0.95 * angular + 0.55 * loops + 0.35 * details,
            fish: 0.3 + 1.4 * wide + 1.15 * f.horizontalSymmetry + 1.05 * round + 0.95 * f.diagonalRatio + 0.5 * loops + 0.25 * angular,
            robot: 0.15 + 1.1 * near(f.aspectRatio, 0.85, 0.65) + 1.25 * angular + 0.9 * f.verticalSymmetry + 0.75 * f.verticalRatio + 0.75 * f.horizontalRatio + 1.4 * strokesMany + 0.55 * details - 0.8 * low(f.strokeCount, 3, 6),
            hamburger: 0.2 + 1.75 * wide + 1.45 * f.horizontalRatio + 0.85 * round + 1.0 * strokesMany + 0.55 * high(f.lowerDensity, 0.15, 0.55),
            star: 0.15 + 1.5 * angular + 1.1 * f.diagonalRatio + 0.85 * f.verticalSymmetry + 0.8 * f.horizontalSymmetry + 0.85 * low(f.strokeCount, 1, 4) + 0.4 * loops + 1.3 * high(f.cornerCount, 4, 9) + 0.85 * near(f.strokeCount, 1, 1.5) - 1.5 * high(f.strokeCount, 1.5, 4),
            umbrella: 0.2 + 1.1 * wide + 1.15 * f.verticalRatio + 0.95 * f.verticalSymmetry + 0.9 * high(f.upperDensity - f.lowerDensity, -0.05, 0.25) + 0.75 * round + 0.45 * low(f.strokeCount, 1, 5)
        };

        const temperature = 0.32;
        const maximum = Math.max(...Object.values(scores));
        const exponentials = Object.fromEntries(
            Object.entries(scores).map(([label, score]) => [label, Math.exp((score - maximum) / temperature)])
        );
        const total = Object.values(exponentials).reduce((sum, value) => sum + value, 0);
        const predictions = Object.entries(exponentials)
            .map(([label, value]) => ({ label, confidence: value / total, score: scores[label] }))
            .sort((a, b) => b.confidence - a.confidence);

        if (this.debug) console.table({ features: f, scores, predictions: predictions.slice(0, 3) });
        return predictions;
    }
}

/**
 * Future adapter seam:
 * class TensorFlowSketchRecognizer extends SketchRecognizer {
 *   constructor(model) { super(); this.model = model; }
 *   async predict(strokes, width, height) {
 *     const normalized = normalizeStrokes(strokes, width, height);
 *     // Rasterize/encode `normalized`, call model.predict(), and return
 *     // [{ label, confidence }] sorted descending.
 *   }
 * }
 */
