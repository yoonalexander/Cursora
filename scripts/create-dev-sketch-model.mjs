#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKETCH_CATEGORIES } from "../src/recognizer.js";
import { DEFAULT_IMAGE_SIZE } from "../src/sketchPreprocessing.js";
import { saveTfjsModelForDev } from "./dev-model-writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function loadTensorFlow() {
    try {
        return await import("@tensorflow/tfjs");
    } catch {
        throw new Error("Install dependencies first with `npm install`.");
    }
}

async function main() {
    const tf = await loadTensorFlow();
    const outputDir = path.resolve(root, "models/sketch-model");
    const model = tf.sequential();
    model.add(tf.layers.flatten({ inputShape: [DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_SIZE, 1] }));
    model.add(tf.layers.dense({ units: SKETCH_CATEGORIES.length, activation: "softmax" }));
    model.compile({ optimizer: "sgd", loss: "categoricalCrossentropy" });
    await saveTfjsModelForDev(model, outputDir);
    model.dispose();
    console.info(`Saved dev/test model to ${outputDir}. It is not trained for real recognition.`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
