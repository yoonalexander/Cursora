import { HeuristicSketchRecognizer, SKETCH_CATEGORIES } from "./recognizer.js";
import { SketchPad } from "./sketch.js";

const $ = selector => document.querySelector(selector);
const elements = {
    game: $("#gameContainer"),
    canvas: $("#drawingCanvas"),
    cursor: $("#playerCursor"),
    timer: $("#timerValue"),
    score: $("#scoreValue"),
    instructions: $("#instructions"),
    gameOver: $("#gameOverMessage"),
    start: $("#startButton"),
    retry: $("#retryButton"),
    clear: $("#clearDrawingButton"),
    target: $("#targetPrompt"),
    promptTimer: $("#promptTimer"),
    completed: $("#completedCount"),
    streak: $("#streakCount"),
    tier: $("#missionTier"),
    guesses: $("#guessList"),
    guessPhrase: $("#guessPhrase"),
    thinking: $("#thinkingIndicator"),
    confidence: $("#targetConfidence"),
    confidenceFill: $("#confidenceFill"),
    confidenceTrack: $(".confidence-track"),
    recognitionCard: $("#recognitionCard"),
    flash: $("#missionFlash"),
    hint: $("#drawingHint")
};

const sketchPad = new SketchPad(elements.canvas);
const recognizer = new HeuristicSketchRecognizer({
    debug: new URLSearchParams(window.location.search).has("debug")
});

const RECOGNITION_INTERVAL = 700;
const COMPLETION_THRESHOLD = 0.65;
const ORB_VALUE = 100;
const MAX_ORBS = 5;
const ORB_LIFETIME = 8000;
const PROMPT_TIPS = {
    cat: "Try a face, pointed ears, whiskers, and eyes.",
    dog: "Try a head, floppy ears, muzzle, and body details.",
    house: "Try walls, a roof, door, and windows.",
    tree: "Try a trunk with a broad leafy crown.",
    car: "Try a wide body, roof, and two round wheels.",
    bicycle: "Two large wheels and a triangular frame help.",
    rocket: "Try a tall body, pointed nose, fins, and flame.",
    fish: "Try an oval body, tail, eye, and fins.",
    robot: "Use boxy parts, a face panel, arms, and legs.",
    hamburger: "Stack wide curved buns and horizontal fillings.",
    star: "Use five sharp points in one closed outline.",
    umbrella: "Try a curved canopy, ribs, and a long handle."
};

let state = {};

function freshState() {
    return {
        active: false,
        frame: null,
        startTime: 0,
        elapsed: 0,
        score: 0,
        bullets: [],
        orbs: [],
        player: { x: elements.game.clientWidth / 2, y: elements.game.clientHeight / 2, radius: 7.5 },
        pointerId: null,
        lastVolley: 0,
        lastOrb: 0,
        difficulty: 1,
        bulletSpeed: 2,
        volleyInterval: 1500,
        bulletsPerVolley: 1,
        maxBullets: 50,
        orbInterval: 5000,
        target: "",
        previousTarget: "",
        promptStarted: 0,
        completed: 0,
        streak: 0,
        lastRecognition: 0,
        recognitionPending: false,
        missionLocked: false
    };
}

function pointFromEvent(event) {
    const rect = elements.game.getBoundingClientRect();
    return {
        x: Math.max(0, Math.min(event.clientX - rect.left, elements.game.clientWidth)),
        y: Math.max(0, Math.min(event.clientY - rect.top, elements.game.clientHeight)),
        t: performance.now()
    };
}

function updatePlayer(point) {
    state.player.x = point.x;
    state.player.y = point.y;
    elements.cursor.style.left = `${point.x}px`;
    elements.cursor.style.top = `${point.y}px`;
}

function resize() {
    sketchPad.resize(elements.game.clientWidth, elements.game.clientHeight);
    if (!state.player) return;
    state.player.x = Math.min(state.player.x, elements.game.clientWidth);
    state.player.y = Math.min(state.player.y, elements.game.clientHeight);
    updatePlayer({ ...state.player });
}

