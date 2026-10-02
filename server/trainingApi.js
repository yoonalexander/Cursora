import { createHmac, timingSafeEqual } from "node:crypto";
import { SKETCH_CATEGORIES } from "../src/sketchCategories.js";
import { MAX_BODY_BYTES, validateExample } from "../src/trainingExample.js";
import { CollectionRateLimit, createTrainingRepository } from "./trainingRepository.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = ["pending", "approved", "rejected"];

export function createTrainingHandler({ repository, env = process.env } = {}) {
    return async (req, res) => {
        const reply = (status, data) => {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.statusCode = status;
            res.end(JSON.stringify(data));
        };
        if (!["POST", "GET", "PATCH"].includes(req.method)) {
            res.setHeader("Allow", "POST, GET, PATCH");
            return reply(405, { error: "Method not allowed." });
        }
        if (req.method !== "POST" && !authorized(req.headers.authorization, env.TRAINING_ADMIN_TOKEN)) return reply(401, { error: "Owner access required." });
        // No permissive CORS: the game posts only to its own origin.
        if (req.method !== "GET" && req.headers.origin) {
            try {
                if (new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: "Cross-site submissions are not allowed." });
            } catch { return reply(403, { error: "Invalid origin." }); }
        }
        try {
            if (!env.TRAINING_ADMIN_TOKEN || env.TRAINING_ADMIN_TOKEN.length < 32) return reply(503, { error: "Collection is not configured." });
            let drawing, review;
            const url = new URL(req.url, "http://localhost");
            const cursor = url.searchParams.get("cursor");
            const status = url.searchParams.get("status") || "pending";
            const limit = Number(url.searchParams.get("limit") || 100);
            if (req.method === "GET" && (!statuses.includes(status) || (cursor && !uuid.test(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 100)) return reply(400, { error: "Invalid page parameters." });
            if (req.method !== "GET") {
                if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return reply(415, { error: "Expected application/json." });
                let body;
                try { body = await readBody(req); } catch (error) { return reply(error.status || 400, { error: error.message }); }
                if (req.method === "POST") {
                    try { drawing = validateExample(body); } catch (error) { return reply(422, { error: error.message }); }
                } else {
                    if (!body || !uuid.test(body.id) || !statuses.includes(body.status) || (body.label !== undefined && !SKETCH_CATEGORIES.includes(body.label))) return reply(422, { error: "Invalid review." });
                    review = body;
                }
            }
            const store = repository || createTrainingRepository(env);
            if (req.method === "POST") {
                // Vercel supplies x-forwarded-for; local development uses the socket.
                const ip = env.VERCEL ? String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim() : req.socket?.remoteAddress || "local";
                const collector = createHmac("sha256", env.TRAINING_ADMIN_TOKEN).update(ip).digest("hex");
                await store.insert(drawing, collector);
                return reply(201, { id: drawing.id, saved: true });
            }
            if (req.method === "GET") return reply(200, await store.list({ status, cursor, limit }));
            const found = await store.review(review.id, review);
            return reply(found ? 200 : 404, found ? { saved: true } : { error: "Drawing not found." });
        } catch (error) {
            if (error instanceof CollectionRateLimit) {
                res.setHeader("Retry-After", "60");
                return reply(429, { error: "Please retry in a minute." });
            }
            // Do not leak database responses, keys, or drawing contents in errors.
            return reply(503, { error: "Collection is unavailable. Drawings will retry automatically." });
        }
    };
}

function authorized(header, token) {
    if (!token || token.length < 32 || typeof header !== "string") return false;
    const actual = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(req) {
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) throw Object.assign(new Error("Drawing is too large."), { status: 413 });
    if (req.body !== undefined) {
        const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw Object.assign(new Error("Drawing is too large."), { status: 413 });
        return JSON.parse(text);
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error("Drawing is too large."), { status: 413 });
        chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Invalid JSON."); }
}
