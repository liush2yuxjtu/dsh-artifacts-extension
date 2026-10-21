#!/usr/bin/env node
/**
 * verify.mjs — reproducible verifier for the DSH artifacts extension.
 *
 * Modes:
 *   --static-only            manifest, bundle, syntax, command harness
 *   --http-only              live Host routes (needs DSH_VERIFY_COOKIE)
 *   --skill create|store|tweaks   static harness + one skill
 *   (no mode)                static + HTTP (if cookie) + all skills
 *
 * Evidence is written under --out (default verify-evidence/<timestamp>/).
 * Exit: 0 PASS, 1 FAIL, 2 BLOCKED.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '../../..');
const HOME = homedir();

/* ------------------------------------------------------------------ */
/* Args                                                               */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { skillsDir: join(HOME, '.agents', 'skills'), url: 'http://127.0.0.1:3080' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--static-only': out.staticOnly = true; break;
      case '--http-only': out.httpOnly = true; break;
      case '--skill': out.skill = next(); break;
      case '--all': out.all = true; break;
      case '--repo-root': out.root = resolve(next()); break;
      case '--skills-dir': out.skillsDir = resolve(next()); break;
      case '--url': out.url = next().replace(/\/+$/, ''); break;
      case '--cdp': out.cdp = next(); break;
      case '--cookie': out.cookie = next(); break;
      case '--out': out.out = resolve(next()); break;
      case '--fixture': out.fixture = resolve(next()); break;
      case '--tweaks-file': out.tweaksFile = resolve(next()); break;
      case '--store-slug': out.storeSlug = next(); break;
      case '--strict': out.strict = true; break;
      case '--probe-320': out.probe320 = true; break;
      case '--tweaks-browser': out.tweaksBrowser = true; break;
      case '--quiet': out.quiet = true; break;
      case '--json': out.json = true; break;
      case '--help': out.help = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

const REPORT = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  root: null,
  dsh: null,
  node: process.version,
  url: null,
  cookieProvided: false,
  surfaces: {},
  limitations: [],
};

function surface(name) {
  if (!REPORT.surfaces[name]) {
    REPORT.surfaces[name] = { verdict: 'SKIP', checks: [], evidence: {}, blocked: false };
  }
  return REPORT.surfaces[name];
}

