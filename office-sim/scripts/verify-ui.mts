// Desktop browser acceptance checks. All API requests and streamed frames use fixtures.
// Run with Node + tsx and a locally available Playwright module; see docs/ui-overhaul-verification.md.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const artifacts = process.env.UI_ARTIFACT_DIR ?? join(tmpdir(), 'daily-grind-ui');
mkdirSync(artifacts, { recursive: true });
import { mockCast, mockHistory, mockResponse } from '../src/mocks.ts';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
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
`);
await page.route('**/api/**', route => route.fulfill({json: route.request().url().endsWith('/cast') ? mockCast : mockResponse}));
await page.goto(process.env.UI_URL ?? 'http://127.0.0.1:5173/');
await page.waitForFunction(() => (window as any).__stream?.onmessage);
await page.evaluate(data => (window as any).__stream.onmessage({data: JSON.stringify(data)}), {type:'history', ...mockResponse, history:mockHistory});
await page.waitForSelector('[data-employee]');
for (const [width,height] of [[1440,900],[1366,768],[1280,720]]) {
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

await page.setViewportSize({width:1440,height:900});
async function auditCopy() {
  const copy=await page.evaluate(() => [document.body.innerText,...Array.from(document.querySelectorAll('[title],[aria-label],[aria-valuetext]')).flatMap(el=>[el.getAttribute('title'),el.getAttribute('aria-label'),el.getAttribute('aria-valuetext')])].filter(Boolean).join('\n'));
  assert.ok(!/\bticks?\b/i.test(copy),copy);
}
await auditCopy();
for (const name of ['Simulation','Shake office','Rumour reach','Wellbeing']) {
  const trigger=page.getByRole('button',{name,exact:true});
  await trigger.click();
  const dialog=page.getByRole('dialog',{name,exact:true});
  await dialog.waitFor({state:'visible'});
  assert.equal(await page.locator('dialog[open]').count(),1);
  assert.equal(await dialog.locator('.close').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
  await page.keyboard.press('Tab');
  await auditCopy();
  if (name==='Wellbeing' || name==='Rumour reach') {
    assert.equal(await dialog.getByRole('button',{name:'Stock',exact:true}).count(),0);
    assert.equal(await dialog.locator('.stock-information').count(),0);
    await dialog.getByLabel('Reveal truth in Office wire').check();
  }
  await page.screenshot({path:join(artifacts, `grind-menu-${name.split(' ')[0]}.png`)});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await trigger.click();
  await page.mouse.click(10,400);
  assert.equal(await page.locator('dialog[open]').count(),0);
  await trigger.click();
  await page.getByRole('button',{name:`Close ${name}`,exact:true}).click();
  assert.equal(await page.locator('dialog[open]').count(),0);
}
const stockTrigger=page.getByRole('button',{name:/Open CHAOS stock chart/});
assert.equal(await stockTrigger.locator('span').innerText(),'CHAOS');
await page.evaluate(data=>(window as any).__stream.onmessage({data:JSON.stringify(data)}),{type:'state',...mockResponse,price:{...mockResponse.price,price:63.45}});
await stockTrigger.filter({hasText:'$63.45'}).waitFor({state:'visible'});
assert.ok((await stockTrigger.innerText()).includes('-36.55%'));
await stockTrigger.click();
const stockDialog=page.getByRole('dialog',{name:'CHAOS stock',exact:true});
await stockDialog.getByRole('img',{name:/Simulated stock price \$63.45/}).waitFor({state:'visible'});
await auditCopy();
await page.screenshot({path:join(artifacts,'grind-stock-graph.png')});
await page.keyboard.press('Escape');
assert.equal(await stockTrigger.evaluate(el=>el===document.activeElement),true);
await stockTrigger.focus();
await page.keyboard.press('Enter');
await page.mouse.click(10,400);
assert.equal(await page.locator('dialog[open]').count(),0);
await stockTrigger.click();
await page.getByRole('button',{name:'Close CHAOS stock',exact:true}).click();
assert.equal(await page.locator('dialog[open]').count(),0);
console.log('Icon-only left dock and live CHAOS price-to-graph checks passed');
await page.getByRole('button',{name:'Inspect Lena',exact:true}).click();
const employee=page.getByRole('dialog',{name:'Lena',exact:true});
assert.ok(await employee.getByRole('meter',{name:'Trust in management',exact:true}).isVisible());
const bounds=await employee.boundingBox();
assert.ok(bounds && bounds.width>=320 && bounds.width<=360 && bounds.x>=0 && bounds.y>=0 && bounds.y+bounds.height<=900);
await page.screenshot({path:join(artifacts, 'grind-employee.png')});
await page.keyboard.press('Tab');
assert.equal(await employee.locator('.close').evaluate(el=>el===document.activeElement),false);
await page.keyboard.press('Escape');
assert.equal(await page.getByRole('button',{name:'Inspect Lena',exact:true}).evaluate(el=>el===document.activeElement),true);
const feedTarget=page.locator('button.feed-entry').first();
await feedTarget.hover();
assert.ok(await page.locator('.station.highlighted').count()>0);
await feedTarget.click();
await page.getByRole('button',{name:'Close employee details'}).click();
await page.getByRole('button',{name:'Inspect Marcus',exact:true}).focus();
await page.keyboard.press('Enter');
assert.ok(await page.getByRole('dialog',{name:'Marcus',exact:true}).isVisible());
await page.mouse.click(10,400);
assert.equal(await page.locator('.employee-panel').count(),0);
await page.mouse.move(10,10);
await page.getByRole('button',{name:'Expand Office wire history',exact:true}).click();
assert.equal(await page.getByText(mockHistory[1].events[0].text,{exact:true}).count(),1);
assert.equal(await page.getByText(mockHistory[4].events[0].text,{exact:true}).count(),1);
await page.screenshot({path:join(artifacts, 'grind-history.png')});
await page.getByRole('button',{name:'Collapse Office wire history',exact:true}).click();
console.log('Menu, focus, inspector, history and copy checks passed');

let nextHour=7;
const makeFrame=(text:string,quit=false)=> {
  const tick=++nextHour;
  const state=structuredClone(mockResponse.state); state.tick=tick;
  const records=quit?[{...mockHistory[6].records[0],tick,quit:true,summary:'Marcus resigned.'}]:[];
  return {tick,price:{...mockResponse.price,tick},state,records,events:[{type:'merger',is_true:true,text}]};
};
const emit=async(frame:any)=>page.evaluate(data=>(window as any).__stream.onmessage({data:JSON.stringify(data)}),{...mockResponse,state:frame.state,price:frame.price,type:'tick',frame});
assert.equal(await page.locator('.announcement').count(),0,'historical announcements must not replay');
await emit(makeFrame('First new announcement',true));
assert.ok((await page.locator('.announcement').innerText()).includes('First new announcement'));
await page.clock.fastForward(9999);
assert.equal(await page.locator('.announcement').count(),1);
await page.clock.fastForward(1);
await page.locator('.announcement').waitFor({state:'hidden'});
assert.equal(await page.locator('.announcement').count(),0);
await emit(makeFrame('Second new announcement'));
await page.clock.fastForward(6000);
await emit(makeFrame('Replacement announcement'));
await page.clock.fastForward(9999);
assert.ok(await page.locator('.announcement').innerText().then(t=>t.includes('Replacement announcement')));
await page.clock.fastForward(1);
await page.locator('.announcement').waitFor({state:'hidden'});
assert.equal(await page.locator('.announcement').count(),0);
await emit(makeFrame('Dismiss this announcement'));
await page.getByRole('button',{name:'Dismiss announcement'}).click();
assert.equal(await page.locator('.announcement').count(),0);
await page.clock.fastForward(11000);
assert.equal(await page.locator('.announcement').count(),0);
await emit(makeFrame('Before reconnection'));
await page.clock.fastForward(6000);
await page.evaluate(()=>(window as any).__stream.onerror());
assert.equal(await page.getByRole('status').getByText('Connection lost',{exact:true}).count(),1);
const reconnectHistory=[...mockHistory];
await page.evaluate(data=>(window as any).__stream.onmessage({data:JSON.stringify(data)}),{type:'history',...mockResponse,state:{...mockResponse.state,tick:nextHour},history:reconnectHistory});
await page.clock.fastForward(4000);
assert.equal(await page.locator('.announcement').count(),0,'reconnection must not restart timer');
await page.evaluate(data=>(window as any).__stream.onmessage({data:JSON.stringify(data)}),{type:'history',...mockResponse,history:mockHistory});
assert.equal(await page.locator('.announcement').count(),0,'reconnection must not replay history');
nextHour=7;
await emit(makeFrame('Clear on reset'));
await page.evaluate(data=>(window as any).__stream.onmessage({data:JSON.stringify(data)}),{type:'history',...mockResponse,state:{...mockResponse.state,tick:0,started:false},history:[]});
assert.equal(await page.locator('.announcement').count(),0);
await page.clock.fastForward(11000);
assert.equal(await page.locator('.announcement').count(),0);
await page.evaluate(data=>(window as any).__stream.onmessage({data:JSON.stringify(data)}),{type:'history',...mockResponse,history:mockHistory});
nextHour=7;
await emit(makeFrame('One resignation only',true));
await page.getByRole('button',{name:'Expand Office wire history',exact:true}).click();
assert.equal(await page.getByText('Marcus resigned.',{exact:true}).count(),1);
assert.equal(await page.getByText('Resignation',{exact:true}).count(),1);
await page.getByRole('button',{name:'Collapse Office wire history',exact:true}).click();
await page.getByRole('button',{name:'Dismiss announcement'}).click();
await auditCopy();
console.log('Announcement real-time expiry, replacement, manual dismissal, reset, reconnect and resignation checks passed');

let requestBody:any;
await page.route('**/api/sim/inject',async route=>{requestBody=route.request().postDataJSON();await route.fulfill({json:mockResponse});});
await page.getByRole('button',{name:'Shake office',exact:true}).click();
await page.getByRole('button',{name:'Layoffs rumour',exact:false}).click();
await page.getByRole('button',{name:'Post announcement',exact:true}).click();
assert.deepEqual(requestBody,{type:'layoffs_rumour',is_true:false});
await page.locator('.event-feedback').filter({hasText:/^Queued for Day/}).waitFor({state:'visible'});
await auditCopy();
await page.route('**/api/sim/inject',route=>route.fulfill({status:409,json:{error:{code:'tick_in_progress',message:'A tick is already running.'}}}));
await page.getByRole('button',{name:'Post announcement',exact:true}).click();
await page.locator('.event-feedback').filter({hasText:'An hour is already running.'}).waitFor({state:'visible'});
await auditCopy();
await page.keyboard.press('Escape');
console.log('Composer presets, truth selection, successful submission and error copy checks passed');
const requests: Array<{path:string;body:unknown}>=[];
await page.route('**/api/sim/*',async route=>{
 const request=route.request();
 if (request.method()!=='POST') return route.fallback();
 requests.push({path:new URL(request.url()).pathname,body:request.postData()?request.postDataJSON():null});
 await route.fulfill({json:mockResponse});
});
await page.getByRole('button',{name:'Simulation',exact:true}).click();
await page.getByRole('button',{name:'32 hours',exact:true}).click();
await page.getByRole('button',{name:'Advance one hour',exact:true}).click();
await page.getByRole('button',{name:'Reset run',exact:true}).click();
await page.getByRole('button',{name:'New run',exact:true}).click();
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'2×',exact:true}).click();
await page.getByRole('button',{name:'Play',exact:true}).click();
assert.ok(requests.some(request=>request.path==='/api/sim/settings'&&(request.body as any).max_ticks===32));
assert.ok(requests.some(request=>request.path==='/api/sim/step'));
assert.ok(requests.some(request=>request.path==='/api/sim/reset'));
assert.ok(requests.some(request=>request.path==='/api/sim/new-seed'));
assert.ok(requests.some(request=>request.path==='/api/sim/speed'&&(request.body as any).speed===2));
assert.ok(requests.some(request=>request.path==='/api/sim/play'));
console.log('Duration, advance, reset, new-run, speed and playback endpoint wiring checks passed');
const longFrame=makeFrame('Long-content verification');
longFrame.records=[{...mockHistory[6].records[7],tick:longFrame.tick,public_line:'Detailed statement. '.repeat(300),inner_monologue:'Recorded thought. '.repeat(300)}] as any;
await emit(longFrame);
await page.getByRole('button',{name:'Inspect Lena',exact:true}).click();
const scroller=page.locator('.employee-content');
assert.ok(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight && el.scrollWidth<=el.clientWidth));
await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
assert.ok(await scroller.evaluate(el=>el.scrollTop>0));
await auditCopy();
await page.keyboard.press('Escape');
console.log('Feed highlighting, keyboard character selection, employee dismissal and long-content scrolling checks passed');
console.log({errors});
assert.deepEqual(errors,[]);
await browser.close();
