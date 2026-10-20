#!/usr/bin/env python3
"""
Headless end-to-end check of DAOD in a real browser (Chromium, software WebGL).

    npm run demo &                         # or: npm start (demo mode without a key)
    pip install playwright && python3 -m playwright install chromium
    python3 tests/e2e.py [http://localhost:8787]

It types a question, lets a lesson play (silent voice, sped up), then fakes
speech events to check the barge-in rules: echo is ignored, "okay" resumes,
a real question interrupts and gets answered. Screenshots go to tests/__shots__/.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
SHOTS = os.path.join(os.path.dirname(__file__), '__shots__')
os.makedirs(SHOTS, exist_ok=True)
ok = True

def check(cond, msg):
    global ok
    print(('  ✓ ' if cond else '  ✗ ') + msg)
    ok = ok and cond

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE + '/?voice=silent&speed=1.5', wait_until='networkidle')
    state = lambda: pg.evaluate('window.__daod.conductor.state')
    hear = lambda kind, text: pg.evaluate(f"window.__daod.ears.dispatchEvent(new CustomEvent('{kind}', {{detail: {{text: {json.dumps(text)}}}}}))")

    print('lesson')
    pg.fill('#q', 'solve x^2 - x - 6 = 0')
    pg.press('#q', 'Enter')
    time.sleep(2.5)
    check(state() == 'speaking', 'starts speaking')
    m = pg.evaluate('window.__daod.conductor.metrics')
    check(0 < m['firstWordMs'] < 3000, f"first word after {m['firstWordMs']:.0f} ms")

    print('barge-in')
    said = pg.evaluate('window.__daod.conductor.current.beat.say')
    hear('partial', ' '.join(said.split()[:4]))
    check(state() == 'speaking', 'its own voice (echo) does not interrupt')
    hear('partial', 'okay')
    check(state() == 'speaking', '"okay" does not interrupt')
    hear('partial', 'wait why')
    check(state() == 'paused', '"wait why" takes the floor')
    hear('final', 'okay')
    time.sleep(0.2)
    check(state() in ('speaking', 'thinking'), '"okay" afterwards resumes the lesson')
    time.sleep(1.0)
    hear('partial', 'hang on why minus three')
    hear('final', 'hang on, why is it minus three and two?')
    time.sleep(1.0)
    check(pg.evaluate('window.__daod.conductor.history.some(h => h.content.startsWith("hang on"))'), 'the question is sent as an interruption')
    for _ in range(120):
        if state() == 'idle': break
        time.sleep(0.5)
    check(state() == 'idle', 'lesson finishes')
    check(pg.evaluate('window.__daod.board.items.size') > 8, 'the board is full of maths')
    pg.screenshot(path=os.path.join(SHOTS, 'final.png'))
    check(not errors, 'no page errors' + (f': {errors}' if errors else ''))
    b.close()

print('PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
