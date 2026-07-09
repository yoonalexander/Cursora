Place TensorFlow.js model files for the browser recognizer here:

- `model.json`
- `weights.bin` or other files referenced by `model.json`
- `labels.json`

`labels.json` must be a JSON array in the exact same order as `SKETCH_CATEGORIES`
from `src/recognizer.js`.

The app works without these files. If loading fails, it uses
`HeuristicSketchRecognizer`.