function choosePrompt() {
    const available = SKETCH_CATEGORIES.filter(category => category !== state.previousTarget);
    state.target = available[Math.floor(Math.random() * available.length)];
    state.previousTarget = state.target;
    state.promptStarted = performance.now();
    state.lastRecognition = 0;
    state.missionLocked = false;
    elements.target.textContent = `Draw a ${state.target}`;
    elements.hint.textContent = PROMPT_TIPS[state.target];
    resetRecognitionUI();
}

function resetRecognitionUI() {
    elements.guesses.innerHTML = Array.from({ length: 3 }, () => "<li><span>—</span><strong>0%</strong></li>").join("");
    elements.guessPhrase.textContent = state.active ? "AI is waiting for ink…" : "AI is offline";
    elements.confidence.textContent = "0%";
    elements.confidenceFill.style.width = "0%";
    elements.confidenceTrack.setAttribute("aria-valuenow", "0");
    elements.recognitionCard.classList.remove("close");
    elements.thinking.classList.remove("active");
}

function renderPredictions(predictions) {
    const top = predictions.slice(0, 3);
    elements.guesses.innerHTML = top.map(prediction => {
        const percent = Math.round(prediction.confidence * 100);
        return `<li><span>${prediction.label}</span><strong>${percent}%</strong></li>`;
    }).join("");
    while (elements.guesses.children.length < 3) {
        elements.guesses.insertAdjacentHTML("beforeend", "<li><span>—</span><strong>0%</strong></li>");
    }

    const targetPrediction = predictions.find(prediction => prediction.label === state.target);
    const targetConfidence = targetPrediction?.confidence || 0;
    const percent = Math.round(targetConfidence * 100);
    elements.confidence.textContent = `${percent}%`;
    elements.confidenceFill.style.width = `${percent}%`;
    elements.confidenceTrack.setAttribute("aria-valuenow", String(percent));
    elements.recognitionCard.classList.toggle("close", targetConfidence >= 0.4);
    elements.guessPhrase.textContent = top.length
        ? `I see… ${top[0].label}?${top[1] ? ` Maybe ${top[1].label}.` : ""}`
        : "AI needs a few more lines…";

    if (top[0]?.label === state.target && top[0].confidence >= COMPLETION_THRESHOLD) {
        completeMission(top[0]);
    }
}

async function runRecognition(timestamp) {
    if (
        state.recognitionPending ||
        state.missionLocked ||
        sketchPad.pointCount < 8 ||
        timestamp - state.lastRecognition < RECOGNITION_INTERVAL
    ) return;

    state.recognitionPending = true;
    state.lastRecognition = timestamp;
    elements.thinking.classList.add("active");
    elements.guessPhrase.textContent = "AI is thinking…";
    const targetAtStart = state.target;
    try {
        const predictions = await recognizer.predict(
            sketchPad.strokes,
            elements.game.clientWidth,
            elements.game.clientHeight
        );
        if (state.active && targetAtStart === state.target && !state.missionLocked) renderPredictions(predictions);
    } catch (error) {
        console.error("Sketch recognition failed:", error);
        elements.guessPhrase.textContent = "AI lost the line. Keep drawing…";
    } finally {
        state.recognitionPending = false;
        elements.thinking.classList.remove("active");
    }
}

function completeMission(prediction) {
    state.missionLocked = true;
    const promptSeconds = Math.max(1, (performance.now() - state.promptStarted) / 1000);
    const speedBonus = Math.max(0, Math.round(900 - promptSeconds * 35));
    const tierBonus = state.difficulty * 125;
    const comboMultiplier = 1 + Math.min(state.streak, 5) * 0.15;
    const reward = Math.round((500 + speedBonus + tierBonus) * comboMultiplier);
    state.score += reward;
    state.completed += 1;
    state.streak += 1;
    elements.score.textContent = Math.floor(state.score);
    elements.completed.textContent = state.completed;
    elements.streak.textContent = state.streak;
    elements.flash.textContent = `Recognized: ${prediction.label}! +${reward}`;
    elements.flash.classList.remove("show");
    void elements.flash.offsetWidth;
    elements.flash.classList.add("show");

    const removalCount = Math.ceil(state.bullets.length * 0.2);
    for (let index = 0; index < removalCount; index += 1) {
        const bullet = state.bullets.shift();
        bullet?.element.remove();
    }
    for (const bullet of state.bullets) {
        bullet.slowUntil = performance.now() + 1100;
    }

    window.setTimeout(() => {
        if (!state.active) return;
        sketchPad.clear();
        elements.clear.disabled = true;
        choosePrompt();
    }, 850);
}

