/**
 * Host half of the artifacts extension.
 *
 * Responsibilities:
 *  - register /artifact-create, /artifact-store and /artifact-tweak;
 *  - expose the local artifact-store cache over three read-only HTTP routes
 *    consumed by the "工件" sidebar panel.
 *
 * Nothing here writes to the store or to GitHub. The artifact-store skill
 * remains the only writer.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';

export const name = 'dsh-artifacts';
export const inject = ['commands', 'webServer', 'connection'];

const ROUTE = '/dsh-artifacts';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------------ */
/* Store cache                                                        */
/* ------------------------------------------------------------------ */

function expandHome(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

/** Read ~/.dsh/artifact-store.json, returning null when it does not exist. */
async function readStoreConfig() {
  let raw;
  try {
    raw = await readFile(join(homedir(), '.dsh', 'artifact-store.json'), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed.repo !== 'string' || !parsed.repo.includes('/')) {
    throw new Error('artifact-store.json has no "<owner>/<repo>" repo');
  }
  const cacheDir = expandHome(parsed.cacheDir ?? '~/.dsh/cache/artifact-store');
  return {
    repo: parsed.repo,
    branch: parsed.branch ?? 'main',
    basePath: parsed.basePath ?? 'artifacts',
    cacheDir,
    repoDir: join(cacheDir, parsed.repo.replace('/', '__')),
  };
}

function artifactDir(config, slug) {
  if (!SLUG_RE.test(slug)) return null;
  return join(config.repoDir, config.basePath, slug);
}

/**
 * Resolve one file inside an artifact directory, rejecting traversal and
 * symlinks that escape it. Returns null when the path is outside or missing.
 */
async function safeArtifactFile(dir, relative) {
  const root = resolve(dir);
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    const realRoot = await realpath(root);
    const realFile = await realpath(file);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) return null;
    return realFile;
  } catch {
    return null;
  }
}

function publicRows(config, rows) {
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title || row.slug,
    description: row.description || '',
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === 'string') : [],
    bytes: Number.isFinite(row.bytes) ? row.bytes : 0,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? row.createdAt ?? null,
    path: row.path ?? `${config.basePath}/${row.slug}/index.html`,
    repo: config.repo,
    preview: `${ROUTE}/preview/${row.slug}`,
    html: `${ROUTE}/html/${row.slug}`,
    view: `${ROUTE}/view/${row.slug}`,
    hasPreview: row.hasPreview === true,
    hasHtml: row.hasHtml !== false,
  }));
}

async function scanArtifacts(config) {
  const root = join(config.repoDir, config.basePath);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG_RE.test(entry.name)) continue;
    const dir = join(root, entry.name);
    let meta = {};
    try {
      meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    } catch {
      // A directory without meta.json is not a stored artifact.
      continue;
    }
    rows.push({
      ...meta,
      slug: entry.name,
      hasPreview: (await safeArtifactFile(dir, 'preview.png')) !== null,
      hasHtml: (await safeArtifactFile(dir, 'index.html')) !== null,
    });
  }
  return rows;
}

