/**
 * Stroke-first drawing state. Rendering is deliberately separate from
 * recognition so a future model receives the same raw {x, y, t} data.
 */
export class SketchPad {
    constructor(canvas) {
        this.canvas = canvas;
        this.context = canvas.getContext("2d");
        this.strokes = [];
        this.currentStroke = null;
        this.pixelRatio = 1;
    }

    resize(width, height) {
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(width * this.pixelRatio);
        this.canvas.height = Math.round(height * this.pixelRatio);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
        this.render();
    }

    begin(point) {
        this.currentStroke = [{ x: point.x, y: point.y, t: point.t }];
        this.strokes.push(this.currentStroke);
        this.render();
    }

    add(point) {
        if (!this.currentStroke) return;
        const previous = this.currentStroke[this.currentStroke.length - 1];
        if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
        this.currentStroke.push({ x: point.x, y: point.y, t: point.t });
        this.render();
    }

    end() {
        if (this.currentStroke?.length === 1) {
            const point = this.currentStroke[0];
            this.currentStroke.push({ ...point, x: point.x + 0.1, t: performance.now() });
        }
        this.currentStroke = null;
        this.render();
    }

    clear() {
        this.strokes = [];
        this.currentStroke = null;
        this.render();
    }

    get pointCount() {
        return this.strokes.reduce((sum, stroke) => sum + stroke.length, 0);
    }

    render() {
        const width = this.canvas.width / this.pixelRatio;
        const height = this.canvas.height / this.pixelRatio;
        const ctx = this.context;
        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 3.25;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(45, 247, 239, 0.9)";
        ctx.shadowColor = "rgba(45, 247, 239, 0.62)";
        ctx.shadowBlur = 8;

        for (const stroke of this.strokes) {
            if (!stroke.length) continue;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let index = 1; index < stroke.length; index += 1) {
                const point = stroke[index];
                const previous = stroke[index - 1];
                const midX = (previous.x + point.x) / 2;
                const midY = (previous.y + point.y) / 2;
                ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
            }
            const last = stroke[stroke.length - 1];
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
    }
}
