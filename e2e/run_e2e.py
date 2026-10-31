"""
Real-browser end-to-end checks (headless Chromium via Playwright).

Prereqs (see README "Verification"): the API fixture on :5055 and the frontend build served on :5173.
    node backend/tests/e2e/server.js &
    VITE_API_BASE_URL=http://localhost:5055/api/v1 npx --prefix frontend vite build --outDir /tmp/e2e-dist
    npx --prefix frontend vite preview --outDir /tmp/e2e-dist --port 5173 --strictPort &
    python3 e2e/run_e2e.py
Optional: AXE_PATH=/path/to/axe.min.js enables accessibility scans.
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
AXE = os.environ.get("AXE_PATH", "/tmp/axe/node_modules/axe-core/axe.min.js")
SHOTS = os.environ.get("SHOTS_DIR", "/tmp/e2e-shots")
PRIVATE = ["solutionGuide", "causalChain", "requiredClueIds", "winConditions", "failureConditions",
           "prerequisites", "loopFlags", "Reyes' firmware 2.3.1 update disabled"]
os.makedirs(SHOTS, exist_ok=True)
results, api_log, console_errors = [], [], []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

def btn(page, pattern):
    return page.get_by_role("button", name=re.compile(pattern))

def clock(page): return page.get_by_test_id("clock").inner_text().strip()
def loop(page): return page.get_by_test_id("loop-indicator").inner_text().replace("\n", " ").strip()

def act(page, label, expect_clock=None):
    btn(page, rf"^{re.escape(label)}").click()
    if expect_clock: page.wait_for_function("(t) => document.querySelector('[data-testid=clock]')?.textContent.trim() === t", arg=expect_clock, timeout=5000)

def new_page(ctx):
    page = ctx.new_page()
    page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: console_errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    def tap(route):
        resp = route.fetch()
        body = resp.text()
        api_log.append((route.request.method, route.request.url, resp.status, body))
        route.fulfill(response=resp)
    page.route("**/api/v1/**", tap)
    return page

def axe_scan(page, label):
    if not os.path.exists(AXE):
        results.append((f"axe: {label}", None, "axe-core not available")); print(f"SKIP axe: {label}"); return
    page.add_script_tag(path=AXE)
    res = page.evaluate("() => axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']})")
    serious = [v for v in res["violations"] if v["impact"] in ("serious", "critical")]
    minor = [v for v in res["violations"] if v["impact"] not in ("serious", "critical")]
    check(f"axe (serious/critical) on {label}", not serious,
          "; ".join(f'{v["id"]} x{len(v["nodes"])}' for v in serious))
    if minor: print(f"     note: {label} minor/moderate: " + ", ".join(f'{v["id"]}({v["impact"]})' for v in minor))

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = new_page(ctx)

    # ---- Landing -----------------------------------------------------------------
    page.goto(BASE)
    page.get_by_role("heading", name="Break the loop.").wait_for()
    page.get_by_text("Nine Minutes to Darkness").first.wait_for(timeout=10000)  # wait: the list loads asynchronously
    check("landing: sample scenario card loaded from the real API", page.get_by_text("Nine Minutes to Darkness").first.is_visible())
    check("landing: 'Start a Time Loop' link goes to /create", page.get_by_role("link", name="Start a Time Loop").get_attribute("href") == "/create")
    check("landing: How to Play section present", page.get_by_role("heading", name="How to play").is_visible())
    page.get_by_text("Connected", exact=True).wait_for()
    axe_scan(page, "landing")
    page.screenshot(path=f"{SHOTS}/desktop-home.png", full_page=True)

    check("landing: descriptive page title", page.title() == "Break the loop · AI Time-Loop Challenge", page.title())

    # ---- Start sample game ---------------------------------------------------------
    btn(page, "Play this scenario").click()
    page.wait_for_url(re.compile(r"/game/[^/]+$"))
    game_url = page.url
    page.get_by_test_id("clock").wait_for()
    check("game: starts at loop 1 of 5, 20:45, 15 min left",
          loop(page) == "1 of 5" and clock(page) == "20:45" and "15 min" in page.get_by_test_id("remaining").inner_text())
    check("game: page title names the scenario and loop", page.title().startswith("Nine Minutes to Darkness: loop 1"), page.title())
    check("game: objective visible", page.get_by_text("Stop the blackout", exact=False).count() + page.get_by_text("Find out why Helios-7", exact=False).count() > 0)

    # ---- Actions: duplicate clicks, keyboard --------------------------------------
    btn(page, r"^Inspect the control panel").dblclick()
    page.wait_for_function("() => document.querySelector('[data-testid=clock]').textContent.trim() !== '20:45'")
    page.wait_for_timeout(400)
    check("double-click performs the action exactly once (clock 20:46, not 20:47)", clock(page) == "20:46", clock(page))
    check("clue card appears after inspecting", page.get_by_text("The silenced alarm").first.is_visible())
    page.get_by_text("Remembered").first.wait_for()

    wait_btn = btn(page, r"^Wait one minute")
    wait_btn.focus(); page.keyboard.press("Enter")
    page.wait_for_function("() => document.querySelector('[data-testid=clock]').textContent.trim() === '20:47'")
    check("keyboard: focus + Enter performs an action", clock(page) == "20:47")

    # ---- Hints, notes --------------------------------------------------------------
    btn(page, r"^Hint 1").click()
    page.get_by_text(re.compile(r"Hint 1:")).wait_for()
    btn(page, r"^Hint 3").click()
    page.get_by_text(re.compile(r"Hint 3: Next step")).wait_for()
    check("hints: level 1 and 3 shown, grounded in game text", page.get_by_text(re.compile(r"Hint 3: Next step: ")).is_visible())
    page.get_by_label("Add a note").fill("Maybe Reyes silenced the alarm?")
    btn(page, r"^Save note").click()
    page.get_by_text("Maybe Reyes silenced the alarm?").wait_for()
    check("journal: note saved under 'Your hypotheses', labelled as not confirmed", page.get_by_text("not confirmed facts").is_visible())

    # ---- Inventory/timeline tabs ---------------------------------------------------
    page.get_by_role("tab", name=re.compile("Inventory")).click()
    check("inventory: empty state", page.get_by_text("You are carrying nothing").is_visible())
    page.get_by_role("tab", name=re.compile("Timeline")).click()
    page.get_by_role("tab", name=re.compile("Journal")).click()
    axe_scan(page, "game room (active)")
    page.screenshot(path=f"{SHOTS}/desktop-game.png", full_page=True)

    # ---- Reset + recap -------------------------------------------------------------
    btn(page, r"^Reset the loop").click()
    btn(page, r"^Yes, reset").click()
    dialog = page.get_by_role("dialog")
    dialog.wait_for()
    check("recap dialog opens with a title and focus inside it", "Loop 1 recap" in dialog.inner_text() and page.evaluate("() => document.querySelector('[role=dialog]').contains(document.activeElement)"))
    for _ in range(4): page.keyboard.press("Tab")
    check("recap dialog traps focus (Tab cycles inside)", page.evaluate("() => document.querySelector('[role=dialog]').contains(document.activeElement)"))
    page.keyboard.press("Escape")
    page.wait_for_selector("[role=dialog]", state="detached")
    check("recap closes on Escape; loop 2, clock reset to 20:45", loop(page) == "2 of 5" and clock(page) == "20:45", f"{loop(page)} {clock(page)}")
    check("persistent clue survives the reset (journal shows 1 clue)", page.get_by_role("tab", name=re.compile(r"Journal \(1\)")).is_visible())
    check("note survives the reset", page.get_by_text("Maybe Reyes silenced the alarm?").is_visible())

    # ---- Play through to victory (route found by the solver) --------------------------
    for label, t in [("Go to the Engineering Bay", "20:47"), ("Ask Reyes about the silenced alarm", "20:49"),
                     ("Go to the Maintenance Corridor", "20:51"), ("Read the maintenance log", "20:52")]:
        act(page, label, t)
    check("loop 2: restricted location + log reachable thanks to knowledge from loop 1", page.get_by_text("Confirmed facts (1)").is_visible())
    btn(page, r"^Reset the loop").click(); btn(page, r"^Yes, reset").click()
    page.get_by_role("dialog").wait_for(); page.keyboard.press("Escape")
    check("loop 3 reached", loop(page) == "3 of 5")
    for label, t in [("Go to the Engineering Bay", "20:47"), ("Ask Reyes about the silenced alarm", "20:49"), ("Go to the Reactor Hall", "20:52")]:
        act(page, label, t)
    btn(page, r"^Run the R-7 revert procedure").click()
    page.wait_for_url(re.compile(r"/ending$"))
    page.get_by_role("heading", level=1, name="The Lights Stay On").wait_for()
    check("victory: server decides, UI navigates to the ending", True)
    play_log_end = len(api_log)

    # ---- Ending ------------------------------------------------------------------
    check("ending: grounded summary", "You broke the loop in 3 loops" in page.get_by_test_id("summary").inner_text() and "using 2 hints" in page.get_by_test_id("summary").inner_text(), page.get_by_test_id("summary").inner_text())
    check("ending: causal chain + found/missed clues shown", page.get_by_role("heading", name="What really happened").is_visible() and page.get_by_role("heading", name="Clues you missed").is_visible())
    axe_scan(page, "ending")
    page.screenshot(path=f"{SHOTS}/desktop-ending.png", full_page=True)
    ending_url = page.url

    # finished game can't be modified from the game page
    page.goto(game_url)
    page.get_by_text("This game has ended.").first.wait_for()
    check("finished game: no action buttons offered, link to the ending", btn(page, r"^Wait one minute").count() == 0 and page.get_by_role("link", name="See the ending").is_visible())

    # ---- Replay --------------------------------------------------------------------
    page.goto(ending_url)
    btn(page, "Play again").click()
    page.wait_for_url(re.compile(r"/game/[^/]+$"))
    page.get_by_test_id("clock").wait_for()
    check("replay: brand-new game at loop 1 with an empty journal", loop(page) == "1 of 5" and page.get_by_text("No clues yet").is_visible() and page.url != game_url)

    # ---- History -------------------------------------------------------------------
    page.goto(f"{BASE}/history")
    page.get_by_text("Won").wait_for()
    check("history: finished and in-progress games listed with status", page.get_by_text("Won").is_visible() and page.get_by_text("In progress").is_visible())
    axe_scan(page, "history")
    page.get_by_role("link", name="Resume").click()
    page.wait_for_url(re.compile(r"/game/[^/]+$")); page.get_by_test_id("clock").wait_for()
    check("history: Resume reopens the saved game", loop(page) == "1 of 5")

    # ---- Create (validation + generation) --------------------------------------------
    page.goto(f"{BASE}/create")
    page.get_by_label("Your idea").fill("too short")
    btn(page, "Generate and play").click()
    page.get_by_text(re.compile("at least 30 characters")).wait_for()
    check("create: short prompt rejected client-side with a clear message", "/create" in page.url)
    axe_scan(page, "create form")
    # failure path: the fixture returns malformed JSON for this idea; the UI must show a recoverable error
    page.get_by_label("Your idea").fill("A museum will be robbed at midnight and I keep waking up early [[fail]]")
    btn(page, "Generate and play").click()
    page.get_by_role("alert").wait_for(timeout=20000)
    check("create: invalid AI output shows a friendly, recoverable error", "couldn't build a playable scenario" in page.get_by_role("alert").inner_text()
          and page.get_by_role("button", name="Generate and play").is_enabled() and "[[fail]]" in page.get_by_label("Your idea").input_value())
    page.get_by_label("Your idea").fill("A museum will be robbed at midnight and I keep waking up an hour before it happens.")
    page.get_by_label("Theme").select_option("mystery"); page.get_by_label("Difficulty").select_option("hard"); page.get_by_label("Loop length").select_option("long")
    btn(page, "Generate and play").click()
    page.get_by_text(re.compile("Writing and checking")).wait_for()
    check("create: progress shown and form disabled while generating", page.get_by_label("Your idea").is_disabled())
    page.wait_for_url(re.compile(r"/game/[^/]+$"), timeout=20000)
    page.get_by_test_id("clock").wait_for()
    check("create: generated scenario opens in the game room under its AI-authored title", "The Midnight Heist (fixture)" in page.locator("header[aria-label='Game status']").inner_text())

    # ---- Not found -----------------------------------------------------------------
    page.goto(f"{BASE}/nope"); check("unknown route shows a not-found page", page.get_by_role("heading", name="Page not found").is_visible())

    # ---- Private data scan (all active-play API traffic) --------------------------------
    leaks = []
    for method, url, status, body in api_log:
        if url.endswith("/ending"): continue  # the causal chain is allowed here: the game is over
        for s in PRIVATE:
            if s in body: leaks.append(f"{s} in {method} {url}")
    check(f"private solution data never sent during play ({len(api_log)} API responses scanned)", not leaks, "; ".join(leaks[:3]))
    page_text = page.content()
    check("private strings absent from the rendered DOM", not any(s in page_text for s in PRIVATE))

    # ---- Session isolation -----------------------------------------------------------
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 900}); other = new_page(ctx2)
    other.goto(game_url)
    other.get_by_role("alert").wait_for()
    check("another browser session cannot open someone else's game (403 message shown)", "different browser session" in other.get_by_role("alert").inner_text())
    other.goto(f"{BASE}/history"); other.get_by_text("No games yet").wait_for()
    check("another browser session sees an empty history", other.get_by_text("No games yet").is_visible())
    ctx2.close()

    # ---- Responsive --------------------------------------------------------------------
    for name, (w, h) in {"mobile": (375, 812), "tablet": (768, 1024)}.items():
        c = browser.new_context(viewport={"width": w, "height": h}); mp = new_page(c)
        mp.goto(BASE); mp.get_by_role("button", name="Play this scenario").click()
        mp.wait_for_url(re.compile(r"/game/[^/]+$")); mp.get_by_test_id("clock").wait_for()
        mp_game = mp.url
        for label, url in [("home", BASE), ("game", mp_game), ("create", BASE + "/create"), ("history", BASE + "/history")]:
            mp.goto(url); mp.wait_for_load_state("networkidle")
            over = mp.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            check(f"{name} {w}px: no horizontal overflow on {label}", over <= 1, f"overflow {over}px")
        mp.goto(mp_game); mp.get_by_test_id("clock").wait_for()
        heights = mp.evaluate("() => [...document.querySelectorAll('button')].map(b => b.getBoundingClientRect()).filter(r => r.width > 0).map(r => Math.round(r.height))")
        check(f"{name}: tap targets at least 32px tall", min(heights) >= 32, f"min {min(heights)}px")
        btn(mp, r"^Inspect the control panel").click(); mp.wait_for_timeout(300)
        check(f"{name}: actions usable (clue appears)", mp.get_by_text("The silenced alarm").first.is_visible())
        mp.screenshot(path=f"{SHOTS}/{name}-game.png", full_page=True)
        c.close()

    # The browser logs failed HTTP loads as console errors. Two are caused ON PURPOSE above (502 from the
    # deliberate AI-failure test, 403 from the other-session test); anything else is a real problem.
    expected = [e for e in console_errors if re.search(r"status of (502|403)", e)]
    unexpected = [e for e in console_errors if e not in expected]
    print(f"     note: {len(expected)} expected console error(s) from deliberate 502/403 tests")
    check("no unexpected console errors or uncaught exceptions during the whole run", not unexpected, "; ".join(unexpected[:3]))
    browser.close()

failed = [r for r in results if r[1] is False]
print(f"\n{sum(1 for r in results if r[1])} passed, {len(failed)} failed, {sum(1 for r in results if r[1] is None)} skipped")
sys.exit(1 if failed else 0)
