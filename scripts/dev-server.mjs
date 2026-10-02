import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTrainingHandler } from "../server/trainingApi.js";
import { createTrainingRepository, FileTrainingRepository } from "../server/trainingRepository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOCAL_ADMIN_TOKEN = "cursora-local-development-owner-token";

export function createDevServer({ directory = path.join(root, ".local-training"), env = process.env } = {}) {
    const settings = { ...env, TRAINING_ADMIN_TOKEN: env.TRAINING_ADMIN_TOKEN || LOCAL_ADMIN_TOKEN };
    const repository = settings.SUPABASE_URL || settings.SUPABASE_SECRET_KEY || settings.VERCEL
        ? createTrainingRepository(settings) : new FileTrainingRepository(directory);
    const handler = createTrainingHandler({ repository, env: settings });
    return createServer(async (req, res) => {
        let pathname;
        try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
        pathname = pathname.replace(/^\/cursora(?=\/|$)/, "") || "/";
        if (pathname === "/api/training-examples") return handler(req, res);
        if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
        if (pathname === "/") pathname = "/index.html";
        const filename = path.resolve(root, `.${pathname}`);
        const relative = path.relative(root, filename).replaceAll("\\", "/");
        const roots = ["index.html", "store.html", "styles.css", "store.css", "training-review.html", "training-review.css", "favicon.png", "AY Logo Large Clear.png"];
        const allowed = roots.includes(relative) || /^(src\/[^/]+\.js|models\/sketch-model\/[^/]+\.(json|bin))$/.test(relative);
        if (!allowed) { res.writeHead(404).end(); return; }
        try {
            const body = await readFile(filename);
            const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".bin": "application/octet-stream" };
            res.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" });
            res.end(req.method === "HEAD" ? undefined : body);
        } catch { res.writeHead(404).end(); }
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT || 8000);
    createDevServer().listen(port, "127.0.0.1", () => console.info(`Cursora: http://localhost:${port}\nDrawing review: http://localhost:${port}/training-review.html`));
}