async function loadArtifacts() {
  let config;
  try {
    config = await readStoreConfig();
  } catch (error) {
    return { configured: true, available: false, error: String(error?.message ?? error), artifacts: [] };
  }
  if (config === null) {
    return {
      configured: false,
      available: false,
      error: 'artifact-store is not configured (~/.dsh/artifact-store.json is missing)',
      artifacts: [],
    };
  }

  try {
    const info = await stat(config.repoDir);
    if (!info.isDirectory()) throw new Error('not a directory');
  } catch {
    return {
      configured: true,
      available: false,
      repo: config.repo,
      error: `artifact-store cache not found at ${config.repoDir}`,
      artifacts: [],
    };
  }

  let rows;
  let updatedAt = null;
  try {
    const index = JSON.parse(await readFile(join(config.repoDir, 'index.json'), 'utf8'));
    rows = Array.isArray(index.artifacts) ? index.artifacts : [];
    updatedAt = index.updatedAt ?? null;
  } catch {
    rows = await scanArtifacts(config);
  }
  if (!Array.isArray(rows) || rows.length === 0) rows = await scanArtifacts(config);

  const hydrated = [];
  for (const row of rows) {
    if (!row || typeof row.slug !== 'string' || !SLUG_RE.test(row.slug)) continue;
    const dir = artifactDir(config, row.slug);
    hydrated.push({
      ...row,
      hasPreview: (await safeArtifactFile(dir, 'preview.png')) !== null,
      hasHtml: (await safeArtifactFile(dir, 'index.html')) !== null,
    });
  }
  hydrated.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));

  return {
    configured: true,
    available: true,
    repo: config.repo,
    branch: config.branch,
    updatedAt,
    artifacts: publicRows(config, hydrated),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP responses                                                     */
/* ------------------------------------------------------------------ */

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

function sendMethodNotAllowed(res, allow = 'GET') {
  res.statusCode = 405;
  res.setHeader('allow', allow);
  res.end();
}

function rejectUntrusted(ctx, req, res) {
  let connection;
  try {
    connection = Reflect.get(ctx, 'connection');
  } catch {
    connection = undefined;
  }
  if (!connection || typeof connection.requestRejection !== 'function') return false;
  const rejection = connection.requestRejection(req);
  if (rejection === undefined) return false;
  res.statusCode = rejection;
  res.end();
  return true;
}

async function serveFile(req, res, file) {
  const info = await stat(file).catch(() => null);
  if (info === null || !info.isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }
  const bytes = await readFile(file);
  res.statusCode = 200;
  res.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('content-length', bytes.byteLength);
  res.setHeader('cache-control', 'no-store');
  res.end(bytes);
}

function withBase(html, base) {
  if (/<base[\s>]/i.test(html)) return html;
  const tag = `<base href="${base}">`;
  const head = html.match(/<head(?:\s[^>]*)?>/i);
  if (head) return html.replace(head[0], `${head[0]}${tag}`);
  const htmlTag = html.match(/<html(?:\s[^>]*)?>/i);
  if (htmlTag) return html.replace(htmlTag[0], `${htmlTag[0]}<head>${tag}</head>`);
  return tag + html;
}

function slugFrom(pathname, prefix) {
  const rest = pathname.slice(prefix.length).replace(/^\/+/, '');
  return rest.split('/')[0];
}

/* ------------------------------------------------------------------ */
/* Slash commands                                                     */
/* ------------------------------------------------------------------ */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/**
 * Build the same immutable user message shape the Host's own commands use.
 * Kept dependency-free so the extension needs no runtime package imports.
 */
function userMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  });
}

const CREATE_USAGE = '用法：/artifact-create <要构建的工件描述>';
const STORE_USAGE =
  '用法：/artifact-store [list|status|save <文件>|load <slug>|history <slug>|restore <slug> <commit>]';
const TWEAK_USAGE = '用法：/artifact-tweak <目标工件与想要的 Tweaks 调整>';

const CREATE_PROMPT = (input) => `使用 artifact-create 技能构建一个独立 HTML 工件。

需求：
${input}

请先加载 artifact-create 技能，并完整执行它的流程：写六行 brief、确定 art direction、构建单文件 HTML（无构建步骤、无服务器依赖）、运行 verify-artifact 校验 1440/1024/820/390、检查截图。不要只把代码贴在聊天里。完成后报告：本地 HTML 路径、preview 路径、验证结果。`;

const TWEAK_PROMPT = (input) => `使用 artifact-tweaks 技能为工件添加 Tweaks 面板。

要求：
${input}

请先加载 artifact-tweaks 技能，按它的规范实现：面板 UI、accent/字体/圆角/密度/主题控制、localStorage 持久化、EDITMODE 状态块和 host postMessage 协议。改完后重新验证工件仍然通过 artifact-create 的检查。完成后报告文件路径和验证结果。`;

