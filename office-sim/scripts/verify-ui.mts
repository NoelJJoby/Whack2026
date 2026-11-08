// Desktop browser acceptance checks. All API requests and streamed frames use fixtures.
// Run with Node + tsx and a locally available Playwright module; see docs/ui-overhaul-verification.md.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const artifacts = process.env.UI_ARTIFACT_DIR ?? join(tmpdir(), 'agentic-chaos-ui');
mkdirSync(artifacts, { recursive: true });
import { mockCast, mockHistory, mockResponse } from '../src/mocks.ts';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.clock.install({time:new Date('2026-11-07T12:00:00Z')});
await page.clock.pauseAt(new Date('2026-11-07T12:00:01Z'));
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(`
  window.EventSource = class {
    onmessage = null;
    onerror = null;
    constructor() { window.__stream = this; }
    close() {}
  };
  // Record every babble syllable: starts, and stops with their fade length in seconds.
  window.__audio = [];
  const source = AudioBufferSourceNode.prototype, start = source.start, stop = source.stop;
  window.__sounding = 0;
  source.start = function (...args) {
    window.__audio.push({ ev: 'start' }); window.__sounding++;
    this.addEventListener('ended', () => window.__sounding--);
    return start.apply(this, args);
  };
  source.stop = function (...args) { window.__audio.push({ ev: 'stop', fade: (args[0] ?? 0) - this.context.currentTime }); return stop.apply(this, args); };
`);
await page.route('**/api/**', route => route.fulfill({json: route.request().url().endsWith('/cast') ? mockCast : mockResponse}));
await page.goto(process.env.UI_URL ?? 'http://127.0.0.1:5173/');
await page.waitForFunction(() => (window as any).__stream?.onmessage);
await page.evaluate(data => (window as any).__stream.onmessage({data: JSON.stringify(data)}), {type:'history', ...mockResponse, history:mockHistory});
await page.waitForSelector('[data-employee]');
for (const [width,height] of [[1920,1080],[1440,900],[1366,768],[1280,720]]) {
  await page.setViewportSize({width,height});
  await page.screenshot({path:join(artifacts, `grind-${width}x${height}.png`)});
  const result = await page.evaluate(() => ({
    viewport:[innerWidth,innerHeight], page:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
    targets:Array.from(document.querySelectorAll<HTMLElement>('[data-employee]')).map(el => {
      const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {name:el.getAttribute('aria-label'),bounds:[r.x,r.y,r.width,r.height],clickable:!!top && (el===top || el.contains(top)),inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};
    })
  }));
  console.log(JSON.stringify({size:`${width}x${height}`,...result}));
  const dock=page.getByRole('navigation',{name:'Office tools'});
  const dockBox=await dock.boundingBox();
  assert.ok(dockBox && dockBox.x===24 && Math.abs(dockBox.y+dockBox.height/2-height/2)<1);
  assert.equal(await dock.getByRole('button').count(),4);
  assert.equal((await dock.innerText()).trim(),'');
  const stockBox=await page.locator('.stock-ticker').boundingBox();
  assert.ok(stockBox && stockBox.y===24 && stockBox.x+stockBox.width===width-24);
  assert.deepEqual(result.page,result.viewport);
  assert.equal(result.targets.length,8);
  assert.ok(result.targets.every(t=>t.clickable&&t.inside),`targets obscured at ${width}x${height}`);
  for (const target of await page.locator('[data-employee]').all()) {
    await target.click();
    const inspector=page.getByRole('dialog',{name:/Marcus|Priya|Sam|Dan|Jess|Tom|Ravi|Lena/});
    assert.ok(await inspector.isVisible());
    const box=await inspector.boundingBox();
    assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=height);
    await page.keyboard.press('Escape');
  }
  for (const name of ['Simulation','Shake office','Rumour reach','Wellbeing']) {
    await page.getByRole('button',{name,exact:true}).click();
    const dialog=page.getByRole('dialog',{name,exact:true});
    const box=await dialog.boundingBox();
    assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=height);
    assert.ok(await dialog.locator('.tool-content').evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.keyboard.press('Escape');
  }
}

