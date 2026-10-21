#!/usr/bin/env node
/**
 * Minimal CDP driver for verifying the DSH Web artifact panel.
 * Usage: node cdp-check.mjs <ws-url> [--shot out.png] [--eval "js"] [--click "selector"]
 */
import { writeFileSync } from 'node:fs';

const wsUrl = process.argv[2];
if (!wsUrl) throw new Error('missing ws url');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const ws = new WebSocket(wsUrl);
let seq = 0;
const pending = new Map();
const events = [];

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
    else resolve(msg.result);
    return;
  }
  if (msg.method) events.push(msg);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', (event) => reject(new Error(`CDP connect failed: ${event?.message ?? 'error'}`)), { once: true });
});

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

const viewport = arg('--viewport');
if (viewport) {
  const [width, height] = viewport.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

if (process.argv.includes('--dark')) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
}

const cookie = arg('--cookie');
if (cookie) {
  const [name, value] = cookie.split('=');
  await send('Network.setCookie', {
    name,
    value: value ?? '',
    url: 'http://127.0.0.1:3080/',
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  });
}

const target = arg('--navigate');
if (target) {
  await send('Page.navigate', { url: target });
  await wait(1200);
  // Wait until the shell has rendered something or 15s passes.
  for (let i = 0; i < 30; i += 1) {
    const ready = await evaluate('document.readyState');
    const text = await evaluate('document.body ? document.body.innerText.length : 0');
    if (ready === 'complete' && text > 50) break;
    await wait(500);
  }
}

const click = arg('--click');
if (click) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(click)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) {
    console.error('CLICK_NOT_FOUND', click);
  }
  await wait(1200);
}

const clickText = arg('--click-text');
if (clickText) {
  const ok = await evaluate(`(() => {
    const wanted = ${JSON.stringify(clickText)};
    const el = [...document.querySelectorAll('button, [role="button"], a')]
      .find((node) => (node.innerText || node.getAttribute('aria-label') || '').trim() === wanted);
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) {
    console.error('CLICK_TEXT_NOT_FOUND', clickText);
  }
  await wait(1800);
}

const evalJs = arg('--eval');
if (evalJs) {
  const value = await evaluate(evalJs);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

const shot = arg('--shot');
if (shot) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(shot, Buffer.from(data, 'base64'));
  console.error('SCREENSHOT', shot);
}

const errors = events
  .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
  .map((e) => (e.method === 'Runtime.exceptionThrown' ? e.params.exceptionDetails.text : e.params.args.map((a) => a.value ?? a.description).join(' ')));
if (errors.length) console.error('PAGE_ERRORS', JSON.stringify(errors.slice(0, 10), null, 2));

ws.close();
