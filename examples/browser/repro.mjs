// Requires the project's installed playwright package and Chromium.
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('.repfix/browser-output', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
page.on('pageerror', error => console.error('pageerror:', error.message));
page.on('console', message => console.log(`console.${message.type()}:`, message.text()));
page.on('requestfailed', request => console.error('requestfailed:', request.url()));
try {
  await page.setContent(await readFile('index.html', 'utf8'));
  await page.getByLabel('Discount', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply discount' }).click();
  await page.screenshot({ path: '.repfix/browser-output/total.png' });
  const total = await page.getByLabel('Total', { exact: true }).textContent();
  assert.equal(total, '$100', 'An explicit zero discount must preserve the price');
  console.log('PASS: zero discount preserves $100');
} finally {
  await context.tracing.stop({ path: '.repfix/browser-output/trace.zip' });
  await browser.close();
}