const STORE_PROMPT = (input) => `使用 artifact-store 技能执行下面的请求。

请求：
${input}

请先加载 artifact-store 技能，按它的说明操作私有 GitHub 仓库（从 ~/.dsh/artifact-store.json 读取 repo），不要猜测 slug。完成后报告：slug、commit SHA、仓库路径。`;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

async function storeSummary() {
  const data = await loadArtifacts();
  if (!data.configured) {
    return 'artifact-store 尚未配置：请先创建 ~/.dsh/artifact-store.json，或运行 artifact-store 技能的 init。';
  }
  if (!data.available) {
    return `无法读取 artifact-store 缓存：${data.error ?? '未知错误'}`;
  }
  if (data.artifacts.length === 0) {
    return `工件库为空（${data.repo}）。用 /artifact-create 创建，再用 /artifact-store save 保存。`;
  }
  const lines = data.artifacts.slice(0, 20).map((artifact) => {
    const date = formatDate(artifact.updatedAt);
    const size = formatBytes(artifact.bytes);
    return `- ${artifact.slug} — ${artifact.title}${date ? ` (${date})` : ''}${size ? ` · ${size}` : ''}`;
  });
  const more = data.artifacts.length > 20 ? `\n… 还有 ${data.artifacts.length - 20} 个` : '';
  return `工件库 ${data.artifacts.length} 个 · ${data.repo}\n\n${lines.join('\n')}${more}\n\n在侧栏「工件」面板中预览。`;
}

function followup(invocation, prompt) {
  invocation.agent.followup(userMessage(prompt));
}

function startCreate(invocation) {
  const input = invocation.rawInput.trim();
  if (input.length === 0) return { kind: 'error', text: CREATE_USAGE };
  followup(invocation, CREATE_PROMPT(input));
  return {
    kind: 'success',
    text: `已启动 artifact-create：${input.length > 60 ? `${input.slice(0, 60)}…` : input}\n完成后可用 /artifact-store save 保存到工件库。`,
  };
}

function startTweak(invocation) {
  const input = invocation.rawInput.trim();
  if (input.length === 0) return { kind: 'error', text: TWEAK_USAGE };
  followup(invocation, TWEAK_PROMPT(input));
  return {
    kind: 'success',
    text: `已启动 artifact-tweaks：${input.length > 60 ? `${input.slice(0, 60)}…` : input}`,
  };
}

async function runStore(invocation) {
  const input = invocation.rawInput.trim();
  if (input.length === 0) return { kind: 'success', text: await storeSummary() };
  const [verb] = input.split(/\s+/u);
  const command = verb.toLowerCase();
  if (command === 'help') return { kind: 'success', text: STORE_USAGE };
  if (command === 'list' || command === 'ls' || command === 'status') {
    return { kind: 'success', text: await storeSummary() };
  }
  if (['save', 'load', 'history', 'restore', 'init', 'remove', 'delete', 'pull', 'push'].includes(command)) {
    followup(invocation, STORE_PROMPT(input));
    return { kind: 'success', text: `已启动 artifact-store ${command}。` };
  }
  return { kind: 'error', text: `未知的 artifact-store 子命令：${verb}\n${STORE_USAGE}` };
}