// Playback acceptance: a deterministic stream and controlled browser clock.
const base = mockHistory.at(-1)!;
const acknowledgements: number[] = [];
await page.route('**/api/sim/presented', async route => {
  acknowledgements.push(route.request().postDataJSON().tick);
  await route.fulfill({ json: mockResponse });
});
let playbackSpeed = 1;
const send = (frame: any) => page.evaluate(data => (window as any).__stream.onmessage({ data: JSON.stringify(data) }), { ...mockResponse, speed: playbackSpeed, type: 'tick', frame, state: frame.state, price: frame.price });
const replace = (frames: any[]) => page.evaluate(data => (window as any).__stream.onmessage({ data: JSON.stringify(data) }), { ...mockResponse, type: 'history', history: frames, state: frames.at(-1)?.state ?? { ...mockResponse.state, tick: 0, started: false }, price: frames.at(-1)?.price ?? mockResponse.price });
function fixture(tick: number, text: string, price = 100) {
  const frame = structuredClone(base); frame.tick = tick; frame.state.tick = tick; frame.price.tick = tick; frame.price.price = price;
  frame.state.running = true; frame.events = [];
  for (const agent of Object.values(frame.state.agents)) { agent.present = true; agent.status = 'active'; }
  frame.records = [{ ...base.records[0], tick, summary: text, public_line: text, inner_monologue: 'The deadline needs care.' }];
  return frame;
}
const clock = () => page.locator('.clock-readout strong').innerText();
const next = async () => { await page.getByRole('button', { name: 'Next line', exact: true }).click(); await page.waitForTimeout(20); };
const skip = async () => { await page.getByRole('button', { name: 'Skip round', exact: true }).click(); await page.clock.runFor(1); await page.waitForTimeout(20); };
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
await replace([]);
await page.waitForFunction(() => document.querySelector('.clock-readout strong')?.textContent === '08:00');
const first = fixture(1, 'First hour needs a client review.', 101);
const second = fixture(2, 'Second hour changes the delivery plan.', 102);
await send(first);
await page.locator('.dialogue-bar.open').waitFor();
await page.getByRole('button', { name: 'Auto advance', exact: true }).click();
assert.equal(await clock(), '09:00');
await page.getByRole('button', { name: 'Expand Office wire history', exact: true }).click();
await send(second);
await page.waitForTimeout(50);
assert.equal(await clock(), '09:00', 'lookahead cannot move the clock');
assert.ok(!(await page.locator('.office-wire').innerText()).includes('Second hour changes'), 'lookahead cannot update the wire');
assert.ok((await page.locator('.stock-ticker').innerText()).includes('101.00'), 'price stays on presented hour');
await page.getByRole('button', { name: 'Inspect Marcus', exact: true }).click();
const before = await page.locator('.employee-panel').innerText();
await page.clock.runFor(5000);
assert.equal(await page.locator('.employee-panel').innerText(), before, 'a menu does not advance playback');
await page.keyboard.press('Escape');
await skip();
assert.equal(await clock(), '11:00', 'one Skip advances exactly one hour');
assert.ok((await page.locator('.office-wire').innerText()).includes('Second hour changes'));
assert.ok((await page.locator('.stock-ticker').innerText()).includes('102.00'));
await skip();
await send(fixture(3, 'Third hour.'));
await page.locator('.dialogue-bar.open').waitFor();
await next(); await next(); await page.clock.runFor(1);
assert.equal(await page.locator('.dialogue-bar.open').count(), 0, 'Next on the last line completes the round');
assert.ok(acknowledgements.includes(1) && acknowledgements.includes(2) && acknowledgements.includes(3));

// At 17:00, leavers grey out only after their current round; late workers remain.
const afternoon = fixture(4, 'Afternoon baseline.');
await replace([afternoon]);
const close = fixture(5, 'Finishing the regular shift.');
close.state.agents.marcus.present = false;
await send(close); await page.locator('.dialogue-bar.open').waitFor();
assert.equal(await page.locator('.o3-person.off-shift[data-employee="marcus"]').count(), 0);
await skip();
await page.locator('.o3-person.off-shift[data-employee="marcus"]').waitFor();
assert.ok((await page.locator('.o3-person small').allTextContents()).includes('Left for the day'));
const late = fixture(6, 'Still working on the client review.');
late.state.agents.marcus.present = false;
await send(late); await page.locator('.dialogue-bar.open').waitFor();
assert.ok((await page.locator('.o3-person small').allTextContents()).includes('Working late'));
await skip();

