import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDevServer, LOCAL_ADMIN_TOKEN } from "../scripts/dev-server.mjs";
import { fetchWebsiteTrainingExamples } from "../scripts/website-training-data.mjs";
import { HttpTrainingDataStore } from "../src/trainingData.js";
import { sanitizeExample } from "../src/trainingExample.js";
import { SupabaseTrainingRepository } from "../server/trainingRepository.js";
import { TensorFlowSketchRecognizer } from "../src/recognizer.js";
import { createTrainingHandler } from "../server/trainingApi.js";

function drawing(overrides = {}) {
    return {
        id: randomUUID(), label: "house", outcome: "missed", durationMs: 20000,
        canvas: { width: 100, height: 100 }, predictions: [], createdAt: "2026-10-01T12:00:00.000Z",
        strokes: [Array.from({ length: 10 }, (_, i) => ({ x: i * 5, y: i * 4, t: i * 16 }))], ...overrides
    };
}

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

async function website(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "cursora-training-test-"));
    const server = createDevServer({ directory, env: {} });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), "cursora-training-test-")));
        await rm(directory, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const call = (method, body, owner = false, query = "", extra = {}) => fetch(`${url}/api/training-examples${query}`, {
        method, headers: { "Content-Type": "application/json", ...(owner ? { Authorization: `Bearer ${LOCAL_ADMIN_TOKEN}` } : {}), ...extra },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { url, call, directory };
}

test("website collects both outcomes; only owner-reviewed, corrected examples reach training", async t => {
    const { url, call } = await website(t);
    const missed = drawing();
    const success = drawing({ outcome: "recognized" });
    assert.equal((await call("POST", missed)).status, 201);
    assert.equal((await call("POST", success)).status, 201);
    assert.equal((await call("GET")).status, 401);
    assert.equal((await call("PATCH", { id: missed.id, status: "approved" })).status, 401);
    assert.deepEqual(await fetchWebsiteTrainingExamples(url, { token: LOCAL_ADMIN_TOKEN }), []);
    assert.equal((await call("PATCH", { id: missed.id, status: "approved", label: "tree" }, true)).status, 200);
    assert.equal((await call("PATCH", { id: success.id, status: "rejected" }, true)).status, 200);
    // Repeated uploads must neither duplicate examples nor reset the owner's review.
    assert.equal((await call("POST", missed)).status, 201);
    const approved = await fetchWebsiteTrainingExamples(url, { token: LOCAL_ADMIN_TOKEN });
    assert.equal(approved.length, 1);
    assert.equal(approved[0].label, "tree");
    assert.deepEqual(approved[0].strokes, missed.strokes);
    assert.equal((await call("PATCH", { id: missed.id, status: "pending" }, true)).status, 200);
    assert.deepEqual(await fetchWebsiteTrainingExamples(url, { token: LOCAL_ADMIN_TOKEN }), []);
});

test("invalid, oversized and cross-site submissions fail without storing data", async t => {
    const { url, call } = await website(t);
    for (const invalid of [drawing({ label: "anything" }), drawing({ id: "../../secret" }), drawing({ strokes: [[{ x: 1, y: 2, t: 1 }]] }), drawing({ durationMs: -1 }), drawing({ predictions: [{ label: "house", confidence: 20 }] })]) {
        assert.equal((await call("POST", invalid)).status, 422);
    }
    assert.equal((await call("POST", drawing(), false, "", { Origin: "https://another-site.example" })).status, 403);
    assert.equal((await call("POST", { padding: "x".repeat(270000) })).status, 413);
    assert.equal((await fetch(`${url}/api/training-examples`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "no" })).status, 415);
    assert.equal((await call("GET", null, true, "?cursor=../../secret")).status, 400);
    assert.equal((await call("PATCH", { id: randomUUID(), status: "approved", label: "bogus" }, true)).status, 422);
    assert.deepEqual((await (await call("GET", null, true)).json()).examples, []);
    for (const privatePath of ["/.env", "/.git/config", "/.local-training/test.json", "/server/trainingApi.js"]) assert.equal((await fetch(url + privatePath)).status, 404);
});

test("page cursors retrieve all examples without duplicates", async t => {
    const { call } = await website(t);
    for (let i = 0; i < 5; i++) await call("POST", drawing());
    const first = await (await call("GET", null, true, "?limit=2")).json();
    const second = await (await call("GET", null, true, `?limit=2&cursor=${first.nextCursor}`)).json();
    const third = await (await call("GET", null, true, `?limit=2&cursor=${second.nextCursor}`)).json();
    assert.equal(new Set([...first.examples, ...second.examples, ...third.examples].map(example => example.id)).size, 5);
    assert.equal(third.nextCursor, null);
});

test("collector limits submission bursts", async t => {
    const { call } = await website(t);
    const example = drawing();
    for (let i = 0; i < 30; i++) assert.equal((await call("POST", example)).status, 201);
    const response = await call("POST", drawing());
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
});

test("outbox automatically uploads existing references and new successful drawings", async t => {
    const { url, call } = await website(t);
    const storage = memoryStorage({ "cursora.trainingExamples.v1": JSON.stringify([drawing()]) });
    const store = new HttpTrainingDataStore({ storage, endpoint: `${url}/api/training-examples` });
    await store.flush();
    await store.saveExample(drawing({ outcome: "recognized" }));
    await store.flush();
    const examples = (await (await call("GET", null, true)).json()).examples;
    assert.equal(examples.length, 2);
    assert.ok((await store.listExamples()).every(example => example.uploadedAt));
    assert.ok(examples.some(example => example.outcome === "recognized"));
    store.setEnabled(false);
    await store.saveExample(drawing());
    assert.equal(await store.count(), 2);
});

test("failed uploads survive reload and retry with the same ID", async () => {
    const storage = memoryStorage();
    let requests = 0;
    const store = new HttpTrainingDataStore({ storage, fetcher: async () => { requests++; throw new Error("offline"); } });
    const saved = await store.saveExample(drawing());
    await store.flush();
    assert.equal(store.status, "waiting");
    assert.equal((await store.listExamples())[0].uploadedAt, undefined);
    const uploaded = [];
    const reloaded = new HttpTrainingDataStore({ storage, fetcher: async (_, options) => { const example = JSON.parse(options.body); uploaded.push(example); return Response.json({ id: example.id, saved: true }, { status: 201 }); } });
    await reloaded.flush();
    await reloaded.flush();
    assert.equal(requests, 1);
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].id, saved.id);
    assert.ok((await reloaded.listExamples())[0].uploadedAt);
});