function record(name, ok, detail, evidence) {
  const item = { name, ok, detail: String(detail ?? '') };
  if (evidence) item.evidence = evidence;
  surface(name).checks.push(item);
  if (!ok) surface(name).blocked = false;
  if (!REPORT.quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail ?? ''}`);
  return item;
}

function block(name, detail) {
  const s = surface(name);
  s.blocked = true;
  s.checks.push({ name: `${name}:blocked`, ok: false, detail: String(detail) });
  if (!REPORT.quiet) console.log(`BLOCK ${name}: ${detail}`);
}

function verdict(name) {
  const s = surface(name);
  if (!s.checks.length) return s.blocked ? 'BLOCKED' : 'SKIP';
  if (s.blocked) return 'BLOCKED';
  return s.checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
}

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? 180_000,
        maxBuffer: 32 * 1024 * 1024,
        env: opts.env ?? process.env,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolvePromise({
          code,
          signal: error?.signal ?? null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          error: error ? String(error.message ?? error) : null,
        });
      },
    );
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function sha256(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

function expandHome(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return HOME;
  if (value.startsWith('~/')) return join(HOME, value.slice(2));
  return value;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
  return dir;
}

function pretty(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/* ------------------------------------------------------------------ */
/* Store discovery                                                    */
/* ------------------------------------------------------------------ */

async function storeConfig() {
  const file = join(HOME, '.dsh', 'artifact-store.json');
  if (!existsSync(file)) return null;
  const parsed = await readJson(file);
  if (typeof parsed.repo !== 'string' || !parsed.repo.includes('/')) return null;
  const cacheDir = expandHome(parsed.cacheDir ?? '~/.dsh/cache/artifact-store');
  return {
    ...parsed,
    cacheDir,
    repoDir: join(cacheDir, parsed.repo.replace('/', '__')),
  };
}

async function storeIndex(config) {
  if (!config) return null;
  const file = join(config.repoDir, 'index.json');
  if (!existsSync(file)) return null;
  return readJson(file);
}

async function pickArtifactFixture(config, index, explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  if (process.env.DSH_VERIFY_FIXTURE && existsSync(process.env.DSH_VERIFY_FIXTURE)) {
    return resolve(process.env.DSH_VERIFY_FIXTURE);
  }
  const rows = Array.isArray(index?.artifacts) ? index.artifacts : [];
  const preferred =
    rows.find((row) => (row.tags ?? []).includes('artifact-create')) ??
    rows.find((row) => row.slug === 'dsh-home') ??
    rows[0];
  if (preferred && config) {
    const candidate = join(config.repoDir, preferred.path ?? `artifacts/${preferred.slug}/index.html`);
    if (existsSync(candidate)) return candidate;
  }
  for (const candidate of [
    join(process.cwd(), 'dsh-home.html'),
    join(HOME, 'Documents', 'deepseek-harness', 'default-workspace', 'dsh-home.html'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function pickTweaksFixture(config, index, explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  if (process.env.DSH_VERIFY_TWEAKS_FILE && existsSync(process.env.DSH_VERIFY_TWEAKS_FILE)) {
    return resolve(process.env.DSH_VERIFY_TWEAKS_FILE);
  }
  const rows = Array.isArray(index?.artifacts) ? index.artifacts : [];
  const preferred =
    rows.find((row) => /tweak/i.test(`${row.title ?? ''} ${row.description ?? ''}`)) ??
    rows.find((row) => row.slug === 'deepseek-harness-studio');
  if (preferred && config) {
    const candidate = join(config.repoDir, preferred.path ?? `artifacts/${preferred.slug}/index.html`);
    if (existsSync(candidate)) return candidate;
  }
  if (config) {
    const root = join(config.repoDir, config.basePath ?? 'artifacts');
    if (existsSync(root)) {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(root, entry.name, 'index.html');
        if (!existsSync(candidate)) continue;
        const text = await readFile(candidate, 'utf8');
        if (text.includes('EDITMODE') && text.includes('Tweaks')) return candidate;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Static + Host harness                                              */
/* ------------------------------------------------------------------ */

async function checkStatic(root, out) {
  const files = [
    'package.json',
    'cordis.patch.yml',
    'index.js',
    'client.js',
    'icon.svg',
    'locale/en.json',
    'locale/zh.json',
    'skills/verify-dsh-artifacts/SKILL.md',
  ];
  for (const file of files) {
    record('extension', existsSync(join(root, file)), `file exists: ${file}`);
  }

  let pkg = null;
  try {
    pkg = await readJson(join(root, 'package.json'));
    record('extension', pkg.name === '@local/dsh-artifacts', `package name: ${pkg.name}`);
    record('extension', pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'bundle patch declared');
    record('extension', pkg.dsh?.client?.platform === 'web', 'client platform is web');
    record('extension', pkg.dsh?.client?.immediately === true, 'client loads immediately');
    record('extension', typeof pkg.exports?.['./client'] === 'string', 'client export declared');
    record('extension', typeof pkg.exports?.['./icon'] === 'string', 'icon export declared');
  } catch (error) {
    record('extension', false, `package.json invalid: ${error.message}`);
  }

  try {
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
    record('extension', /id:\s*dsh-artifacts/.test(patch), 'bundle patch inserts id dsh-artifacts');
    record('extension', /name:\s*['"]?@local\/dsh-artifacts/.test(patch), 'bundle patch names the package');
  } catch (error) {
    record('extension', false, `cordis.patch.yml unreadable: ${error.message}`);
  }

  for (const file of ['index.js', 'client.js', 'scripts/cdp-check.mjs']) {
    const result = await run(process.execPath, ['--check', join(root, file)]);
    record('extension', result.code === 0, `node --check ${file}`, result.code === 0 ? undefined : result.stderr.slice(0, 400));
  }

  // Host harness: import the real module with a fake context.
  const commands = new Map();
  const routes = [];
  const effects = [];
  const fake = {
    effect(fn) {
      const disposer = fn();
      if (typeof disposer !== 'function') throw new Error('effect did not return a disposer');
      effects.push(disposer);
    },
    commands: {
      register(definition) {
        commands.set(definition.name, definition);
        return () => {};
      },
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    get() {
      return undefined;
    },
  };

  try {
    const mod = await import(`${pathToFileURL(join(root, 'index.js')).href}?t=${Date.now()}`);
    record('extension', typeof mod.apply === 'function', 'host exports apply()');
    record('extension', Array.isArray(mod.inject) && mod.inject.includes('commands'), 'host injects commands');
    record('extension', Array.isArray(mod.inject) && mod.inject.includes('webServer'), 'host injects webServer');
    record('extension', Array.isArray(mod.inject) && mod.inject.includes('connection'), 'host injects connection');
    mod.apply(fake);
  } catch (error) {
    record('extension', false, `host harness failed: ${error.message}`);
  }

  record('extension', commands.size === 3, `exactly 3 commands (got ${commands.size}: ${[...commands.keys()].join(', ')})`);
  for (const name of ['artifact-create', 'artifact-store', 'artifact-tweak']) {
    record('extension', commands.has(name), `command registered: ${name}`);
  }
  record('extension', routes.length === 5, `exactly 5 routes (got ${routes.length})`);
  for (const path of ['/dsh-artifacts/list', '/dsh-artifacts/preview', '/dsh-artifacts/html', '/dsh-artifacts/view', '/dsh-artifacts/asset']) {
    record('extension', routes.some((route) => route.path === path), `route registered: ${path}`);
  }

  const followups = [];
  const agent = { followup(message) { followups.push(message); } };
  const signal = new AbortController().signal;

  const createEmpty = commands.get('artifact-create')?.handler({ rawInput: '  ', attachments: [], agent, signal });
  record('extension', createEmpty?.kind === 'error', 'artifact-create empty input returns error');

  const create = commands.get('artifact-create')?.handler({
    rawInput: 'a disposable archer page',
    attachments: [],
    agent,
    signal,
  });
  record('extension', create?.kind === 'success', 'artifact-create non-empty returns success');
  record('extension', followups.length === 1, `artifact-create queues one follow-up (got ${followups.length})`);
  if (followups[0]) {
    const message = followups[0];
    record('extension', message.role === 'user' && message.source?.kind === 'user', 'follow-up is a user message');
    record('extension', typeof message.id === 'string' && message.id.length > 0, 'follow-up has an id');
    record('extension', Array.isArray(message.content) && message.content[0]?.type === 'text', 'follow-up carries text content');
    record('extension', /artifact-create/.test(message.content?.[0]?.text ?? ''), 'follow-up names artifact-create');
    record('extension', Object.isFrozen(message) && Object.isFrozen(message.content), 'follow-up is frozen');
  }

  const storeUnknown = await commands.get('artifact-store')?.handler({
    rawInput: 'nope-command',
    attachments: [],
    agent,
    signal,
  });
  record('extension', storeUnknown?.kind === 'error', 'artifact-store unknown subcommand returns error');

  const tweakEmpty = commands.get('artifact-tweak')?.handler({ rawInput: '', attachments: [], agent, signal });
  record('extension', tweakEmpty?.kind === 'error', 'artifact-tweak empty input returns error');
  const before = followups.length;
  const tweak = commands.get('artifact-tweak')?.handler({
    rawInput: 'add accent and density controls',
    attachments: [],
    agent,
    signal,
  });
  record('extension', tweak?.kind === 'success', 'artifact-tweak non-empty returns success');
  record('extension', followups.length === before + 1, 'artifact-tweak queues one follow-up');
  record(
    'extension',
    /artifact-tweaks/.test(followups[before]?.content?.[0]?.text ?? ''),
    'tweak follow-up names artifact-tweaks',
  );

  await ensureDir(out);
  await writeFile(join(out, 'host-harness.json'), pretty({ commands: [...commands.keys()], routes: routes.map((route) => route.path), followups: followups.length }));
  return { commands, routes };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

async function fetchRoute(base, path, cookie) {
  const headers = { accept: '*/*' };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, { headers, redirect: 'manual' });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    length: buffer.byteLength,
    text: buffer.toString('utf8'),
    buffer,
  };
}

async function checkHttp(base, cookie, out) {
  if (!cookie) {
    block('extension', 'DSH_VERIFY_COOKIE not set');
    return null;
  }

  await ensureDir(out);
  const noCookie = await fetchRoute(base, '/dsh-artifacts/list', null);
  record('extension', noCookie.status === 401, `no-cookie list is 401 (got ${noCookie.status})`);

  const list = await fetchRoute(base, '/dsh-artifacts/list', cookie);
  record('extension', list.status === 200 && list.type.includes('application/json'), `authenticated list 200 JSON (got ${list.status} ${list.type})`);
  let payload = null;
  try {
    payload = JSON.parse(list.text);
    record('extension', payload.configured !== false && payload.available !== false, 'store configured and cache available');
    record('extension', Array.isArray(payload.artifacts) && payload.artifacts.length > 0, `list has artifacts (${payload.artifacts?.length ?? 0})`);
  } catch (error) {
    record('extension', false, `list JSON invalid: ${error.message}`);
  }
  await writeFile(join(out, 'list.json'), list.text);

  const slug = payload?.artifacts?.[0]?.slug;
  if (!slug) return payload;

  const preview = await fetchRoute(base, `/dsh-artifacts/preview/${slug}`, cookie);
  record('extension', preview.status === 200 && preview.type.startsWith('image/'), `preview ${slug} is an image (${preview.status} ${preview.type})`);

  const html = await fetchRoute(base, `/dsh-artifacts/html/${slug}`, cookie);
  record('extension', html.status === 200 && html.type.includes('text/html'), `html ${slug} is HTML (${html.status})`);
  record('extension', /<html[\s>]/i.test(html.text), 'html route returns a document');

  const view = await fetchRoute(base, `/dsh-artifacts/view/${slug}`, cookie);
  record('extension', view.status === 200, `view ${slug} is 200`);
  record('extension', view.text.includes(`<base href="/dsh-artifacts/asset/${slug}/">`), 'view injects artifact base URL');

  const asset = await fetchRoute(base, `/dsh-artifacts/asset/${slug}/preview.png`, cookie);
  record('extension', asset.status === 200 && asset.type.startsWith('image/'), 'asset route serves preview.png');

  const missing = await fetchRoute(base, '/dsh-artifacts/preview/does-not-exist', cookie);
  record('extension', missing.status === 404, `unknown preview is 404 (got ${missing.status})`);

  const traversal = await fetchRoute(base, `/dsh-artifacts/asset/${slug}/%2e%2e%2f%2e%2e%2f.credentials.yaml`, cookie);
  record('extension', traversal.status === 404, `traversal is 404 (got ${traversal.status})`);

  return payload;
}

/* ------------------------------------------------------------------ */
/* Skill: artifact-create                                             */
/* ------------------------------------------------------------------ */

async function checkArtifactCreate(skillsDir, fixture, out, strict, probe320) {
  const name = 'artifact-create';
  const verifier = join(skillsDir, 'artifact-create', 'scripts', 'verify-artifact.mjs');
  if (!existsSync(verifier)) {
    block(name, `missing verifier: ${verifier}`);
    return;
  }
  if (!fixture || !existsSync(fixture)) {
    block(name, 'no generated artifact fixture (pass --fixture or DSH_VERIFY_FIXTURE)');
    return;
  }
  await ensureDir(out);
  const args = [verifier, fixture, '--out', out, '--widths', '1440,1024,820,390', '--quiet'];
  if (strict) args.push('--strict');
  const runResult = await run(process.execPath, args, { timeout: 240_000 });
  await writeFile(join(out, 'verifier.stdout.txt'), runResult.stdout);
  await writeFile(join(out, 'verifier.stderr.txt'), runResult.stderr);
  record(name, runResult.code === 0, `verify-artifact exit ${runResult.code}`, runResult.code === 0 ? undefined : runResult.stderr.slice(0, 600));
  record(name, existsSync(join(out, 'report.json')), 'verifier wrote report.json');
  if (existsSync(join(out, 'report.json'))) {
    const report = await readJson(join(out, 'report.json'));
    record(name, report.pass === true, `browser report pass=${report.pass}`);
    record(name, (report.failures ?? []).length === 0, `failures=${(report.failures ?? []).length}`);
    record(name, (report.console?.errors ?? []).length === 0, 'no console errors');
    record(name, (report.console?.exceptions ?? []).length === 0, 'no uncaught exceptions');
    record(name, (report.network?.external ?? []).length === 0, 'no external network requests');
    const widths = (report.viewports ?? []).map((viewport) => viewport.width);
    record(name, widths.includes(1440) && widths.includes(1024) && widths.includes(820) && widths.includes(390), `viewports ${widths.join(', ')}`);
    record(name, (report.viewports ?? []).every((viewport) => viewport.scrollWidth <= viewport.width), 'no horizontal overflow');
  }
  surface(name).evidence.fixture = fixture;
  surface(name).evidence.sha256 = await sha256(fixture);
  surface(name).evidence.bytes = (await stat(fixture)).size;
  surface(name).evidence.output = out;

  if (probe320) {
    const probeOut = join(out, 'probe-320');
    const probe = await run(process.execPath, [verifier, fixture, '--out', probeOut, '--widths', '320', '--quiet'], { timeout: 180_000 });
    record(name, probe.code === 0, `320px probe exit ${probe.code}`);
  } else {
    REPORT.limitations.push('artifact-create: 320px adjacent probe not run (pass --probe-320)');
  }
}

/* ------------------------------------------------------------------ */
/* Skill: artifact-store                                              */
/* ------------------------------------------------------------------ */

async function checkArtifactStore(skillsDir, slug, out, expectedCount) {
  const name = 'artifact-store';
  const cli = join(skillsDir, 'artifact-store', 'scripts', 'artifact-store.mjs');
  if (!existsSync(cli)) {
    block(name, `missing store CLI: ${cli}`);
    return null;
  }
  const config = await storeConfig();
  if (!config) {
    block(name, 'artifact-store is not configured (~/.dsh/artifact-store.json)');
    return null;
  }
  await ensureDir(out);

  const status = await run(process.execPath, [cli, 'status'], { timeout: 120_000 });
  await writeFile(join(out, 'status.txt'), status.stdout + status.stderr);
  record(name, status.code === 0, `status exit ${status.code}`);

  const list = await run(process.execPath, [cli, 'list', '--json'], { timeout: 120_000 });
  await writeFile(join(out, 'list.json'), list.stdout);
  record(name, list.code === 0, `list --json exit ${list.code}`);
  let listed = null;
  try {
    listed = JSON.parse(list.stdout);
    record(name, Array.isArray(listed.artifacts) && listed.artifacts.length > 0, `list has artifacts (${listed.artifacts?.length ?? 0})`);
    if (Number.isInteger(expectedCount)) {
      record(name, listed.artifacts.length === expectedCount, `count matches panel (${listed.artifacts.length} vs ${expectedCount})`);
    }
  } catch (error) {
    record(name, false, `list JSON invalid: ${error.message}`);
  }

  const chosen = slug ?? listed?.artifacts?.[0]?.slug;
  if (!chosen) {
    block(name, 'no slug available for load/history');
    return listed;
  }

  const loadDir = join(out, 'load');
  const load = await run(process.execPath, [cli, 'load', chosen, '--out', loadDir, '--force'], { timeout: 120_000 });
  record(name, load.code === 0, `load ${chosen} exit ${load.code}`);
  const loadedHtml = join(loadDir, chosen, 'index.html');
  const altHtml = join(loadDir, 'index.html');
  const htmlPath = existsSync(loadedHtml) ? loadedHtml : altHtml;
  record(name, existsSync(htmlPath), `loaded index.html exists (${htmlPath})`);

  const history = await run(process.execPath, [cli, 'history', chosen, '--limit', '5'], { timeout: 120_000 });
  await writeFile(join(out, 'history.txt'), history.stdout + history.stderr);
  record(name, history.code === 0 && history.stdout.trim().length > 0, `history ${chosen} exit ${history.code}`);

  const missing = await run(process.execPath, [cli, 'load', 'does-not-exist-verify', '--out', join(out, 'missing')], { timeout: 60_000 });
  record(name, missing.code !== 0, 'unknown slug load exits nonzero');

  // Schema, hashes, sort order, and a shallow secret scan.
  const index = await storeIndex(config);
  if (!index) {
    block(name, `index.json missing at ${join(config.repoDir, 'index.json')}`);
    return listed;
  }
  await writeFile(join(out, 'index.json'), pretty(index));
  record(name, Array.isArray(index.artifacts) && index.artifacts.length > 0, 'index.json has artifacts');

  const rows = Array.isArray(index.artifacts) ? index.artifacts : [];
  const sorted = rows.every((row, i) => i === 0 || String(rows[i - 1].updatedAt ?? '') >= String(row.updatedAt ?? ''));
  record(name, sorted, 'index.json sorted by updatedAt descending');

  const required = ['slug', 'title', 'description', 'tags', 'path', 'sha256', 'bytes', 'createdAt', 'updatedAt'];
  let schemaFailures = 0;
  let hashFailures = 0;
  let secretHits = [];
  const secretRe = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

  for (const row of rows) {
    for (const field of required) {
      if (row[field] === undefined || row[field] === null || row[field] === '') {
        schemaFailures += 1;
        REPORT.limitations.push(`artifact-store: ${row.slug ?? '?'} missing ${field}`);
      }
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.slug ?? '')) {
      schemaFailures += 1;
      REPORT.limitations.push(`artifact-store: invalid slug ${row.slug}`);
    }
    const html = join(config.repoDir, row.path ?? `artifacts/${row.slug}/index.html`);
    if (existsSync(html) && row.sha256) {
      const digest = await sha256(html);
      if (digest !== row.sha256) {
        hashFailures += 1;
        REPORT.limitations.push(`artifact-store: sha256 mismatch ${row.slug}`);
      }
    }
    const metaPath = join(config.repoDir, row.meta ?? `artifacts/${row.slug}/meta.json`);
    if (existsSync(metaPath)) {
      const metaText = await readFile(metaPath, 'utf8');
      const meta = JSON.parse(metaText);
      for (const field of ['slug', 'title', 'description', 'tags', 'source', 'path', 'sha256', 'bytes', 'createdAt', 'updatedAt']) {
        if (meta[field] === undefined || meta[field] === null || meta[field] === '') {
          schemaFailures += 1;
          REPORT.limitations.push(`artifact-store: ${row.slug} meta missing ${field}`);
        }
      }
      if (meta.preview && !meta.preview.startsWith(`artifacts/${row.slug}/`)) {
        schemaFailures += 1;
        REPORT.limitations.push(`artifact-store: ${row.slug} preview escapes its directory`);
      }
      if (secretRe.test(metaText)) secretHits.push(metaPath);
    }
    if (existsSync(html)) {
      const htmlText = await readFile(html, 'utf8');
      if (secretRe.test(htmlText)) secretHits.push(html);
    }
  }
  record(name, schemaFailures === 0, `schema fields valid (${schemaFailures} failures)`);
  record(name, hashFailures === 0, `sha256 matches (${hashFailures} failures)`);
  record(name, secretHits.length === 0, `no obvious secrets (${secretHits.length} hits)`);
  if (secretHits.length) {
    REPORT.limitations.push(`artifact-store: secret-like strings in ${secretHits.map((p) => p.replace(config.repoDir, '<cache>')).join(', ')}`);
  }

  surface(name).evidence.repo = config.repo;
  surface(name).evidence.artifacts = rows.length;
  surface(name).evidence.slug = chosen;
  surface(name).evidence.output = out;
  return listed;
}

/* ------------------------------------------------------------------ */
/* Skill: artifact-tweaks                                             */
/* ------------------------------------------------------------------ */

async function checkArtifactTweaks(skillsDir, fixture, out, browserCheck) {
  const name = 'artifact-tweaks';
  const audit = join(skillsDir, 'artifact-tweaks', 'scripts', 'audit-tweaks.mjs');
  if (!existsSync(audit)) {
    block(name, `missing audit script: ${audit}`);
    return;
  }
  if (!fixture || !existsSync(fixture)) {
    block(name, 'no tweaked artifact fixture (pass --tweaks-file or DSH_VERIFY_TWEAKS_FILE)');
    return;
  }
  await ensureDir(out);
  const result = await run(process.execPath, [audit, fixture, '--json'], { timeout: 120_000 });
  await writeFile(join(out, 'audit.json'), result.stdout);
  record(name, result.code === 0, `audit exit ${result.code}`);
  let auditJson = null;
  try {
    auditJson = JSON.parse(result.stdout);
    const results = auditJson.results ?? [];
    record(name, results.length >= 8, `audit returned ${results.length} checks`);
    const failures = results.filter((item) => item.level !== 'pass');
    record(name, failures.length === 0, `all audit checks pass (${failures.length} not pass)`);
    for (const failure of failures) {
      REPORT.limitations.push(`artifact-tweaks: ${failure.level} ${failure.title}: ${failure.detail}`);
    }
  } catch (error) {
    record(name, false, `audit JSON invalid: ${error.message}`);
  }
  surface(name).evidence.fixture = fixture;
  surface(name).evidence.sha256 = await sha256(fixture);
  surface(name).evidence.output = out;

  if (browserCheck) {
    const verifier = join(skillsDir, 'artifact-create', 'scripts', 'verify-artifact.mjs');
    if (!existsSync(verifier)) {
      block(name, `paired verifier missing: ${verifier}`);
      return;
    }
    const browserOut = join(out, 'browser');
    const browser = await run(process.execPath, [verifier, fixture, '--out', browserOut, '--quiet'], { timeout: 240_000 });
    record(name, browser.code === 0, `paired verify-artifact exit ${browser.code}`);
    if (existsSync(join(browserOut, 'report.json'))) {
      const report = await readJson(join(browserOut, 'report.json'));
      record(name, report.pass === true, `paired browser report pass=${report.pass}`);
    }
  } else {
    REPORT.limitations.push('artifact-tweaks: paired browser verifier not run (pass --tweaks-browser)');
  }

  // Negative control: a non-tweaked artifact must not pass the audit.
  const config = await storeConfig();
  const index = await storeIndex(config);
  const negativeSlug = index?.artifacts?.find((row) => row.slug === 'dsh-home')?.slug ?? index?.artifacts?.[0]?.slug;
  if (negativeSlug) {
    const negative = join(config.repoDir, `artifacts/${negativeSlug}/index.html`);
    if (existsSync(negative)) {
      const control = await run(process.execPath, [audit, negative, '--json'], { timeout: 120_000 });
      let controlPasses = false;
      try {
        const parsed = JSON.parse(control.stdout);
        controlPasses = (parsed.results ?? []).every((item) => item.level === 'pass');
      } catch {
        controlPasses = false;
      }
      record(name, !controlPasses, `negative control (${negativeSlug}) does not pass the tweaks audit`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Panel via CDP                                                      */
/* ------------------------------------------------------------------ */

async function checkUi(cdp, base, cookie, out) {
  const name = 'panel';
  if (!cdp) {
    REPORT.limitations.push('panel: CDP not provided (pass --cdp)');
    return;
  }
  if (!cookie) {
    block(name, 'DSH_VERIFY_COOKIE not set for the panel');
    return;
  }
  const script = join(HERE, 'ui-verify.mjs');
  await ensureDir(out);
  const result = await run(
    process.execPath,
    [script, '--cdp', cdp, '--url', base, '--out', out],
    { timeout: 300_000, env: { ...process.env, DSH_VERIFY_COOKIE: cookie } },
  );
  await writeFile(join(out, 'ui-verify.stdout.txt'), result.stdout);
  await writeFile(join(out, 'ui-verify.stderr.txt'), result.stderr);
  record(name, result.code === 0, `ui-verify exit ${result.code}`, result.code === 0 ? undefined : result.stderr.slice(0, 500));
  if (!existsSync(join(out, 'ui.json'))) {
    record(name, false, 'ui.json missing');
    return;
  }
  const ui = await readJson(join(out, 'ui.json'));
  const checks = Array.isArray(ui.checks) ? ui.checks : [];
  record(name, ui.ok === true, `panel report ok=${ui.ok}`);
  record(name, checks.length > 0 && checks.every((check) => check.ok), `panel checks ${checks.filter((c) => c.ok).length}/${checks.length}`);
  record(name, (ui.viewports ?? []).length >= 3, `panel viewports ${(ui.viewports ?? []).length}`);
  const first = (ui.viewports ?? [])[0];
  if (first) {
    const order = first.order ?? [];
    record(name, order[0] === '插件' && order[1] === '工件' && order[2] === '自动化任务', `sidebar order ${order.join(' → ')}`);
    record(name, (first.cards ?? 0) > 0, `cards ${first.cards}`);
  }
  record(name, Boolean(ui.detail && ui.detail.srcdoc > 500), 'detail iframe populated');
  record(name, (ui.errors ?? []).length === 0, `console errors ${(ui.errors ?? []).length}`);
  surface(name).evidence.output = out;
}

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

function renderMarkdown(report) {
  const rows = Object.entries(report.surfaces)
    .map(([name, s]) => `| ${name} | ${s.verdict} | ${s.checks.filter((c) => c.ok).length}/${s.checks.length} |`)
    .join('\n');
  return `# Verify report — ${report.startedAt.slice(0, 10)}

Overall: **${report.overall}**

- Repository: \`${report.root}\`
- DSH: ${report.dsh ?? 'unknown'}
- Node: ${report.node}
- URL: ${report.url ?? 'n/a'}
- Cookie provided: ${report.cookieProvided ? 'yes' : 'no'}

| Surface | Verdict | Checks |
|---|---|---|
${rows}

## Surface details

${Object.entries(report.surfaces)
  .map(
    ([name, s]) => `### ${name}

Verdict: **${s.verdict}**

${s.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} — ${c.name}${c.detail ? `: ${c.detail}` : ''}`).join('\n')}
`,
  )
  .join('\n')}

