#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKETCH_CATEGORIES } from "../src/recognizer.js";
import { DEFAULT_IMAGE_SIZE } from "../src/sketchPreprocessing.js";
import { prepareTrainingExamples, unwrapTrainingExport } from "./sketch-data-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function argValue(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find(arg => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

async function loadTensorFlow() {
    try {
        return await import("@tensorflow/tfjs");
    } catch {
        throw new Error("Install training dependencies first with `npm install`.");
    }
}

function buildModel(tf, imageSize) {
    const model = tf.sequential();
    model.add(tf.layers.conv2d({
        inputShape: [imageSize, imageSize, 1],
        filters: 12,
        kernelSize: 3,
        activation: "relu",
        padding: "same"
    }));
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
    model.add(tf.layers.conv2d({ filters: 24, kernelSize: 3, activation: "relu", padding: "same" }));
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
    model.add(tf.layers.flatten());
    model.add(tf.layers.dense({ units: 64, activation: "relu" }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.dense({ units: SKETCH_CATEGORIES.length, activation: "softmax" }));
    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "categoricalCrossentropy",
        metrics: ["accuracy"]
    });
    return model;
}

async function saveTfjsModel(model, outputDir) {
    await mkdir(outputDir, { recursive: true });
    await model.save({
        save: async modelArtifacts => {
            const weightPath = "weights.bin";
            const modelJson = {
                modelTopology: modelArtifacts.modelTopology,
                weightsManifest: [{
                    paths: [weightPath],
                    weights: modelArtifacts.weightSpecs
                }],
                format: modelArtifacts.format,
                generatedBy: modelArtifacts.generatedBy,
                convertedBy: modelArtifacts.convertedBy
            };
            await writeFile(path.join(outputDir, "model.json"), JSON.stringify(modelJson, null, 2));
            await writeFile(path.join(outputDir, weightPath), Buffer.from(modelArtifacts.weightData));
            return {
                modelArtifactsInfo: {
                    dateSaved: new Date(),
                    modelTopologyType: "JSON",
                    modelTopologyBytes: JSON.stringify(modelArtifacts.modelTopology).length,
                    weightSpecsBytes: JSON.stringify(modelArtifacts.weightSpecs).length,
                    weightDataBytes: modelArtifacts.weightData.byteLength
                }
            };
        }
    });
    await writeFile(path.join(outputDir, "labels.json"), JSON.stringify(SKETCH_CATEGORIES, null, 2));
}

async function main() {
    const inputPath = argValue("input", null);
    const outputDir = path.resolve(root, argValue("output", "models/sketch-model"));
    const imageSize = Number(argValue("size", DEFAULT_IMAGE_SIZE));
    const epochs = Number(argValue("epochs", 20));
    const batchSize = Number(argValue("batch-size", 16));

    if (!inputPath) {
        throw new Error("Usage: node scripts/train-sketch-model.mjs --input=path/to/cursora-training.json");
    }

    const tf = await loadTensorFlow();
    const raw = JSON.parse(await readFile(path.resolve(root, inputPath), "utf8"));
    const examples = unwrapTrainingExport(raw);
    const { prepared, skipped } = prepareTrainingExamples(examples, { size: imageSize });

    for (const skippedExample of skipped) {
        console.warn(`Skipping example ${skippedExample.index}: ${skippedExample.errors.join("; ")}`);
    }
    if (prepared.length < SKETCH_CATEGORIES.length) {
        console.warn("Very little data is available. This will only prove the pipeline, not produce a strong recognizer.");
    }
    if (!prepared.length) throw new Error("No valid training examples found.");

    const xs = tf.tensor4d(
        prepared.flatMap(example => example.input),
        [prepared.length, imageSize, imageSize, 1]
    );
    const ys = tf.oneHot(
        tf.tensor1d(prepared.map(example => example.labelIndex), "int32"),
        SKETCH_CATEGORIES.length
    );

    const model = buildModel(tf, imageSize);
    await model.fit(xs, ys, {
        epochs,
        batchSize,
        shuffle: true,
        validationSplit: prepared.length >= 24 ? 0.2 : 0
    });
    await saveTfjsModel(model, outputDir);
    xs.dispose();
    ys.dispose();
    model.dispose();
    console.info(`Saved TensorFlow.js sketch model to ${outputDir}`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
