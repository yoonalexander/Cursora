# Cursora

Cursora is a static "Quick, Draw meets bullet hell" browser game. Draw the
prompted object while dodging bullets and collecting score orbs. A lightweight
local recognizer analyzes ordered stroke data and produces ranked guesses.

Each prompt has a 20-second Quick, Draw-style timer. If the recognizer gets the
target before time runs out, the player earns a score reward and a new prompt
appears. If time expires, the game moves on anyway and saves the missed sketch
locally as training reference data.

## Run locally

Serve the repository with any static server:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. No build step or backend is required.

Run the recognizer tests with:

```sh
npm test
```

Add `?debug=1` to the game URL to log normalized features, category scores,
predictions, and locally saved training examples.

## Structure

- `index.html` — semantic game and mission HUD
- `styles.css` — responsive neon/cyber sketch presentation
- `src/sketch.js` — persistent `{ x, y, t }` stroke capture and canvas rendering
- `src/recognizer.js` — normalization, feature extraction, recognizer contract,
  and heuristic adapter
- `src/trainingData.js` — local training-example storage plus future backend seam
- `src/game.js` — survival loop, prompt lifecycle, recognition UI, and scoring

`SketchRecognizer.predict(strokes, width, height)` is the adapter boundary for
a future TensorFlow.js or QuickDraw-trained implementation. `TrainingDataStore`
is the adapter boundary for collecting missed drawings through a real API later.
Game completion and timeout logic remain in `game.js`, independent of both
adapters.