/* ------------------------------------------------------------------ */
/* Plugin                                                             */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'artifact-create',
        description: '用 artifact-create 技能构建并验证一个独立 HTML 工件',
        input: { hint: '<要构建的工件描述>' },
        recordInput: false,
        handler: startCreate,
      }),
    'dsh-artifacts: /artifact-create',
  );

  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'artifact-store',
        description: '保存、列出、加载、版本化 HTML 工件（artifact-store 技能）',
        input: { hint: '[list|status|save|load|history|restore]' },
        handler: runStore,
      }),
    'dsh-artifacts: /artifact-store',
  );

  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'artifact-tweak',
        description: '用 artifact-tweaks 技能给工件加上可调参数面板',
        input: { hint: '<目标工件与想要的调整>' },
        recordInput: false,
        handler: startTweak,
      }),
    'dsh-artifacts: /artifact-tweak',
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE}/list`,
        handler: async (req, res) => {
          if (rejectUntrusted(ctx, req, res)) return;
          if (req.method !== 'GET') return sendMethodNotAllowed(res);
          try {
            sendJson(res, 200, await loadArtifacts());
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message ?? error) });
          }
        },
      }),
    `dsh-artifacts: GET ${ROUTE}/list`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: `${ROUTE}/preview`,
        handler: async (req, res) => {
          if (rejectUntrusted(ctx, req, res)) return;
          if (req.method !== 'GET') return sendMethodNotAllowed(res);
          const config = await readStoreConfig().catch(() => null);
          if (config === null) return sendText(res, 404, 'artifact-store is not configured');
          const slug = slugFrom(new URL(String(req.url), 'http://localhost').pathname, `${ROUTE}/preview`);
          const dir = artifactDir(config, slug);
          if (dir === null) return sendText(res, 404, 'Not found');
          const file = await safeArtifactFile(dir, 'preview.png');
          if (file === null) return sendText(res, 404, 'Not found');
          await serveFile(req, res, file);
        },
      }),
    `dsh-artifacts: GET ${ROUTE}/preview/<slug>`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: `${ROUTE}/html`,
        handler: async (req, res) => {
          if (rejectUntrusted(ctx, req, res)) return;
          if (req.method !== 'GET') return sendMethodNotAllowed(res);
          const config = await readStoreConfig().catch(() => null);
          if (config === null) return sendText(res, 404, 'artifact-store is not configured');
          const slug = slugFrom(new URL(String(req.url), 'http://localhost').pathname, `${ROUTE}/html`);
          const dir = artifactDir(config, slug);
          if (dir === null) return sendText(res, 404, 'Not found');
          const file = await safeArtifactFile(dir, 'index.html');
          if (file === null) return sendText(res, 404, 'Not found');
          sendText(res, 200, await readFile(file, 'utf8'), 'text/html; charset=utf-8');
        },
      }),
    `dsh-artifacts: GET ${ROUTE}/html/<slug>`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: `${ROUTE}/view`,
        handler: async (req, res) => {
          if (rejectUntrusted(ctx, req, res)) return;
          if (req.method !== 'GET') return sendMethodNotAllowed(res);
          const config = await readStoreConfig().catch(() => null);
          if (config === null) return sendText(res, 404, 'artifact-store is not configured');
          const slug = slugFrom(new URL(String(req.url), 'http://localhost').pathname, `${ROUTE}/view`);
          const dir = artifactDir(config, slug);
          if (dir === null) return sendText(res, 404, 'Not found');
          const file = await safeArtifactFile(dir, 'index.html');
          if (file === null) return sendText(res, 404, 'Not found');
          const html = withBase(await readFile(file, 'utf8'), `${ROUTE}/asset/${slug}/`);
          sendText(res, 200, html, 'text/html; charset=utf-8');
        },
      }),
    `dsh-artifacts: GET ${ROUTE}/view/<slug>`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: `${ROUTE}/asset`,
        handler: async (req, res) => {
          if (rejectUntrusted(ctx, req, res)) return;
          if (req.method !== 'GET') return sendMethodNotAllowed(res);
          const config = await readStoreConfig().catch(() => null);
          if (config === null) return sendText(res, 404, 'artifact-store is not configured');
          const pathname = new URL(String(req.url), 'http://localhost').pathname;
          const rest = pathname.slice(`${ROUTE}/asset/`.length);
          const slash = rest.indexOf('/');
          if (slash < 1) return sendText(res, 404, 'Not found');
          const slug = rest.slice(0, slash);
          const dir = artifactDir(config, slug);
          if (dir === null) return sendText(res, 404, 'Not found');
          let rel;
          try {
            rel = decodeURIComponent(rest.slice(slash + 1));
          } catch {
            return sendText(res, 400, 'Bad request');
          }
          const file = await safeArtifactFile(dir, rel);
          if (file === null) return sendText(res, 404, 'Not found');
          await serveFile(req, res, file);
        },
      }),
    `dsh-artifacts: GET ${ROUTE}/asset/<slug>/<path>`,
  );
}