## Limitations

${report.limitations.length ? report.limitations.map((line) => `- ${line}`).join('\n') : '- none'}
`;
}

function computeOverall(report) {
  const values = Object.values(report.surfaces).map((s) => s.verdict);
  if (values.includes('FAIL')) return 'FAIL';
  if (values.includes('BLOCKED')) return 'BLOCKED';
  if (values.every((value) => value === 'SKIP')) return 'SKIP';
  return 'PASS';
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`verify.mjs — DSH artifacts extension verifier

  --static-only                manifest, bundle, syntax, command harness
  --http-only                  live routes (needs DSH_VERIFY_COOKIE)
  --skill create|store|tweaks  static harness + one skill
  --all                        everything available (default)
  --repo-root <dir>            repository root
  --skills-dir <dir>           default ~/.agents/skills
  --url <url>                  default http://127.0.0.1:3080
  --cdp <ws-url>               DevTools page WebSocket; runs the panel verifier
  --cookie <cookie>            or DSH_VERIFY_COOKIE
  --fixture <html>             artifact-create fixture
  --tweaks-file <html>         artifact-tweaks fixture
  --store-slug <slug>          artifact-store load/history target
  --out <dir>                  default verify-evidence/<timestamp>
  --strict                     artifact verifier warnings fail
  --probe-320                  run the 320px adjacent probe
  --tweaks-browser             run the paired browser verifier for tweaks
  --quiet                      summary only
  --json                       print report JSON
  --help                       show this help`);
    return 0;
  }

  const root = args.root ?? DEFAULT_ROOT;
  REPORT.root = root;
  REPORT.url = args.url;
  REPORT.quiet = args.quiet;
  REPORT.cookieProvided = Boolean(args.cookie ?? process.env.DSH_VERIFY_COOKIE);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = args.out ?? join(process.cwd(), 'verify-evidence', stamp);
  await ensureDir(out);
  REPORT.out = out;

  const version = await run('dsh', ['--version'], { timeout: 20_000 });
  REPORT.dsh = version.stdout.trim() || null;

  const modeAll = !args.staticOnly && !args.httpOnly && !args.skill;
  const runStatic = !args.httpOnly && (args.staticOnly || Boolean(args.skill) || modeAll);
  const runHttp = !args.staticOnly && !args.skill && (args.httpOnly || modeAll);
  const runCreate = args.skill === 'create' || modeAll;
  const runStore = args.skill === 'store' || modeAll;
  const runTweaks = args.skill === 'tweaks' || modeAll;

  if (runStatic) {
    await checkStatic(root, join(out, 'extension'));
  }

  let httpPayload = null;
  if (runHttp) {
    try {
      httpPayload = await checkHttp(args.url, args.cookie ?? process.env.DSH_VERIFY_COOKIE, join(out, 'extension'));
    } catch (error) {
      block('extension', `HTTP verifier failed: ${error.message}`);
    }
  }

  const config = await storeConfig();
  const index = await storeIndex(config);
  const fixture = await pickArtifactFixture(config, index, args.fixture);
  const tweaksFixture = await pickTweaksFixture(config, index, args.tweaksFile);
  const slug = args.storeSlug ?? process.env.DSH_VERIFY_SLUG ?? (index?.artifacts?.some((row) => row.slug === 'dsh-home') ? 'dsh-home' : index?.artifacts?.[0]?.slug);

  if (runCreate) {
    try {
      await checkArtifactCreate(args.skillsDir, fixture, join(out, 'artifact-create'), args.strict, args.probe320);
    } catch (error) {
      record('artifact-create', false, `verifier crashed: ${error.message}`);
    }
  }

  if (runStore) {
    try {
      await checkArtifactStore(args.skillsDir, slug, join(out, 'artifact-store'), httpPayload?.artifacts?.length);
    } catch (error) {
      record('artifact-store', false, `verifier crashed: ${error.message}`);
    }
  }

  if (runTweaks) {
    try {
      await checkArtifactTweaks(args.skillsDir, tweaksFixture, join(out, 'artifact-tweaks'), args.tweaksBrowser);
    } catch (error) {
      record('artifact-tweaks', false, `verifier crashed: ${error.message}`);
    }
  }

  if (runCreate) {
    REPORT.limitations.push('artifact-create: real /artifact-create model turn not driven (handler + skill verifier only)');
  }
  if (runStore) {
    REPORT.limitations.push('artifact-store: save/import/restore not exercised; verification is read-only');
  }
  if (runTweaks) {
    REPORT.limitations.push('artifact-tweaks: real /artifact-tweak model turn not driven (handler + audit only)');
  }

  if (modeAll && args.cdp) {
    try {
      await checkUi(args.cdp, args.url, args.cookie ?? process.env.DSH_VERIFY_COOKIE, join(out, 'ui'));
    } catch (error) {
      record('panel', false, `panel verifier crashed: ${error.message}`);
    }
  } else if (modeAll) {
    REPORT.limitations.push('panel: CDP not provided (pass --cdp ws://127.0.0.1:<port>/devtools/page/<id>)');
  }

  // Assign verdicts after all checks.
  for (const [name, s] of Object.entries(REPORT.surfaces)) {
    s.verdict = verdict(name);
  }

  REPORT.finishedAt = new Date().toISOString();
  REPORT.overall = computeOverall(REPORT);

  await writeFile(join(out, 'report.json'), pretty(REPORT));
  await writeFile(join(out, 'report.md'), renderMarkdown(REPORT));

  if (args.json) {
    console.log(pretty(REPORT));
  } else {
    console.log('\nSurface verdicts:');
    for (const [name, s] of Object.entries(REPORT.surfaces)) {
      console.log(`  ${s.verdict.padEnd(7)} ${name}  (${s.checks.filter((c) => c.ok).length}/${s.checks.length})`);
    }
    console.log(`\nOverall: ${REPORT.overall}`);
    console.log(`Evidence: ${out}`);
    if (REPORT.limitations.length) {
      console.log('Limitations:');
      for (const line of REPORT.limitations) console.log(`  - ${line}`);
    }
  }

  return REPORT.overall === 'PASS' ? 0 : REPORT.overall === 'FAIL' ? 1 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
