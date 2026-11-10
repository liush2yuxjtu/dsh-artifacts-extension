import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { it } from 'vitest';
import { chromium, expect } from 'playwright/test';
import { installPointer, startCapture } from '../../scripts/record-capture.mjs';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(process.env.DSH_SOURCE_ROOT);
const { launchWebScaffold } = await import(pathToFileURL(join(source, 'apps/web/tests/scaffold.ts')).href);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const choices = {
  en: { locale: 'en-US', panel: 'Artifacts', query: 'release', title: 'Release checklist', otherTitles: ['Workshop agenda', 'Budget calculator', 'Reading list', 'Team directory', 'Product brief'],
    detail: 'The saved launch plan, ready to use again.', statuses: ['Write announcement', 'Prepare screenshots', 'Publish update'], search: 'Search title, description, or tag', back: 'Back to artifacts', copy: 'Copy path', copied: 'Copied', open: 'Open in new tab' },
  zh: { locale: 'zh-CN', panel: '工件', query: '发布', title: '发布检查清单', otherTitles: ['工作坊议程', '预算计算器', '阅读清单', '团队名录', '产品简介'],
    detail: '已经保存的发布计划，可以直接接着使用。', statuses: ['撰写公告', '准备截图', '发布更新'], search: '搜索标题、描述或标签', back: '返回工件库', copy: '复制路径', copied: '已复制', open: '在新标签页打开' },
};

async function makeStore(directory, scenario, locale) {
  const repo = 'demo/saved-artifacts';
  const repoDir = join(directory, 'demo__saved-artifacts');
  const rows = [];
  const titles = [...scenario.otherTitles.slice(0, 2), scenario.title, ...scenario.otherTitles.slice(2)];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const target = title === scenario.title;
    const slug = target ? 'release-checklist' : ['workshop-agenda', 'budget-calculator', '', 'reading-list', 'team-directory', 'product-brief'][i];
    const dir = join(repoDir, 'artifacts', slug);
    await mkdir(dir, { recursive: true });
    const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;padding:36px;background:#f6f8fc;color:#14253f;font:17px/1.5 system-ui}main{max-width:640px;margin:auto;padding:28px;background:white;border:1px solid #dee5ee;border-radius:14px}h1{font-size:30px;margin:0 0 8px}p{color:#536278}label{display:block;padding:13px;border-bottom:1px solid #e6ebf2}input{width:18px;height:18px;margin-right:12px}strong{color:#217755}</style><main><h1>${title}</h1><p>${target ? scenario.detail : title}</p>${target ? '<strong>2 / 3</strong>' + scenario.statuses.map((t, n) => `<label><input type="checkbox" ${n < 2 ? 'checked' : ''}>${t}</label>`).join('') : `<p>${locale === 'zh' ? '已保存，可再次使用。' : 'Saved and ready to use again.'}</p>`}</main></html>`;
    await writeFile(join(dir, 'index.html'), html);
    const row = { slug, title, description: target ? scenario.detail : '', tags: [target ? (locale === 'zh' ? '发布' : 'launch') : (locale === 'zh' ? '项目' : 'project')],
      createdAt: '2026-11-01T09:00:00Z', updatedAt: `2026-11-${String(10 - i).padStart(2, '0')}T09:00:00Z`, bytes: Buffer.byteLength(html), path: `artifacts/${slug}/index.html` };
    await writeFile(join(dir, 'meta.json'), JSON.stringify(row, null, 2));
    rows.push(row);
  }
  await writeFile(join(repoDir, 'index.json'), JSON.stringify({ artifacts: rows }, null, 2));
  return { repo, cacheDir: directory, basePath: 'artifacts', rows };
}

