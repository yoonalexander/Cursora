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
        this.color = "#000000";
        this.rainbowHue = 0;
        // Display-only ink stays outside the raw strokes used for AI and training.
        this.strokeColors = new WeakMap();
        this.pixelRatio = 1;
    }

    setColor(color) {
        this.color = color;
    }

    get displayColor() {
        return this.color === "rainbow" ? `hsl(${Math.round(this.rainbowHue)} 100% 50%)` : this.color;
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
        this.strokeColors.set(this.currentStroke, [this.displayColor]);
        this.render();
    }

    add(point) {
        if (!this.currentStroke) return;
        const previous = this.currentStroke[this.currentStroke.length - 1];
        const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
        if (distance < 1.5) return;
        // Advance by distance drawn, so rainbow speed is independent of pointer event frequency.
        if (this.color === "rainbow") this.rainbowHue = (this.rainbowHue + distance * 1.5) % 360;
        this.currentStroke.push({ x: point.x, y: point.y, t: point.t });
        this.strokeColors.get(this.currentStroke).push(this.displayColor);
        this.render();
    }

    end() {
        if (this.currentStroke?.length === 1) {
            const point = this.currentStroke[0];
            this.currentStroke.push({ ...point, x: point.x + 0.1, t: performance.now() });
            this.strokeColors.get(this.currentStroke).push(this.strokeColors.get(this.currentStroke)[0]);
        }
        this.currentStroke = null;
        this.render();
    }

    clear() {
        this.strokes = [];
        this.currentStroke = null;
        this.strokeColors = new WeakMap();
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
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = 0.88;
        ctx.shadowBlur = 0;

        for (const stroke of this.strokes) {
            if (!stroke.length) continue;
            const colors = this.strokeColors.get(stroke);
            let strokeColor = colors?.[1] || colors?.[0] || this.displayColor;
            ctx.strokeStyle = strokeColor;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let index = 1; index < stroke.length; index += 1) {
                const point = stroke[index];
                const previous = stroke[index - 1];
                const color = colors?.[index] || this.displayColor;
                // Canvas serializes HSL as RGB; compare our stored colors, not strokeStyle.
                if (color !== strokeColor) {
                    ctx.stroke();
                    strokeColor = color;
                    ctx.strokeStyle = color;
                    ctx.beginPath();
                    // Continue the same smoothed path without splitting AI strokes.
                    const beforePrevious = stroke[index - 2];
                    ctx.moveTo((beforePrevious.x + previous.x) / 2, (beforePrevious.y + previous.y) / 2);
                }
                const midX = (previous.x + point.x) / 2;
                const midY = (previous.y + point.y) / 2;
                ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
            }
            const last = stroke[stroke.length - 1];
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }
}
