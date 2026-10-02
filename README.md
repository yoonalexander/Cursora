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

Use the local server to run the game and automatic drawing collection (Node 22+):

```sh
npm install
npm run dev
```

Then open `http://localhost:8000`. Local drawings persist in `.local-training/`.
This directory is ignored by Git and is not publicly served. A plain static
server can still run the game, but uploads queue on the device until an API is available.
Recognition continues to run in the browser.

Run tests with:

```sh
npm test
```

Tests cover uploads, outbox retries, owner review, approved-data pagination,
PostgreSQL schema/access/rate limiting (PGlite is a dev-only dependency), and a
real one-epoch training/inference smoke test using an isolated temporary dataset.

Add `?debug=1` to the game URL to log normalized features, preprocessing
details, model-loading status, predictions, and locally saved training examples.

## Pencil colors

Pick a pencil color before starting a run using the six numbered swatches.
Press `1`–`6` to select black, red, blue, yellow, green, or rainbow, or `C` to cycle
through them. Red, blue, yellow, and green use soft pastel shades. Rainbow blends
smoothly through pastel hues along the line as you draw, based on distance
traveled, with a full cycle over roughly 1,030 pixels. The swatches also work
during runs on touch devices. New ink uses
the selected color, even when you switch while drawing; existing ink keeps its
color through canvas resizes. The selection carries into the next prompt and retry.

Color is display-only: recognizers and training examples receive the same raw
`{ x, y, t }` coordinates. Neural input remains a single-channel monochrome image,
so choosing a color cannot change AI input or scoring for the same drawing.

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

## Automatic Training Data

Completed and timed-out drawings with at least eight points automatically enter
a local outbox and upload to `/api/training-examples`. Each example contains
the prompted label, outcome, canvas size, guesses, and drawing strokes. Long
drawings are sampled to at most 2,000 uploaded points while retaining endpoints;
the original local backup keeps the full drawing. Existing local references
join the queue automatically. Duplicate retries use the same ID and do not
overwrite the owner's review or corrected label.

Uploads run independently of gameplay. Network/server failures remain queued
across reloads and retry every 30 seconds (respecting longer rate-limit delays).
The game shows pending/synced status. Players can switch off sharing under
"Saved sketches & training"; this pauses queued uploads and stops new collection.
"Download local backup" is optional and is no longer required for website training.
Clearing browser storage removes references that have not reached the server.

Drawings start as **pending**, including successful recognitions. Open
`/training-review.html`, enter the owner token, and approve, reject, or correct
their labels. Training from the website reads **approved** examples only.
The review token is held in page memory, never saved in browser storage or URLs.

For local development without Supabase, the owner token defaults to
`cursora-local-development-owner-token`. The dev server binds to localhost.
This default is never accepted as an automatic production configuration.

### Hosted collection setup

The hosted adapter uses Supabase; no new runtime package is required.

Cursora's selected project is `mcowxzfqgxlvyhxhawbu` and its live site is
`https://cursora.alexyoon.com`. `.env.example` contains these public URLs;
server keys and the owner token belong only in ignored `.env` files and Vercel
Production secrets. Preview deployments are intentionally not given the
production dataset credentials.

1. Use a Supabase project dedicated to Cursora and run `database/training.sql`
   in its SQL editor. The script creates the dataset and an atomic per-IP
   submission limiter (30 requests per minute). It is safe to rerun and does not
   reset the dataset.
2. Configure these **server-only** variables in the Cursora Vercel project:
   - `SUPABASE_URL`: the project's URL.
   - `SUPABASE_SECRET_KEY`: its server secret key (`sb_secret_...`); legacy
     service-role keys are also supported. Never use a publishable/anon key here.
   - `TRAINING_ADMIN_TOKEN`: a unique random token of at least 32 characters,
     used for owner review and training reads. Keep it out of frontend code.
3. Deploy the code, including `api/training-examples.js`. Vercel runs this as a
   Node function. Missing settings return 503 and keep player drawings queued;
   there is no ephemeral filesystem fallback in production.
4. Play a prompt, check the upload status, then open `/training-review.html`
   with your owner token to confirm the drawing reached the shared dataset.

The database tables have row-level security enabled and no anonymous or
authenticated-client grants. Players can submit bounded, validated drawings
through the API but cannot read or review the shared dataset. Rate limiting
stores a hash of the submitting IP, not the raw IP; old limiter entries are
removed after a day. Owner reads and reviews require a bearer token. Server
responses never include database secrets.

This repository does not provision a cloud account or enable a paid plan.
Database credentials and a hosted deployment are needed to activate live collection.
References: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js),
[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Train A Model

Install dependencies when you are ready to train:

```sh
npm install
```

Train directly from reviewed website drawings, without exporting JSON. Set
`TRAINING_ADMIN_TOKEN` in your local `.env` (ignored by Git), then run:

```sh
npm run train:sketch-model -- --website=https://your-cursora-site.example
```

Or set `CURSORA_WEBSITE` in `.env` and run `npm run train:sketch-model`.
For the local dev server, use `CURSORA_WEBSITE=http://localhost:8000` and the
local development token above. Hosted reads require HTTPS and do not follow
redirects with the token. All approved pages are fetched automatically.

Training remains an explicit local command; the website does not retrain itself
while people play. Each run starts a new network. Include the generated model
files in a deployment to activate the learned recognizer.

An optional local backup can still be used as input (review its labels first):

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

Cursora deploys its static game plus a Vercel collection function. Set up hosted
collection as described above. Inference remains in the browser. After training,
commit or upload generated files under `models/sketch-model/` so Vercel serves
them as static assets. Use Node 22 or newer for local tooling and functions.

To verify which recognizer is active, open the game with `?debug=1` and check
the console for either:

- `Game recognizer ready: tensorflow`
- `Game recognizer ready: heuristic`

## Structure

- `index.html` - semantic game and mission HUD
- `styles.css` - shared paper/ink theme and responsive sketchbook game presentation
- `store.css` - paper-style store layout and illustrated gameplay preview
- `src/sketch.js` - persistent `{ x, y, t }` stroke capture and canvas rendering
- `src/recognizer.js` - recognizer contract, heuristic adapter, TensorFlow.js adapter
- `src/sketchPreprocessing.js` - shared neural preprocessing and rasterization
- `src/tfjsLoader.js` - static-site TensorFlow.js browser loader
- `src/trainingData.js` - local backups and automatic upload outbox
- `src/trainingExample.js` - bounded drawing preparation and server validation
- `api/training-examples.js` - Vercel collection, owner read, and review endpoint
- `server/` - collection authorization and Supabase/local storage adapters
- `database/training.sql` - private dataset and atomic submission limiter
- `training-review.html` - owner-only drawing review interface
- `scripts/dev-server.mjs` - local game server with persistent collection
- `scripts/website-training-data.mjs` - authenticated approved-data pagination
- `src/game.js` - survival loop, prompt lifecycle, recognition UI, and scoring
- `scripts/sketch-data-utils.mjs` - exported training data validation/preparation
- `scripts/train-sketch-model.mjs` - lightweight CNN training scaffold
- `scripts/create-dev-sketch-model.mjs` - untrained dev/test model generator
