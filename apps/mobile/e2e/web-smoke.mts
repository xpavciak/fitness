/**
 * End-to-end smoke test of the exported web build (`pnpm build` first).
 * Serves `dist/` with a tiny static server (SPA fallback) and drives Chromium with
 * playwright-core: onboarding -> plan -> log a set -> progress, plus the PAR-Q+ block,
 * rescheduling, the minimum dose, export and delete.
 *
 * Browsers: uses PLAYWRIGHT_BROWSERS_PATH (defaults to /opt/pw-browsers when it exists);
 * this script never downloads browsers. Set E2E_SCREENSHOTS=<dir> to save screenshots.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';

const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const PRESET_BROWSERS = '/opt/pw-browsers';
if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync(PRESET_BROWSERS)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = PRESET_BROWSERS;
}
// Imported after the env var is set: playwright-core reads it when it resolves browsers.
const { chromium } = await import('playwright-core');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
};

function serve(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const candidate = normalize(join(root, pathname));
    const inside = candidate.startsWith(root);
    const file =
      inside && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(root, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolveServer({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const steps: string[] = [];
function step(name: string): void {
  steps.push(name);
  console.log(`- ${name}`);
}

const SCREENSHOTS = process.env.E2E_SCREENSHOTS;
async function snap(page: Page, name: string): Promise<void> {
  if (SCREENSHOTS !== undefined && SCREENSHOTS !== '') {
    await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`), fullPage: true });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function completeOnboarding(page: Page, opts: { parqYes?: boolean } = {}): Promise<void> {
  await page.getByTestId('onboarding-about').waitFor();
  await page.getByTestId('birth-year').fill('1990');
  await page.getByTestId('equipment-dumbbells').click();
  await page.getByTestId('equipment-bench').click();
  await page.getByTestId('onboarding-next').click();

  await page.getByTestId('onboarding-schedule').waitFor();
  await page.getByTestId('slot-time-mon').fill('07:30');
  await page.getByTestId('location').fill('Gym near work');
  await page.getByTestId('onboarding-next').click();

  await page.getByTestId('onboarding-health').waitFor();
  await snap(page, opts.parqYes ? 'blocked-health' : 'onboarding-health');
  const noButtons = page.locator('[data-testid^="parq-"][data-testid$="-no"]');
  const count = await noButtons.count();
  assert(count === 7, `expected 7 PAR-Q+ questions, found ${count}`);
  for (let i = 0; i < count; i += 1) {
    await noButtons.nth(i).click();
  }
  if (opts.parqYes) {
    await page.getByTestId('parq-chest_pain-yes').click();
  }
  await page.getByTestId('onboarding-next').click();

  await page.getByTestId('onboarding-goal').waitFor();
  await page.getByTestId('goal-strength').click();
  // Submitting without consent must show the validation errors.
  await page.getByTestId('onboarding-submit').click();
  await page.getByText('We need your consent').waitFor();
  await page.getByTestId('disclaimer-checkbox').click();
  await page.getByTestId('consent-checkbox').click();
  await page.getByTestId('onboarding-submit').click();
}

async function main(): Promise<void> {
  assert(existsSync(join(DIST, 'index.html')), `no web build in ${DIST}; run pnpm build first`);
  const { server, url } = await serve(DIST);
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  try {
    // --- PAR-Q+ red flag: the doctor message replaces the plan --------------------------------
    const blockedContext = await browser.newContext();
    const blocked = await blockedContext.newPage();
    blocked.on('pageerror', (error) => pageErrors.push(error.message));
    await blocked.goto(url);
    step('onboarding renders');
    await completeOnboarding(blocked, { parqYes: true });
    const message = await blocked.getByTestId('screening-message').innerText();
    await snap(blocked, 'blocked');
    assert(/consult a doctor/i.test(message), `blocked message: ${message}`);
    step('PAR-Q+ red flag shows the consult-a-doctor message instead of a plan');
    await blockedContext.close();

    // --- Happy path ---------------------------------------------------------------------------
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    await completeOnboarding(page);
    await page.getByTestId('plan-screen').waitFor();
    await page.getByTestId('today-card').waitFor();
    const sessions = await page.locator('[data-testid^="session-"]').count();
    assert(sessions >= 1, 'the plan shows sessions for the week');
    await snap(page, 'plan');
    step(`onboarding -> plan (${sessions} sessions this week)`);

    await page.getByTestId('start-today').click();
    await page.getByTestId('workout-screen').waitFor();
    const reps = await page.getByTestId('set-0-0-reps').inputValue();
    assert(/^\d+$/.test(reps), `reps prefilled from nextTargets, got "${reps}"`);
    const load = page.getByTestId('set-0-0-load');
    if ((await load.count()) > 0) {
      await load.fill('12.5');
    }
    await page.getByTestId('set-0-0-rir-plus').click();
    await page.getByTestId('set-0-0-complete').click();
    await page.getByTestId('rest-timer').waitFor();
    await snap(page, 'workout');
    step(`logged a set (${reps} reps prefilled) and the rest timer started`);
    await page.getByTestId('finish-workout').click();
    await page.getByTestId('plan-screen').waitFor();
    await page.getByText('Done', { exact: true }).first().waitFor();
    step('finished the workout; the session shows as done');

    await page.getByTestId('tab-progress').click();
    await page.getByTestId('progress-screen').waitFor();
    await page.getByTestId('weekly-streak').waitFor();
    const records = await page.locator('[data-testid^="record-"]').count();
    assert(records >= 1, 'the progress screen lists the logged exercise');
    await snap(page, 'progress');
    step(`progress shows adherence, the weekly streak and ${records} exercise record(s)`);

    // --- Rescheduling and the minimum dose ----------------------------------------------------
    await page.getByTestId('tab-plan').click();
    await page.getByTestId('plan-screen').waitFor();
    await page.getByTestId('cant-make-it').first().click();
    await page.getByTestId('proposals').waitFor();
    const reasons = await page.getByTestId('proposals').innerText();
    await snap(page, 'proposals');
    assert(/missed|skip/i.test(reasons), `proposal reasons: ${reasons}`);
    await page.getByTestId('accept-proposal-0').click();
    await page.getByText('Your week has been updated.').waitFor();
    step('rescheduling proposals with reasons shown and one accepted');

    await page.getByTestId('minimum-dose').first().click();
    await page
      .getByTestId('notice')
      .getByText(/minimum-dose|already fits/)
      .waitFor();
    step('minimum dose applied');

    // --- Persistence, export and delete ------------------------------------------------------
    await page.reload();
    await page.getByTestId('plan-screen').waitFor();
    step('data persists across a reload (local storage)');

    await page.getByTestId('tab-settings').click();
    await page.getByTestId('settings-screen').waitFor();
    await snap(page, 'settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-data').click();
    const download = await downloadPromise;
    const path = await download.path();
    const exported = JSON.parse(readFileSync(path, 'utf8')) as {
      format: string;
      workoutLogs: unknown[];
      scheduleChanges: unknown[];
    };
    assert(exported.format === 'fitness-app-export', 'export format');
    assert(exported.workoutLogs.length === 1, 'export contains the workout log');
    assert(exported.scheduleChanges.length >= 1, 'export contains the schedule changes');
    step(`exported ${download.suggestedFilename()}`);

    await page.getByTestId('delete-data').click();
    await page.getByTestId('delete-data').click();
    await page.getByTestId('onboarding-about').waitFor();
    await page.reload();
    await page.getByTestId('onboarding-about').waitFor();
    step('deleted all local data; back to onboarding');
    await context.close();

    assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
    console.log(`\nweb e2e passed (${steps.length} checks)`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
