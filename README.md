# AI-Time-Loop-Challenge

An AI-powered time-loop adventure game where players investigate events, make decisions, and solve mysteries through multiple timelines. Built with React, Node.js, Express, MongoDB, and Google Gemini AI.

An AI-assisted time-loop puzzle game (MERN + Google Gemini). `spec.md` is the source of truth.
The player is stuck in a repeating stretch of time; the world resets each loop but knowledge persists.
**Gemini writes scenarios. The server's deterministic rules decide everything that happens.**

* Audit results and the acceptance-criteria checklist: [`AUDIT.md`](AUDIT.md).
* Honest status: automated tests pass, but the **real Gemini API and a real MongoDB have not been exercised** by the
  author's environment. See [Verifying the real integrations](#verifying-the-real-integrations).

## Repository layout

```
backend/    Express 5 + Mongoose + Zod API (ESM JavaScript)
  src/services      gameEngine, loopResetService, rules, blueprintValidator, solvabilityService,
                    scenarioGenerator, geminiClient, geminiSchema, hintService, endingService, publicView, gameService
  src/repositories  mongo + in-memory (tests only) implementations of one contract
  src/data          sampleScenario.js  (hand-authored DEVELOPMENT FIXTURE)
  src/scripts       seedSample.js, verifyGemini.js
  tests/            unit + integration (Vitest, Supertest); tests/e2e/server.js is a TEST FIXTURE
frontend/   React 19 + Vite + Tailwind 4 + React Router (JavaScript)
e2e/        Real-browser checks (Playwright for Python)
spec.md  AUDIT.md
```

## Installation

Requirements: Node.js 20+, MongoDB (local or Atlas). Optional: a Gemini API key.

```bash
npm run install:all
cp backend/.env.example backend/.env      # set MONGODB_URI (and optionally GEMINI_API_KEY / GEMINI_MODEL)
cp frontend/.env.example frontend/.env    # optional; default API URL is http://localhost:5000/api/v1
npm run seed                              # store the sample scenario in MongoDB
npm run dev:backend                       # terminal 1 -> http://localhost:5000
npm run dev:frontend                      # terminal 2 -> http://localhost:5173
```

## Environment variables

| Backend variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | yes (not for `NODE_ENV=test`) | | `mongodb://` or `mongodb+srv://`. Server exits at start-up if unreachable. |
| `PORT` | no | 5000 | |
| `NODE_ENV` | no | development | `development` / `test` / `production` |
| `CLIENT_URL` | no | `http://localhost:5173` | the only allowed CORS origin |
| `GEMINI_API_KEY` | for AI generation | | server-side only; never logged |
| `GEMINI_MODEL` | for AI generation | | **no default**; use a current model id from Google's docs |
| `GEMINI_TIMEOUT_MS` | no | 45000 | hard per-attempt timeout (1000-120000) |
| `GEMINI_MAX_RETRIES` | no | 2 | extra attempts after a transient failure or an invalid scenario (0-4) |

Frontend: `VITE_API_BASE_URL` (baked in at build time; browser-visible, so never put secrets in it).
Configuration is validated at start-up; errors name the variable but never echo values.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | backend + frontend tests (no database or network needed) |
| `npm --prefix backend test` / `npm --prefix frontend test` | one side only |
| `npm run build` | production build of the frontend |
| `npm --prefix backend run verify:gemini` | dry-run check of the **real** Gemini integration (writes nothing) |
| `MONGODB_TEST_URI=mongodb://127.0.0.1:27017/timeloop_test npm --prefix backend run test:db` | repository contract tests against a real MongoDB |
| `python3 e2e/run_e2e.py` | real-browser end-to-end checks (see [e2e/README.md](e2e/README.md)) |

## Verifying the real integrations

The automated tests use a fake Gemini client and in-memory storage, because the author's environment had no access to
Google or MongoDB. **Run these once in your own environment:**

1. **Gemini**: put `GEMINI_API_KEY` and `GEMINI_MODEL` in `backend/.env`, then
   `npm --prefix backend run verify:gemini`. It checks (1) configuration, (2) credentials/model/network/JSON mode with a
   tiny request, (3) the full pipeline (prompt, Gemini, parse, Zod, semantic checks, solvability solver) against a throwaway
   in-memory sink, and (4) whether the API accepted the structured-output schema. It prints each rejected attempt's
   validator issues. Nothing is written to MongoDB. Then start the app and use **/create** for a real end-to-end run.
2. **MongoDB**: run the `test:db` command above against a disposable test database; it exercises the same contract
   tests the in-memory repository passes (compare-and-set saves, reset persistence, history ordering). Then
   `npm run seed` and play the sample.

**Tuning generation.** If attempts are rejected for the same reason repeatedly, the issue list says what the model got wrong.
Typical fixes: raise `GEMINI_MAX_RETRIES` (feedback is sent back to the model each retry), choose a stronger model, or
simplify the idea. If the API rejects the response schema the client automatically falls back to schema-less JSON mode
(validation is unchanged); `verify:gemini` reports when that happened. Provider quota exhaustion is returned as
`AI_QUOTA_EXCEEDED` and is not retried automatically; check the Gemini API quota and billing before increasing
`GEMINI_MAX_RETRIES`. Unsupported model IDs return `AI_MODEL_UNAVAILABLE`, authentication failures return
`AI_AUTH_ERROR`, and provider timeouts return `AI_TIMEOUT`. Provider error bodies and credentials are never sent to
the API client; development logs include only safe provider status metadata.

## Deployment

