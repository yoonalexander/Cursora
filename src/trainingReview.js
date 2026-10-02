import { SKETCH_CATEGORIES, normalizeStrokes } from "./recognizer.js";

const form = document.querySelector("#connectForm");
const token = document.querySelector("#ownerToken");
const filter = document.querySelector("#reviewFilter");
const message = document.querySelector("#reviewMessage");
const grid = document.querySelector("#reviewExamples");
const next = document.querySelector("#nextPage");
let nextCursor = null;
let revision = 0;

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.value}`, ...options.headers },
        signal: AbortSignal.timeout(15000), redirect: "error"
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Owner token was not accepted." : `Collection returned HTTP ${response.status}. Check the server configuration.`);
    return response.json();
}

async function load(cursor = null) {
    const current = ++revision;
    next.hidden = true;
    grid.replaceChildren();
    message.textContent = "Loading drawings…";
    try {
        const params = new URLSearchParams({ status: filter.value, limit: "24" });
        if (cursor) params.set("cursor", cursor);
        const page = await request(`/api/training-examples?${params}`);
        if (current !== revision) return;
        nextCursor = page.nextCursor;
        for (const example of page.examples) grid.append(card(example));
        next.hidden = !nextCursor;
        message.textContent = page.examples.length ? `${page.examples.length} drawing${page.examples.length === 1 ? "" : "s"} loaded.` : "No drawings in this group yet.";
    } catch (error) { if (current === revision) message.textContent = error.message; }
}

function card(example) {
    const article = document.createElement("article");
    article.className = "review-example";
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 240;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Drawing prompted as ${example.label}`);
    const context = canvas.getContext("2d");
    context.strokeStyle = "#252a24";
    context.fillStyle = "#252a24";
    context.lineWidth = 3;
    context.lineCap = context.lineJoin = "round";
    for (const stroke of normalizeStrokes(example.strokes, example.canvas.width, example.canvas.height)) {
        if (stroke.length === 1) { context.beginPath(); context.arc(stroke[0].x * 240, stroke[0].y * 240, 1.5, 0, Math.PI * 2); context.fill(); continue; }
        context.beginPath();
        stroke.forEach((point, index) => context[index ? "lineTo" : "moveTo"](point.x * 240, point.y * 240));
        context.stroke();
    }
    const info = document.createElement("p");
    info.textContent = `${example.label} · ${example.outcome} · ${new Date(example.createdAt).toLocaleString()}`;
    const label = document.createElement("label");
    label.textContent = "Correct label ";
    const select = document.createElement("select");
    for (const category of SKETCH_CATEGORIES) {
        const option = document.createElement("option");
        option.value = option.textContent = category;
        option.selected = category === example.label;
        select.append(option);
    }
    label.append(select);
    const actions = document.createElement("div");
    actions.className = "review-actions";
    const feedback = document.createElement("p");
    feedback.setAttribute("role", "status");
    const buttons = [];
    for (const [status, text] of [["approved", "Approve"], ["rejected", "Reject"], ["pending", "Undo review"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button secondary";
        button.textContent = text;
        button.addEventListener("click", async () => {
            buttons.forEach(item => { item.disabled = true; });
            try {
                await request("/api/training-examples", { method: "PATCH", body: JSON.stringify({ id: example.id, status, label: select.value }) });
                feedback.textContent = `Saved: ${status} as ${select.value}.`;
            } catch (error) { feedback.textContent = error.message; }
            finally { buttons.forEach(item => { item.disabled = false; }); }
        });
        buttons.push(button);
        actions.append(button);
    }
    article.append(canvas, info, label, actions, feedback);
    return article;
}

form.addEventListener("submit", event => { event.preventDefault(); void load(); });
next.addEventListener("click", () => { void load(nextCursor); });
filter.addEventListener("change", () => { if (token.value) void load(); });
document.querySelector("#lockReview").addEventListener("click", () => {
    revision++;
    token.value = "";
    grid.replaceChildren();
    next.hidden = true;
    message.textContent = "Review locked.";
});