function spawnBullet() {
    const element = document.createElement("div");
    element.className = "bullet";
    const edge = Math.floor(Math.random() * 4);
    const width = elements.game.clientWidth;
    const height = elements.game.clientHeight;
    const offset = 10;
    let x = edge === 1 ? width + offset : edge === 3 ? -offset : Math.random() * width;
    let y = edge === 0 ? -offset : edge === 2 ? height + offset : Math.random() * height;
    let angle = Math.atan2(state.player.y - y, state.player.x - x);
    angle += (Math.random() - 0.5) * (state.bulletsPerVolley > 1 ? 0.2 * Math.min(state.bulletsPerVolley, 5) : 0.3);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    state.bullets.push({
        element, x, y,
        dx: Math.cos(angle) * state.bulletSpeed,
        dy: Math.sin(angle) * state.bulletSpeed,
        radius: 4,
        slowUntil: 0
    });
    elements.game.appendChild(element);
}

function spawnVolley() {
    if (state.bullets.length + state.bulletsPerVolley > state.maxBullets) return;
    for (let index = 0; index < state.bulletsPerVolley; index += 1) spawnBullet();
}

function spawnOrb() {
    if (state.orbs.length >= MAX_ORBS) return;
    const element = document.createElement("div");
    element.className = "orb";
    const padding = 30;
    const x = padding + Math.random() * Math.max(1, elements.game.clientWidth - padding * 2);
    const y = padding + Math.random() * Math.max(1, elements.game.clientHeight - padding * 2);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    state.orbs.push({ element, x, y, radius: 6, spawned: performance.now() });
    elements.game.appendChild(element);
    requestAnimationFrame(() => element.classList.add("visible"));
}

function updateEntities(timestamp) {
    for (let index = state.bullets.length - 1; index >= 0; index -= 1) {
        const bullet = state.bullets[index];
        const speedScale = timestamp < bullet.slowUntil ? 0.35 : 1;
        bullet.x += bullet.dx * speedScale;
        bullet.y += bullet.dy * speedScale;
        bullet.element.style.left = `${bullet.x}px`;
        bullet.element.style.top = `${bullet.y}px`;
        if (Math.hypot(state.player.x - (bullet.x + bullet.radius), state.player.y - (bullet.y + bullet.radius)) < state.player.radius + bullet.radius) {
            gameOver();
            return false;
        }
        if (bullet.x < -50 || bullet.x > elements.game.clientWidth + 50 || bullet.y < -50 || bullet.y > elements.game.clientHeight + 50) {
            bullet.element.remove();
            state.bullets.splice(index, 1);
        }
    }

    for (let index = state.orbs.length - 1; index >= 0; index -= 1) {
        const orb = state.orbs[index];
        if (Math.hypot(state.player.x - (orb.x + orb.radius), state.player.y - (orb.y + orb.radius)) < state.player.radius + orb.radius) {
            state.score += ORB_VALUE;
            orb.element.remove();
            state.orbs.splice(index, 1);
        } else if (timestamp - orb.spawned > ORB_LIFETIME) {
            orb.element.remove();
            state.orbs.splice(index, 1);
        }
    }
    return true;
}

function increaseDifficulty() {
    const intended = Math.floor(state.elapsed / 10) + 1;
    while (state.difficulty < intended) {
        state.difficulty += 1;
        if (state.difficulty % 2 === 0 && state.bulletsPerVolley < 10) state.bulletsPerVolley += 1;
        state.volleyInterval = Math.max(400, state.volleyInterval * 0.95);
        state.bulletSpeed = Math.min(3.5, state.bulletSpeed + 0.05);
        state.maxBullets = Math.min(150, 50 + state.difficulty * 5);
        state.orbInterval = Math.max(2000, state.orbInterval * 0.97);
        elements.tier.textContent = `Tier ${state.difficulty}`;
    }
}