for (const locale of (process.env.DSH_STORY_LANGS || 'en,zh').split(',')) {
  it(`records the real read-only artifact library in ${locale}`, async () => {
    const scenario = choices[locale];
    const output = join(resolve(process.env.DSH_STORY_OUTPUT), locale);
    await mkdir(output, { recursive: false });
    const configPath = join(homedir(), '.dsh/artifact-store.json');
    await mkdir(join(homedir(), '.dsh'), { recursive: true });
    const store = await makeStore(join(output, 'demo-store'), scenario, locale);
    const config = JSON.stringify({ repo: store.repo, cacheDir: store.cacheDir, basePath: store.basePath });
    await writeFile(configPath, config, { flag: 'wx', mode: 0o600 });
    let scaffold, browser, capture, page;
    let modelCalls = 0;
    const errors = [];
    const consoleErrors = [];
    const markers = [];
    const checks = [];
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const pluginHashes = Object.fromEntries(await Promise.all(['index.js', 'client.js', 'package.json', 'cordis.patch.yml'].map(async p => [p, sha(await readFile(join(root, p)))])));
    try {
      scaffold = await launchWebScaffold({ profile: { hmr: false, packages: [{ dir: root, enabled: true }] } });
      await scaffold.ctx.settings.update('locale', { preference: locale });
      scaffold.ctx.on('llm/stream', async function* (options, next) { modelCalls++; for await (const chunk of next()) yield chunk; });
      browser = await chromium.launch({ executablePath: process.env.DSH_CHROMIUM_PATH, headless: true,
        env: { ...process.env, ...(process.env.DSH_CHROMIUM_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.DSH_CHROMIUM_LIBRARY_PATH } : {}) },
        args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--disable-gpu'] });
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: scenario.locale, colorScheme: 'light' });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'domcontentloaded' });
      const panel = page.getByRole('button', { name: scenario.panel, exact: true });
      await expect(panel).toBeVisible({ timeout: 30000 });
      await panel.click();
      await expect(page.locator('.dsh-art__card')).toHaveCount(6);
      const search = page.getByRole('searchbox', { name: scenario.search });
      await search.fill(scenario.query);
      await expect(page.locator('.dsh-art__card')).toHaveCount(1);
      await page.locator('.dsh-art__card').click();
      await expect(page.locator('.dsh-art__detailTitle')).toHaveText(scenario.title);
      await expect(page.frameLocator('.dsh-art__stage iframe').locator('h1')).toHaveText(scenario.title);
      await page.getByRole('button', { name: scenario.copy, exact: true }).click();
      await expect(page.getByRole('status')).toHaveText(scenario.copied);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'artifacts/release-checklist/index.html');
      await page.getByRole('button', { name: scenario.back, exact: true }).click();
      await search.fill('no-such-saved-project');
      await expect(page.locator('.dsh-art__card')).toHaveCount(0);
      await search.fill('');
      await expect(page.locator('.dsh-art__card')).toHaveCount(6);
      await expect(page.getByRole('status')).toHaveCount(0);
      const authenticated = await scaffold.hostFetch('/dsh-artifacts/list');
      assert.equal(authenticated.status, 200);
      assert.equal((await authenticated.json()).artifacts.length, 6);
      const noCookie = await fetch(new URL('/dsh-artifacts/list', scaffold.baseUrl));
      assert.equal(noCookie.status, 401);
      assert.equal((await scaffold.hostFetch('/dsh-artifacts/html/does-not-exist')).status, 404);
      checks.push('real-profile-plugin-loaded', 'six-saved-files-visible', 'search-six-to-one', 'real-html-iframe-loaded', 'copy-path-toast-and-clipboard-readback', 'no-match-empty-state', 'no-cookie-401', 'unknown-slug-404');
      const discovery = { viewport: { width: 1280, height: 800 }, dpr: 2, locale, geometry: await page.locator('.dsh-art').boundingBox(), search: await search.boundingBox(), uiText: await page.locator('.dsh-art').innerText() };
      await writeFile(join(output, 'discovery.json'), JSON.stringify(discovery, null, 2));
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      await writeFile(join(output, 'rehearsal.json'), JSON.stringify({ status: 'PASS', checks, semantics: true, interactions: true, visibleStateTransitions: true, dependencies: true, modelCalls, pageErrors: errors, consoleErrors }, null, 2));
      await page.screenshot({ path: join(output, 'preflight.png') });
      if (process.env.DSH_STORY_REHEARSE === '1') return;
      await installPointer(page);
      capture = await startCapture(page, output);
      const mark = async label => {
        const entry = { label, elapsed_ms: Math.round(Date.now() - capture.started) };
        markers.push(entry);
        await writeFile(join(output, 'markers.json'), JSON.stringify(markers, null, 2));
        return entry.elapsed_ms / 1000;
      };
      const moveClick = async (locator, label) => {
        const box = await locator.boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height < 801 && box.x + box.width <= 1281, label);
        await page.mouse.move(box.x + box.width - 18, box.y + box.height / 2, { steps: 12 });
        await page.waitForTimeout(240);
        await mark(label);
        await locator.click({ position: { x: box.width - 18, y: box.height / 2 } });
      };
      await mark('Six saved artifacts');
      await page.waitForTimeout(1600);
      await moveClick(search, 'Search saved artifacts');
      await search.pressSequentially(scenario.query, { delay: 130 });
      await expect(page.locator('.dsh-art__card')).toHaveCount(1);
      await mark('Found the saved release checklist');
      await page.waitForTimeout(1300);
      await moveClick(page.locator('.dsh-art__card'), 'Open the saved checklist');
      await expect(page.frameLocator('.dsh-art__stage iframe').locator('h1')).toHaveText(scenario.title);
      const proofStart = await mark('Saved checklist is readable');
      await page.waitForTimeout(4200);
      await moveClick(page.getByRole('button', { name: scenario.copy, exact: true }), 'Copy the file path');
      await expect(page.getByRole('status')).toHaveText(scenario.copied);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'artifacts/release-checklist/index.html');
      await mark('Copied path');
      await page.waitForTimeout(3200);
      await page.screenshot({ path: join(output, 'result.png') });
      const captured = await capture.stop(); capture = undefined;
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      assert.equal(modelCalls, 0);
      await writeFile(join(output, 'recording.json'), JSON.stringify({ status: 'recorded', locale, source: { environment: 'repository-build', commit: sourceCommit, pluginHashes, version: '0.1.3', dshCommit: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
        runtime: { host: hostname(), platform: process.platform, browser: await browser.version(), ...discovery.viewport, dpr: 2 },
        scope: 'Read-only browsing of manually prepared local sample HTML files; no generation, saving or model capability claim.',
        realProductUI: true, fixtureUI: false, mockedRoutes: false, modelCalls, apiReceipts: [], sampleData: store.rows, checks, pageErrors: errors, consoleErrors, captured,
        proof_interval_s: [proofStart, proofStart + 4.2], raw_sha256: sha(await readFile(join(output, 'raw/gt.mp4'))) }, null, 2));
      console.log('STORY_RECORDED', locale, captured.duration_s, 'seconds; model calls', modelCalls);
    } catch (error) {
      await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, modelCalls }, null, 2));
      if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
      throw error;
    } finally {
      if (capture) await capture.stop().catch(() => {});
      await browser?.close(); await scaffold?.close();
      if (await readFile(configPath, 'utf8') === config) await unlink(configPath);
      else throw new Error('Temporary store configuration changed; left it untouched.');
    }
  });
}