1. **MongoDB**: create a database (e.g. Atlas), a user with read/write on it, and allow your backend's IP.
2. **Backend** (any Node 20+ host: Render, Railway, Fly, a VM):
   * build: `cd backend && npm ci --omit=dev`; start: `npm start`
   * environment: `NODE_ENV=production`, `MONGODB_URI`, `CLIENT_URL=https://<your-frontend-origin>` (exact origin),
     `GEMINI_API_KEY`, `GEMINI_MODEL`, optionally the timeout/retry settings; the host normally provides `PORT`.
   * serve over HTTPS (host/proxy terminates TLS). Run `npm run seed` once with the production env.
   * **Request time:** generation can run for up to `(GEMINI_MAX_RETRIES + 1) x GEMINI_TIMEOUT_MS` plus solver time.
     Make sure the host/proxy request timeout is longer, or lower those settings.
   * **Single instance:** rate limits and the "one generation per session" lock are in process memory. Running several
     instances needs a shared store (e.g. Redis) for both.
   * Smoke test: `GET /api/v1/health` returns 200 with `database.status: "connected"`; then `verify:gemini`.
3. **Frontend**: `VITE_API_BASE_URL=https://<backend>/api/v1 npm --prefix frontend run build`, then deploy
   `frontend/dist` to a static host **with a single-page-app fallback** (rewrite every path to `/index.html`, otherwise
   refreshing `/game/...` returns 404).

## API (`/api/v1`)

Game and generation routes require `X-Session-Id: <uuid>`; a game belongs to the session that created it (403 otherwise).
Responses are `{ success, data }` or `{ success: false, error: { code, message } }`. Request bodies are `.strict()`.

| Route | Purpose |
|---|---|
| `GET /health` | server, database and AI-configuration status (503 when the database is down) |
| `GET /scenarios/samples` | public summaries of sample scenarios |
| `POST /scenarios` | generate a scenario with Gemini (rate limited; one at a time per session). Returns the public summary only |
| `POST /games` `{scenarioId}` | start a game (samples, or your own generated scenarios) |
| `GET /games` | this session's games (`limit` 1-50, `skip`) |
| `GET /games/:id` | current public state (resume) |
| `POST /games/:id/actions` | perform an allowlisted action (`expectedVersion` optional) |
| `POST /games/:id/reset` | explicit loop reset; returns the recap |
| `POST /games/:id/hints` `{level: 1-3}` | grounded hint (rate limited) |
| `POST /games/:id/notes` `{text}` | add a player hypothesis to the journal |
| `GET /games/:id/ending` | only when the game is over; includes the causal chain |
| `POST /games/:id/replay` | start a fresh game on the same scenario |

## How it works

* **Backend authoritative.** The client sends an action ID. The server checks location, locks, prerequisites and time, applies
  allowlisted effects, advances the clock, fires scheduled events in `(time, declaration order)`, logs everything, evaluates
  failure then victory, and saves with a compare-and-set on `stateVersion`. Finished games reject every mutation.
* **Rules are data.** Prerequisites are small tokens (`clue:x`, `!flag:y`, `char:reyes@engineering_bay`, `time_before:20:55`);
  effects are a closed set. Unknown tokens fail closed.
* **AI is an author, never an authority.** Scenario output passes: JSON parse, Zod (strict, allowlisted effects), reference
  checks, lock/flag/clue checks, relaxed reachability, and a **time-aware solver that plays the real engine** to prove a
  win exists within `maxLoops` and cannot be achieved in loop 1. Only then is it stored. Server-controlled fields (slug,
  theme, difficulty, `maxLoops`, owner) are set by the server, not trusted from the model. User prompts are wrapped as untrusted
  story text; validation, not the prompt, is the security boundary.
* **Hints and endings are composed, not generated.** Hints use blueprint names/labels, clues the player already holds, and the
  solver's route. Ending text comes from the blueprint and the recorded event log. Neither can add facts.
* **Privacy.** Public responses are whitelists (`publicView.js`); the solution guide is readable only via `/ending` after the game is over.
  Generated scenarios are playable only by the session that created them.

### Sample scenario ("Nine Minutes to Darkness")

15 in-game minutes (20:45-21:00), 5 loops max. The designed route takes 3-4 loops (spec-style: alarm, engineer, log, final run),
but the **solver shows a skilled player can win in 2 loops** (an earlier version of these docs wrongly said 3 was the minimum).
It cannot be won in loop 1 (covered by tests).

## Decisions and deviations from spec.md

* **Session ownership** uses a client-generated UUID in `X-Session-Id` (spec: "session-bound game ID", no accounts). It is a
  bearer capability; clearing site data starts a new session. Replace with real auth if accounts are added.
* **Time** is whole minutes (`HH:MM`); actions exceeding the remaining time are rejected; the loop ends at the end time and must
  be reset explicitly. Loop length: short 10 / standard 15 / long 20 minutes. Max loops: easy 6 / medium 5 / hard 4.
* **Reset order:** the loop limit is checked before incrementing, so `currentLoop` never exceeds `maxLoops`.
* **Added fields:** `stateVersion`, `loopExpired`, `lastRecap`, `hintsUsed`, `persistentState.persistentItemIds`, log `refId/turn/gameTime`.
  **Dropped:** `locations[].availableActionIds`, `clues[].discoveryCondition`.
* **Hints/ending narration are deterministic** (no Gemini calls) so they cannot add facts; the spec allows but does not require AI phrasing.
* **Failure is evaluated before victory**; the ending is available for any finished game (won or lost).
* Rate limits (per session, in memory): 6 generations / 10 min, 40 hints / 10 min.

## Known limitations

See [`AUDIT.md`](AUDIT.md) for the full list. Highlights: real Gemini and MongoDB unverified; upcoming-event preview (FR-07) not built;
re-seeding a *changed* sample scenario can break existing games that reference removed IDs (no blueprint versioning);
generation is a single long request (no background job); the event log is unbounded per game; browser testing covered Chromium only.