// Shared announcements are narrated first; the banner follows the presented frame.
const seven = fixture(7, 'Please review the access plan.');
seven.events = [{ type: 'pr_scandal', text: 'A customer data breach was disclosed.', is_true: true }];
await send(seven);
await page.locator('.dialogue-bar.open.narrator').waitFor();
assert.equal(await page.locator('.dialogue-portrait').count(), 0, 'narrator has no portrait');
assert.equal(await page.locator('.o3-bubble.speech').count(), 0, 'narrator has no employee speech bubble');
assert.ok((await page.locator('.announcement').innerText()).includes('customer data breach'));
const end = fixture(8, 'The last review is finished.');
for (const agent of Object.values(end.state.agents)) agent.present = false;
end.day_report = { day: 1, lines: ['No announcements today.', 'Everyone has gone home.'], fillerDays: [2, 3] };
await send(end);
assert.equal(await clock(), '21:00');
await skip();
await page.locator('.dialogue-bar.open:not(.narrator)').waitFor();
assert.equal(await clock(), '23:00');
await next(); await next();
await page.locator('.dialogue-bar.open.narrator').waitFor();
assert.equal(await page.locator('.o3-person.off-shift').count(), 8, 'everyone leaves before the report');
await page.screenshot({ path: join(artifacts, 'reactive-day-report.png') });
assert.ok((await page.locator('.dialogue-public').textContent() ?? '').includes('Day 1 report'));
await next(); await next(); // second report line
await next(); await next(); // filler day 2
assert.ok((await page.locator('.clock-readout').innerText()).includes('Day 2'));
assert.ok((await page.locator('.dialogue-public').textContent() ?? '').includes('routine day'));
await next(); await next(); // filler day 3
assert.ok((await page.locator('.clock-readout').innerText()).includes('Day 3'));
await next(); await next(); await page.clock.runFor(1); await page.waitForTimeout(30);
assert.ok((await page.locator('.clock-readout').innerText()).includes('Day 3'), 'clock keeps the last filler day');
await send(fixture(9, 'Back in the office.'));
await page.locator('.dialogue-bar.open').waitFor();
assert.equal(await clock(), '09:00');
assert.equal(await page.locator('.o3-person.off-shift').count(), 0, 'everyone returns the next morning');

// Reconnect/reset jumps to the latest snapshot without replaying narration.
await replace([first, second, seven, end]);
await page.locator('.dialogue-bar:not(.open)').waitFor();
assert.equal(await page.locator('.announcement').count(), 0);
assert.equal(await clock(), '23:00');
await replace([]);
await page.waitForFunction(() => document.querySelector('.clock-readout strong')?.textContent === '08:00');
assert.equal(await page.locator('.announcement').count(), 0);
console.log('Presentation cursor, queued hours, Skip/Next, presence, narrator, reports, filler-day clock and reconnect checks passed');

// Quiet hours dwell at the selected speed, and Auto still waits for typing.
await page.route('**/api/sim/speed', async route => route.fulfill({ json: { ...mockResponse, state: { ...mockResponse.state, tick: 0 }, speed: route.request().postDataJSON().speed } }));
await page.getByRole('button', { name: '4×', exact: true }).click();
await page.waitForFunction(() => document.querySelector('.speed-controls button[aria-pressed="true"]')?.textContent === '4×');
playbackSpeed = 4;
const quiet = fixture(1, ''); quiet.records = [];
await send(quiet); await page.waitForTimeout(20); await send(second);
assert.equal(await clock(), '09:00');
await page.clock.runFor(299); assert.equal(await clock(), '09:00');
await page.clock.runFor(2); await page.waitForTimeout(30); assert.equal(await clock(), '11:00');
await page.getByRole('button', { name: 'Auto advance', exact: true }).click();
await page.clock.runFor(100); assert.equal(await clock(), '11:00', 'Auto cannot skip typing');
await page.clock.runFor(10000); await page.waitForTimeout(30);
assert.equal(await page.locator('.dialogue-bar.open').count(), 0);

// Keyboard guards and focus behavior remain intact.
await replace(mockHistory);
await page.getByRole('button', { name: 'Simulation', exact: true }).click();
assert.equal(await page.getByLabel('Hold for dialogue').count(), 0);
await page.keyboard.press('Escape');
for (const name of ['Simulation', 'Shake office', 'Rumour reach', 'Wellbeing']) {
  const trigger = page.getByRole('button', { name, exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  assert.equal(await dialog.locator('.close').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
}
await page.screenshot({ path: join(artifacts, 'reactive-playback.png') });
console.log({ errors }); assert.deepEqual(errors, []);
await browser.close();
