# Cursora

Cursora is a static "Quick, Draw meets bullet hell" browser game. Draw the
prompted object while dodging bullets and collecting score orbs. The game keeps
the recognizer behind one adapter method:

```js
SketchRecognizer.predict(strokes, width, height)
```

The default gameplay remains fully local and static. A TensorFlow.js recognizer
can now load in the browser when a trained model is present, and the existing
heuristic recognizer remains the fallback when it is not.

## Run locally

Serve the repository with any static server:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. No backend or server-side inference is
required.

Run tests with:

```sh
npm test
```

Add `?debug=1` to the game URL to log normalized features, preprocessing
details, model-loading status, predictions, and locally saved training examples.

## Recognizers

`HeuristicSketchRecognizer` is the deterministic geometry-based recognizer that
ships with the game. It keeps the game playable with no model files.

`TensorFlowSketchRecognizer` is the browser neural-network adapter. It lazily
loads TensorFlow.js from a pinned CDN script, then tries to load:

```text
models/sketch-model/model.json
models/sketch-model/labels.json
```

If TensorFlow.js, the model, or the label mapping fails to load, the adapter
uses `HeuristicSketchRecognizer` instead. The game initializes with heuristics
immediately, so the start button and gameplay loop do not wait on model loading.

`labels.json` must be a JSON array in the exact order of `SKETCH_CATEGORIES` in
`src/recognizer.js`.

## Preprocessing

Neural inference uses the reusable preprocessing module in
`src/sketchPreprocessing.js`:

- normalize raw `{ x, y, t }` strokes with `normalizeStrokes`
- rasterize normalized strokes into a small grayscale image
- convert pixels into normalized `0..1` input values
- create a `[1, 28, 28, 1]` TensorFlow.js tensor for browser inference

The training utilities use the same rasterizer, so future models train against
the same representation used in the game.

## Training Data

Missed drawings are saved locally through `LocalTrainingDataStore`. In the game,
the "Export training refs" button downloads a JSON file shaped like:

```json
{
  "schema": "cursora.trainingExamples.v1",
  "exportedAt": "2026-07-08T00:00:00.000Z",
  "examples": []
}
```

Each example includes the label, canvas size, predictions, and raw strokes.

## Train A Model

Install dependencies when you are ready to train:

```sh
npm install
```

Train from an exported Cursora training file:

```sh
npm run train:sketch-model -- --input=path/to/cursora-training.json
```

The script builds a small CNN:

- Conv2D
- MaxPooling2D
- Conv2D
- MaxPooling2D
- Flatten
- Dense
- Dropout
- Dense softmax over `SKETCH_CATEGORIES`

It validates labels, skips invalid examples with clear warnings, and writes a
TensorFlow.js browser model to:

```text
models/sketch-model/
```

The scaffold is intentionally ready for more data sources later, such as Google
Quick, Draw. Add loaders that produce the same `{ label, strokes, canvas }`
shape, then pass them through `scripts/sketch-data-utils.mjs`.

## Dev/Test Model

To generate a tiny untrained model that only proves the inference pipeline:

```sh
npm run create:dev-model
```

This model is not accurate. It only verifies that TensorFlow.js can load a
static model and return predictions in the browser.

## Deploy

Cursora still deploys as a static Vercel site. No backend is required. After
training, commit or upload the generated files under `models/sketch-model/` so
Vercel serves them as static assets.

To verify which recognizer is active, open the game with `?debug=1` and check
the console for either:

- `Game recognizer ready: tensorflow`
- `Game recognizer ready: heuristic`

## Structure

- `index.html` - semantic game and mission HUD
- `styles.css` - responsive neon/cyber sketch presentation
- `src/sketch.js` - persistent `{ x, y, t }` stroke capture and canvas rendering
- `src/recognizer.js` - recognizer contract, heuristic adapter, TensorFlow.js adapter
- `src/sketchPreprocessing.js` - shared neural preprocessing and rasterization
- `src/tfjsLoader.js` - static-site TensorFlow.js browser loader
- `src/trainingData.js` - local training-example storage plus future backend seam
- `src/game.js` - survival loop, prompt lifecycle, recognition UI, and scoring
- `scripts/sketch-data-utils.mjs` - exported training data validation/preparation
- `scripts/train-sketch-model.mjs` - lightweight CNN training scaffold
- `scripts/create-dev-sketch-model.mjs` - untrained dev/test model generator
