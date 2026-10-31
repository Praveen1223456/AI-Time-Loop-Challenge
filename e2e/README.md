# Real-browser end-to-end checks

`run_e2e.py` drives the **built frontend** in headless Chromium against the **real Express app** over HTTP.
Storage is in-memory and Gemini is a scripted fake (`backend/tests/e2e/server.js`, a test fixture), so this verifies the UI,
routing, API contract, privacy, layout and accessibility, not MongoDB or the real Gemini API.

```bash
pip install playwright && playwright install chromium         # once
(cd /tmp && mkdir -p axe && cd axe && npm init -y && npm i axe-core)   # optional: accessibility scans
node backend/tests/e2e/server.js &                                       # API on :5055
VITE_API_BASE_URL=http://localhost:5055/api/v1 npm --prefix frontend run build -- --outDir /tmp/e2e-dist
(cd frontend && npx vite preview --outDir /tmp/e2e-dist --port 5173 --strictPort) &
python3 e2e/run_e2e.py
```

Screenshots are written to `/tmp/e2e-shots` (override with `SHOTS_DIR`). Without axe-core the accessibility scans are skipped.
