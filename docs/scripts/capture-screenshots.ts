/**
 * Playwright screenshot capture script for Templarc documentation tutorials.
 *
 * Usage:
 *   BASE_URL=http://localhost ADMIN_USER=admin ADMIN_PASS=admin \
 *     npx ts-node docs/scripts/capture-screenshots.ts
 *
 * Or via Makefile:
 *   make screenshots
 *
 * Requires a running Templarc instance. Screenshots are saved to
 * docs/static/img/tutorials/.
 */

import { chromium, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
const OUT_DIR = path.join(__dirname, '../static/img/tutorials');

async function shot(page: Page, id: string): Promise<void> {
  const filePath = path.join(OUT_DIR, `${id}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  ✓ ${filePath}`);
}

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="username"], input[placeholder*="sername"]', ADMIN_USER);
  await page.fill('input[name="password"], input[type="password"]', ADMIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

async function getFirstProjectSlug(page: Page): Promise<string | null> {
  const response = await page.evaluate(async (token) => {
    const r = await fetch('/api/catalog/projects', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.json();
  }, await getToken(page));
  return response?.[0]?.slug ?? null;
}

async function getToken(page: Page): Promise<string> {
  return page.evaluate((): string => {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log(`\nCapturing screenshots from ${BASE_URL}\n`);

  // 1. Landing page (before login)
  console.log('1. landing-page');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await shot(page, 'landing-page');

  // 2. Login form
  console.log('2. login-form');
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await shot(page, 'login-form');

  // 3. Login
  console.log('3. [logging in]');
  await login(page);

  // 4. Catalog (project list)
  console.log('4. catalog-empty');
  await page.goto(`${BASE_URL}/catalog`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await shot(page, 'catalog-empty');

  // 5. Project catalog (first project)
  console.log('5. project-catalog');
  const slug = await getFirstProjectSlug(page);
  if (slug) {
    await page.goto(`${BASE_URL}/catalog/${slug}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await shot(page, 'project-catalog');
  } else {
    console.log('  ⚠ No projects found — skipping project-catalog');
  }

  // 6. Navbar annotated (full viewport, catalog page)
  console.log('6. navbar-annotated');
  await page.goto(`${BASE_URL}/catalog`);
  await page.waitForLoadState('networkidle');
  await shot(page, 'navbar-annotated');

  // 7. History list
  console.log('7. history-list');
  await page.goto(`${BASE_URL}/history`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await shot(page, 'history-list');

  // 8. Admin templates list
  console.log('8. admin-templates-list');
  await page.goto(`${BASE_URL}/admin/templates`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await shot(page, 'admin-templates-list');

  await browser.close();
  console.log('\nDone! All screenshots saved to docs/static/img/tutorials/\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