test("new drawings saved during upload remain in the outbox and are uploaded", async () => {
    const storage = memoryStorage();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const uploaded = [];
    const store = new HttpTrainingDataStore({ storage, fetcher: async (_, options) => {
        const example = JSON.parse(options.body);
        uploaded.push(example.id);
        if (uploaded.length === 1) await gate;
        return Response.json({ id: example.id, saved: true }, { status: 201 });
    } });
    const first = await store.saveExample(drawing());
    const others = await Promise.all([store.saveExample(drawing()), store.saveExample(drawing())]);
    release();
    await store.flush();
    assert.equal(await store.count(), 3);
    assert.deepEqual(new Set(uploaded), new Set([first.id, ...others.map(item => item.id)]));
    assert.ok((await store.listExamples()).every(item => item.uploadedAt));
});

test("rate-limit delays are respected and a static HTML response cannot acknowledge uploads", async () => {
    const storage = memoryStorage();
    const store = new HttpTrainingDataStore({ storage, fetcher: async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }) });
    await store.saveExample(drawing());
    await store.flush();
    assert.ok(store.retryAt - Date.now() > 110000);
    const reloaded = new HttpTrainingDataStore({ storage, fetcher: async () => new Response("<html>static rewrite</html>", { status: 200 }) });
    await reloaded.flush();
    assert.equal(reloaded.status, "waiting");
    assert.equal((await reloaded.listExamples())[0].uploadedAt, undefined);
});

test("bounded uploads preserve stroke endpoints", () => {
    const example = sanitizeExample(drawing({ strokes: [Array.from({ length: 10000 }, (_, i) => ({ x: i % 100, y: 25, t: i }))] }));
    assert.ok(example.strokes.flat().length <= 2000);
    assert.deepEqual(example.strokes[0][0], { x: 0, y: 25, t: 0 });
    assert.deepEqual(example.strokes[0].at(-1), { x: 99, y: 25, t: 9999 });
});

