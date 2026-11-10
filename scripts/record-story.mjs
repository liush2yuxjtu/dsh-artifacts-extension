import { readFile, readdir, mkdir, lstat, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const source = process.env.DSH_SOURCE_ROOT;
if (!source || !process.env.DSH_CHROMIUM_PATH || !process.env.DSH_STORY_OUTPUT) throw new Error('Set DSH_SOURCE_ROOT, DSH_CHROMIUM_PATH and DSH_STORY_OUTPUT.');
if (!process.env.DEEPSEEK_API_KEY && process.env.DSH_API_KEY_FILE) process.env.DEEPSEEK_API_KEY = (await readFile(process.env.DSH_API_KEY_FILE, 'utf8')).trim();
const dependencies = [
  ['vitest', join(source, 'node_modules/vitest')],
  ['playwright', join(source, 'apps/web/node_modules/playwright')],
];
const packages = [];
for (const parent of ['vendor', 'apps']) {
  for (const entry of await readdir(join(source, parent), { withFileTypes: true })) if (entry.isDirectory()) packages.push(join(source, parent, entry.name));
}
for (const group of await readdir(join(source, 'packages'), { withFileTypes: true })) {
  if (!group.isDirectory()) continue;
  for (const entry of await readdir(join(source, 'packages', group.name), { withFileTypes: true })) if (entry.isDirectory()) packages.push(join(source, 'packages', group.name, entry.name));
}
for (const path of packages) {
  let pkg;
  try { pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')); } catch { continue; }
  if (pkg.name?.startsWith('@deepseek-ai/')) dependencies.push([pkg.name, path]);
}
for (const [name, target] of dependencies) {
  const local = join(root, 'node_modules', name);
  await mkdir(resolve(local, '..'), { recursive: true });
  try { await lstat(local); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(target, local, 'junction');
  }
}
await mkdir(process.env.DSH_STORY_OUTPUT, { recursive: true });
const child = spawn(process.execPath, [join(source, 'node_modules/vitest/vitest.mjs'), 'run', '--config', join(root, 'examples/story-20261111/story.config.mjs')], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DSH_SNAPSHOT: 'record', DSH_TELEMETRY_MODE: 'DISABLED' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