function loop(timestamp) {
    if (!state.active) return;
    if (!state.startTime) {
        state.startTime = timestamp;
        state.promptStarted = timestamp;
    }
    const previousElapsed = state.elapsed;
    state.elapsed = (timestamp - state.startTime) / 1000;
    state.score += Math.max(0, state.elapsed - previousElapsed) * 10;
    elements.timer.textContent = `${state.elapsed.toFixed(2)}s`;
    elements.score.textContent = Math.floor(state.score);
    elements.promptTimer.textContent = `${Math.max(0, (timestamp - state.promptStarted) / 1000).toFixed(1)}s`;

    if (timestamp - state.lastVolley > state.volleyInterval) {
        spawnVolley();
        state.lastVolley = timestamp;
    }
    if (timestamp - state.lastOrb > state.orbInterval) {
        spawnOrb();
        state.lastOrb = timestamp;
    }
    if (!updateEntities(timestamp)) return;
    increaseDifficulty();
    runRecognition(timestamp);
    state.frame = requestAnimationFrame(loop);
}

function clearEntities() {
    for (const entity of [...state.bullets, ...state.orbs]) entity.element.remove();
    state.bullets = [];
    state.orbs = [];
}

function resetGame() {
    if (state.frame) cancelAnimationFrame(state.frame);
    if (state.bullets) clearEntities();
    state = freshState();
    sketchPad.clear();
    elements.timer.textContent = "0.00s";
    elements.score.textContent = "0";
    elements.promptTimer.textContent = "0.0s";
    elements.completed.textContent = "0";
    elements.streak.textContent = "0";
    elements.tier.textContent = "Tier 1";
    elements.clear.disabled = true;
    updatePlayer({ ...state.player });
}

function startGame() {
    resetGame();
    state.active = true;
    elements.instructions.textContent = "Run live. Hold to draw, keep moving, and convince the AI.";
    elements.instructions.hidden = false;
    elements.gameOver.hidden = true;
    elements.start.hidden = true;
    elements.retry.hidden = true;
    document.body.style.cursor = "none";
    choosePrompt();
    state.frame = requestAnimationFrame(loop);
}

function gameOver() {
    if (!state.active) return;
    state.active = false;
    state.pointerId = null;
    sketchPad.end();
    cancelAnimationFrame(state.frame);
    elements.instructions.hidden = true;
    elements.gameOver.innerHTML = `Game over. <span class="gold">${Math.floor(state.score)} points</span> · ${state.completed} prompts · <span class="green">${state.elapsed.toFixed(2)}s</span>`;
    elements.gameOver.hidden = false;
    elements.retry.hidden = false;
    elements.clear.disabled = true;
    elements.guessPhrase.textContent = "AI is offline";
    elements.thinking.classList.remove("active");
    document.body.style.cursor = "default";
}

elements.game.addEventListener("pointermove", event => {
    const point = pointFromEvent(event);
    updatePlayer(point);
    if (state.active && state.pointerId === event.pointerId) {
        sketchPad.add(point);
        elements.clear.disabled = false;
    }
});

elements.game.addEventListener("pointerdown", event => {
    if (!state.active || state.missionLocked || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    updatePlayer(point);
    state.pointerId = event.pointerId;
    elements.game.setPointerCapture(event.pointerId);
    sketchPad.begin(point);
    elements.clear.disabled = false;
});

function endPointer(event) {
    if (state.pointerId !== event.pointerId) return;
    sketchPad.end();
    state.pointerId = null;
    if (elements.game.hasPointerCapture(event.pointerId)) elements.game.releasePointerCapture(event.pointerId);
}

elements.game.addEventListener("pointerup", endPointer);
elements.game.addEventListener("pointercancel", endPointer);
elements.game.addEventListener("contextmenu", event => event.preventDefault());
elements.start.addEventListener("click", startGame);
elements.retry.addEventListener("click", startGame);
elements.clear.addEventListener("click", () => {
    if (!state.active || state.missionLocked) return;
    sketchPad.clear();
    elements.clear.disabled = true;
    resetRecognitionUI();
});
window.addEventListener("resize", resize);

state = freshState();
resize();
updatePlayer({ ...state.player });
resetRecognitionUI();