test("website training follows approved pages and keeps owner token out of the URL", async () => {
    const calls = [];
    const cursor = randomUUID();
    const examples = await fetchWebsiteTrainingExamples("https://cursora.example/cursora/", {
        token: "test-owner-token",
        fetcher: async (url, options) => {
            calls.push({ url: String(url), options });
            return Response.json({ examples: [{ ...drawing(), reviewStatus: "approved" }], nextCursor: calls.length === 1 ? cursor : null });
        }
    });
    assert.equal(examples.length, 2);
    assert.ok(calls[1].url.includes(`cursor=${cursor}`));
    assert.ok(calls.every(call => !call.url.includes("test-owner-token") && call.options.headers.Authorization === "Bearer test-owner-token" && call.options.redirect === "error"));
    await assert.rejects(() => fetchWebsiteTrainingExamples("http://public.example", { token: "test" }), /HTTPS/);
    await assert.rejects(() => fetchWebsiteTrainingExamples("https://example.com", { token: "test", fetcher: async () => new Response("", { status: 401 }) }), /401/);
});

test("Supabase adapter uses server-only key and preserves review metadata on insert", async () => {
    const calls = [];
    const repository = new SupabaseTrainingRepository({ url: "https://project.supabase.co", key: "sb_secret_test", fetcher: async (url, options) => {
        calls.push({ url, options });
        return Response.json("saved");
    } });
    await repository.insert(drawing(), "hashed-ip");
    assert.match(calls[0].url, /rest\/v1\/rpc\/cursora_collect_example$/);
    assert.equal(calls[0].options.headers.apikey, "sb_secret_test");
    assert.equal(calls[0].options.headers.Authorization, undefined);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.collector, "hashed-ip");
    assert.equal(body.drawing.reviewStatus, undefined);
});

test("production collection fails closed without configuration and never accepts the local default", async () => {
    const handler = createTrainingHandler({ env: { VERCEL: "1" } });
    const invoke = async (method, authorization) => {
        let result;
        const res = { setHeader() {}, statusCode: 200, end(body) { result = { status: this.statusCode, body: JSON.parse(body) }; } };
        await handler({ method, url: "/api/training-examples", headers: { authorization } }, res);
        return result;
    };
    assert.equal((await invoke("POST")).status, 503);
    assert.equal((await invoke("GET", `Bearer ${LOCAL_ADMIN_TOKEN}`)).status, 401);
});

test("training command reads approved website data, writes a trained model and runs real inference", async t => {
    const { url, call, directory } = await website(t);
    const example = drawing();
    await call("POST", example);
    await call("PATCH", { id: example.id, status: "approved" }, true);
    await call("POST", drawing()); // Pending data must not enter training.
    const output = path.join(directory, "model");
    const { stdout } = await promisify(execFile)(process.execPath, [
        "scripts/train-sketch-model.mjs", `--website=${url}`, `--output=${output}`, "--epochs=1"
    ], { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, TRAINING_ADMIN_TOKEN: LOCAL_ADMIN_TOKEN }, timeout: 30000 });
    assert.match(stdout, /Loaded 1 approved drawings/);
    const artifact = JSON.parse(await readFile(path.join(output, "model.json"), "utf8"));
    const weights = await readFile(path.join(output, "weights.bin"));
    const labels = JSON.parse(await readFile(path.join(output, "labels.json"), "utf8"));
    assert.equal(labels.length, 12);
    assert.ok(weights.byteLength > 0);
    const tf = await import("@tensorflow/tfjs");
    const model = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: artifact.modelTopology, weightSpecs: artifact.weightsManifest[0].weights, weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) }));
    t.after(() => model.dispose());
    const recognizer = new TensorFlowSketchRecognizer({
        tfLoader: async () => ({ ...tf, loadLayersModel: async () => model }),
        fetcher: async () => Response.json(labels)
    });
    const predictions = await recognizer.predict(example.strokes, 100, 100);
    assert.equal(recognizer.activeRecognizer, "tensorflow");
    assert.equal(predictions.length, 12);
    assert.ok(predictions.every(item => Number.isFinite(item.confidence)));
    assert.ok(Math.abs(predictions.reduce((sum, item) => sum + item.confidence, 0) - 1) < 0.00001);
});
