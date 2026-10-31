# Audit against spec.md

Statuses: **PASS** = executed and observed passing in the author's sandbox; **NOT VERIFIED** = not executed (reason given);
**FAIL** = reproduced and not fixed. The sandbox had **no access to Google's API and no MongoDB**, so anything that depends
on them is NOT VERIFIED however good the mocked tests look.

## Executed verification (final run)

| Check | Result |
|---|---|
| Backend tests (17 files) | 217 passed |
| Frontend tests (7 files) | 57 passed |
| Frontend production build | built |
| `npm audit` (backend, frontend) | 0 vulnerabilities |
| Real-browser e2e (headless Chromium, real Express app, in-memory storage, fake Gemini), run twice on fresh state | 54/54 passed both runs |
| axe-core (WCAG 2 A/AA + best practice), serious/critical | none on landing, create, game room, history, ending |
| Engine/frontend/Phase 3-5 mutation checks | every deliberate bug caught except one *equivalent* mutant (redundant `delete raw.slug`) |
| `verify:gemini` with no config / dummy key | fails clearly; real SDK accepted the request shape and failed only at the network (`fetch failed`, `ENOTFOUND`) |

## Acceptance criteria

| ID | Criterion | Status | Evidence / caveat |
|---|---|---|---|
| AC-01 | Valid prompt gives validated scenario or recoverable error | PASS (mocked) / **NOT VERIFIED (real Gemini)** | generator + API + browser tests with a scripted client |
| AC-02 | New game has correct initial state | PASS | API + browser |
| AC-03 | Invalid actions do not mutate state | PASS | unit, API, fuzz |
| AC-04 | Actions advance time by configured cost | PASS | unit, API |
| AC-05 | Scheduled events in deterministic order | PASS | unit; sort removal caught by mutation |
| AC-06 | Reset restores temporary state | PASS | unit, API, browser |
| AC-07 | Persistent clues/unlocks survive reset | PASS | unit, API, browser |
| AC-08 | Event log per loop | PASS | unit, recap via API |
| AC-09 | Resume a saved game | PASS (in-memory + simulated restart + browser) / **NOT VERIFIED (real MongoDB)** | run `test:db` |
| AC-10 | Victory/failure decided by backend | PASS | finished games reject all mutations |
| AC-11 | Private solution never returned during play | PASS | 5 fuzz seeds, API tests, 31 browser API responses + DOM scanned. Scans look for known marker strings |
| AC-12 | Ending explains outcome from established facts | PASS | text composed from blueprint + event log; no AI text |
| AC-13 | UI works on desktop and mobile | PASS in Chromium at 375/768/1280px (no overflow, tap targets >= 32px, screenshots reviewed) / **NOT VERIFIED** on real devices, Firefox, Safari |
| AC-14 | API/AI failures don't corrupt saved state | PASS for mocked AI failures and simulated DB errors / **NOT VERIFIED** for real ones |
| AC-15 | README documents setup, env, tests, deployment | PASS (content) / **NOT VERIFIED** (deployment steps never executed) |

## Other critical requirements

| Requirement | Status |
|---|---|
| Session ownership on every game endpoint | PASS (all 7 game routes tested for 403) |
| Generated scenarios private to creator | PASS |
| Duplicate submissions (server + client) | PASS (UI ref guards verified by mutation) |
| Conflicting writes (compare-and-set, `expectedVersion`) | PASS in memory repo; **NOT VERIFIED** on MongoDB |
| Malformed/invalid/hostile AI output, provider errors, timeouts | PASS (mocked; timeout is a hard backstop) |
| Input validation (strict bodies, strict integer queries, ids, headers) | PASS |
| Rate limiting (generation, hints) | PASS (per session, in memory) |
| Keyboard operation, dialog focus trap/Escape, per-page titles, reduced motion | PASS (browser) |
| Screen-reader behaviour | **NOT VERIFIED** (automated checks only) |

## Defects found during the audit

| Defect | Status |
|---|---|
| Docs claimed the sample needed >= 3 loops; solver shows 2 suffice | FIXED (docs, tests) |
| Duplicate import in `tests/helpers.js` broke native Node ESM (e2e fixture) | FIXED |
| History query accepted `0x10` / `1e1` | FIXED + regression test |
| Heading-order skip on ending page | FIXED |
| Test gaps (event sorting, input immutability, duplicate-click guards) | FIXED |

## Known gaps / risks (not fixed)

* **FR-07** upcoming-event preview not built (recent events only).
* No blueprint versioning: re-seeding a *changed* sample can break existing games that reference removed IDs.
* Generation is one long request; hosts/proxies with short timeouts will cut it off (see README).
* Rate limits and the per-session generation lock are in process memory (single instance only).
* Solver pruning is a heuristic (may reject exotic valid scenarios, never approves unsolvable ones); 20,000-state cap.
* Hints run the solver (about 0.3-0.9s); the UI disables actions meanwhile and shows no spinner.
* Player notes can be added but not deleted. Event log is unbounded per game.
* Gemini `responseJsonSchema` acceptance is unknown until `verify:gemini` is run; a schema-less fallback exists.
