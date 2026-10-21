#!/usr/bin/env node
/**
 * ui-verify.mjs — CDP verifier for the 工件 sidepanel.
 *
 * Requires a running dsh web page and its CDP WebSocket. The cookie is used
 * only for Network.setCookie and is never written to evidence.
 *
 * Exit: 0 PASS, 1 FAIL, 2 BLOCKED.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { widths: '1280x900,1024x900,820x900,390x844,320x800' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--cdp': out.cdp = next(); break;
      case '--url': out.url = next(); break;
      case '--cookie': out.cookie = next(); break;
      case '--out': out.out = resolve(next()); break;
      case '--widths': out.widths = next(); break;
      case '--help': out.help = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    }
  }
  return out;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 10_000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolvePromise();
      });
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP connect failed: ${event?.message ?? 'error'}`));
      });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve: resolvePromise, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolvePromise(message.result);
        return;
      }
      if (message.method) this.events.push(message);
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
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

  async waitFor(expression, timeoutMs = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(expression)) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(file, Buffer.from(data, 'base64'));
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

function parseSize(value) {
  const [width, height] = value.split('x').map(Number);
  return { width, height };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`ui-verify.mjs — panel CDP verifier

  --cdp <ws-url>   DevTools page WebSocket (required)
  --url <url>      default http://127.0.0.1:3080/
  --cookie <str>   or DSH_VERIFY_COOKIE
  --out <dir>      default verify-evidence/ui
  --widths <list>  default 1280x900,1024x900,820x900,390x844,320x800
  --help`);
    return 0;
  }

  const cdpUrl = args.cdp ?? process.env.DSH_VERIFY_CDP;
  if (!cdpUrl) {
    console.error('BLOCKED: --cdp or DSH_VERIFY_CDP is required');
    return 2;
  }
  const cookie = args.cookie ?? process.env.DSH_VERIFY_COOKIE;
  if (!cookie) {
    console.error('BLOCKED: --cookie or DSH_VERIFY_COOKIE is required');
    return 2;
  }
  const url = args.url ?? 'http://127.0.0.1:3080/';
  const out = args.out ?? join(process.cwd(), 'verify-evidence', 'ui');
  await mkdir(out, { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    url,
    cookieProvided: true,
    viewports: [],
    checks: [],
    errors: [],
    ok: false,
  };

  const check = (name, ok, detail) => {
    report.checks.push({ name, ok, detail: String(detail ?? '') });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail ?? ''}`);
  };

  const cdp = new Cdp(cdpUrl);
  try {
    await cdp.open();
  } catch (error) {
    console.error(`BLOCKED: ${error.message}`);
    return 2;
  }

  const [cookieName, ...cookieRest] = cookie.split('=');
  await cdp.send('Network.setCookie', {
    name: cookieName,
    value: cookieRest.join('='),
    url: new URL('/', url).href,
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  });

  const clickPanel = async () => {
    const clicked = await cdp.evaluate(`(() => {
      const wanted = '工件';
      const el = [...document.querySelectorAll('button, [role="button"], a')]
        .find((node) => (node.innerText || node.getAttribute('aria-label') || '').trim() === wanted);
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) return false;
    return cdp.waitFor(`document.querySelectorAll('.dsh-art__card').length > 0 || !!document.querySelector('.dsh-art__state')`, 20_000);
  };

  const measure = async (width) => {
    const panel = await cdp.evaluate(`(() => {
      const el = document.querySelector('.dsh-art');
      if (!el) return null;
      return { sw: el.scrollWidth, cw: el.clientWidth, cards: document.querySelectorAll('.dsh-art__card').length };
    })()`);
    const doc = await cdp.evaluate(`(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))()`);
    return { panel, doc, width };
  };

  const panelOrder = async () => {
    return cdp.evaluate(`(() => {
      const wanted = new Set(['插件', '工件', '自动化任务']);
      return [...document.querySelectorAll('button')]
        .map((node) => (node.innerText || node.getAttribute('aria-label') || '').trim())
        .filter((label) => wanted.has(label))
        .filter((label, index, all) => all.indexOf(label) === index);
    })()`);
  };

  const widths = args.widths.split(',').map((value) => parseSize(value.trim())).filter((v) => v.width > 0);

  for (const { width, height } of widths) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    await cdp.send('Page.navigate', { url });
    await cdp.waitFor('document.readyState === "complete" && document.body && document.body.innerText.length > 40', 25_000);
    const opened = await clickPanel();
    check(`viewport ${width}: panel opens`, opened, opened ? 'cards/state visible' : 'panel button or cards missing');

    const order = await panelOrder();
    check(
      `viewport ${width}: sidebar order`,
      order.length === 3 && order[0] === '插件' && order[1] === '工件' && order[2] === '自动化任务',
      order.join(' → '),
    );

    const measured = await measure(width);
    if (measured.panel) {
      check(`viewport ${width}: panel no h-overflow`, measured.panel.sw <= measured.panel.cw + 1, `scrollWidth ${measured.panel.sw} vs clientWidth ${measured.panel.cw}`);
      check(`viewport ${width}: cards > 0`, measured.panel.cards > 0, `${measured.panel.cards} cards`);
    }
    check(`viewport ${width}: document no h-overflow`, measured.doc.sw <= measured.doc.cw + 1, `scrollWidth ${measured.doc.sw} vs clientWidth ${measured.doc.cw}`);

    await cdp.screenshot(join(out, `panel-${width}.png`));
    report.viewports.push({ width, height, order, cards: measured.panel?.cards ?? 0, doc: measured.doc, panel: measured.panel });

    if (width === widths[0].width) {
      // Search filter.
      const total = measured.panel?.cards ?? 0;
      const filtered = await cdp.evaluate(`(async () => {
        const input = document.querySelector('.dsh-art__search input');
        if (!input) return -1;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'sleep');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 700));
        return document.querySelectorAll('.dsh-art__card').length;
      })()`);
      check('search filters cards', filtered !== -1 && filtered > 0 && filtered < total, `${filtered} of ${total}`);
      await cdp.evaluate(`(() => {
        const input = document.querySelector('.dsh-art__search input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await cdp.waitFor(`document.querySelectorAll('.dsh-art__card').length > 0`);

      // Detail preview.
      const openedDetail = await cdp.evaluate(`(() => {
        const card = document.querySelector('.dsh-art__card');
        if (!card) return false;
        card.click();
        return true;
      })()`);
      if (openedDetail) {
        const ready = await cdp.waitFor(`(() => {
          const frame = document.querySelector('.dsh-art__stage iframe');
          return frame && frame.srcdoc && frame.srcdoc.length > 500;
        })()`, 25_000);
        check('detail iframe renders', ready, ready ? 'srcdoc populated' : 'no iframe/srcdoc');
        const detail = await cdp.evaluate(`(() => {
          const frame = document.querySelector('.dsh-art__stage iframe');
          return {
            title: frame?.title ?? '',
            sandbox: frame?.getAttribute('sandbox') ?? '',
            srcdoc: frame?.srcdoc?.length ?? 0,
            crumbs: document.querySelector('.dsh-art__crumbs')?.innerText ?? '',
          };
        })()`);
        report.detail = detail;
        check('detail sandbox omits same-origin', !detail.sandbox.includes('allow-same-origin'), detail.sandbox);
        await cdp.screenshot(join(out, 'detail.png'));

        // Copy path toast.
        const toast = await cdp.evaluate(`(async () => {
          const button = [...document.querySelectorAll('button')].find((node) => node.innerText.trim() === '复制路径');
          if (!button) return '';
          button.click();
          await new Promise((r) => setTimeout(r, 500));
          return document.querySelector('.dsh-art__toast')?.innerText ?? '';
        })()`);
        check('copy path shows toast', toast.trim().length > 0, toast || 'no toast');
        await cdp.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
      } else {
        check('detail iframe renders', false, 'no card to open');
      }
    }
  }

  // Console/runtime errors.
  const errors = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text);
  const consoleErrors = cdp.events
    .filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
    .map((event) => event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  report.errors = [...errors, ...consoleErrors];
  check('no console errors / exceptions', report.errors.length === 0, report.errors.slice(0, 3).join(' | ') || 'none');

  cdp.close();
  report.finishedAt = new Date().toISOString();
  report.ok = report.checks.every((entry) => entry.ok);
  await writeFile(join(out, 'ui.json'), `${JSON.stringify(report, null, 2)}\n`);
  const md = [
    `# Panel verification — ${report.startedAt.slice(0, 10)}`,
    '',
    `Result: **${report.ok ? 'PASS' : 'FAIL'}**`,
    '',
    ...report.checks.map((entry) => `- ${entry.ok ? 'PASS' : 'FAIL'} — ${entry.name}: ${entry.detail}`),
    '',
  ].join('\n');
  await writeFile(join(out, 'ui.md'), md);
  console.log(`\n${report.ok ? 'PASS' : 'FAIL'} panel · evidence ${out}`);
  return report.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
