// Run after npm run build with a local Playwright installation.
// PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE accept absolute paths.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompanyTaskSummary, SubmitCompanyTask } from '../shared/companyTasks';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const artifacts = mkdtempSync(join(tmpdir(), 'company-task-ui-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.SIM_SEED = '42';
process.env.SIM_STORE_DIR = join(artifacts, 'runs');
const { app } = await import('../server/index');
const baseURL = await app.listen({ host: '127.0.0.1', port: 0 });
try {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Shake office', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Shake office' });
    await dialog.getByText('Connected', { exact: true }).waitFor();
    assert.deepEqual(await dialog.getByRole('tab').allTextContents(), ['Preset events', 'Custom event', 'Company task']);
    const customTab = dialog.getByRole('tab', { name: 'Custom event' });
    const taskTab = dialog.getByRole('tab', { name: 'Company task' });
    await customTab.click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await taskTab.getAttribute('aria-selected'), 'true');
    const input = dialog.getByRole('textbox', { name: 'Objective' });
    const submit = dialog.getByRole('button', { name: 'Queue task' });
    assert.ok(await submit.isDisabled());
    await page.keyboard.press('Tab');
    assert.ok(await input.evaluate(el => el === document.activeElement));
    await input.fill('Plan');
    assert.ok(await submit.isDisabled());
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    const objective = 'Investigate demand for a new service and plan its launch.';
    await input.fill(objective);
    await customTab.click();
    assert.ok(await input.isHidden());
    await taskTab.click();
    assert.equal(await input.inputValue(), objective);
    await page.keyboard.press('Escape');
    assert.ok(await trigger.evaluate(el => el === document.activeElement));
    await trigger.click();
    assert.equal(await input.inputValue(), objective);
    await page.screenshot({ path: join(artifacts, 'company-task-desktop.png') });
    await page.setViewportSize({ width: 375, height: 667 });
    assert.ok(await dialog.evaluate(el => {
      const box = el.getBoundingClientRect();
      const content = el.querySelector('.tool-content')!;
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
        && content.scrollWidth === content.clientWidth;
    }));
    await page.screenshot({ path: join(artifacts, 'company-task-narrow.png') });

    const requests: SubmitCompanyTask[] = [];
    await page.route('**/api/sim/company-tasks', async route => {
      requests.push(route.request().postDataJSON());
      if (requests.length > 1) return route.continue();
      return route.fulfill({ status: 503, json: { error: { code: 'storage', message: 'Task storage is temporarily unavailable.' } } });
    });
    await submit.click();
    await dialog.getByText('Task storage is temporarily unavailable.').waitFor();
    assert.equal(await input.inputValue(), objective);
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/sim/company-tasks') && r.request().method() === 'POST'),
      submit.click(),
    ]);
    assert.equal(response.status(), 202, await response.text());
    const queued: CompanyTaskSummary = await response.json();
    assert.equal(queued.objective, objective);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].run_id, queued.runId);
    assert.match(requests[0].idempotency_key, /^[\w.-]+$/);
    await dialog.getByText('Queued', { exact: true }).waitFor();
    assert.equal(await input.count(), 0);
    await page.screenshot({ path: join(artifacts, 'company-task-queued.png') });

    await page.keyboard.press('Escape');
    assert.ok(await trigger.evaluate(el => el === document.activeElement));
    const step = await page.request.post('/api/sim/step');
    assert.equal(step.status(), 200, await step.text());
    await trigger.click();
    await dialog.getByText('In progress', { exact: true }).waitFor();
    const detail = await page.request.get('/api/sim/company-tasks/' + queued.id);
    assert.ok((await detail.json()).activity.some((activity: { kind: string }) => activity.kind === 'brief'));
    assert.equal((await page.request.post('/api/sim/reset')).status(), 200);
    await input.waitFor();
    assert.equal(await input.inputValue(), '');
    assert.deepEqual(errors, []);
    console.log(`Company task browser checks passed. Screenshots in ${artifacts}`);
  } finally {
    await browser.close();
  }
} finally {
  await app.close();
}
