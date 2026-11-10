import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export async function installPointer(page) {
  await page.evaluate(() => {
    const pointer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pointer.id = 'recording-pointer'; pointer.setAttribute('viewBox', '0 0 24 32');
    pointer.style.cssText = 'position:fixed;left:1040px;top:36px;width:20px;height:28px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 1px #0008)';
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', 'M2 2 L2 25 L8 19 L13 30 L18 28 L13 18 L22 18 Z');
    shape.setAttribute('fill', 'white'); shape.setAttribute('stroke', '#111'); shape.setAttribute('stroke-width', '1.5');
    pointer.appendChild(shape); document.body.appendChild(pointer);
    document.addEventListener('mousemove', event => { pointer.style.left = event.clientX + 'px'; pointer.style.top = event.clientY + 'px'; });
  });
}

export async function startCapture(page, output) {
  await mkdir(join(output, 'raw/frames'), { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let writes = Promise.resolve();
  let started;
  let ready;
  const first = new Promise(resolve => { ready = resolve; });
  cdp.on('Page.screencastFrame', event => {
    const timestamp = event.metadata.timestamp * 1000;
    if (started === undefined) { started = timestamp; ready(); }
    const name = `frame-${String(frames.length).padStart(6, '0')}.jpg`;
    frames.push({ name, elapsed_ms: Math.max(0, timestamp - started) });
    writes = writes.then(() => writeFile(join(output, 'raw/frames', name), Buffer.from(event.data, 'base64')));
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 2560, maxHeight: 1600, everyNthFrame: 1 });
  await Promise.race([first, new Promise((_, reject) => setTimeout(() => reject(new Error('Real screen capture did not start')), 15000))]);
  return {
    get started() { return started; },
    async stop() {
      const duration = (Date.now() - started) / 1000;
      await cdp.send('Page.stopScreencast'); await writes;
      assert.ok(frames.length > 10);
      const rows = frames.map((frame, index) => `file 'frames/${frame.name}'\nduration ${Math.max(0.001, ((frames[index + 1]?.elapsed_ms ?? duration * 1000) - frame.elapsed_ms) / 1000).toFixed(6)}`);
      await writeFile(join(output, 'raw/capture.ffconcat'), `ffconcat version 1.0\n${rows.join('\n')}\nfile 'frames/${frames.at(-1).name}'\n`);
      await writeFile(join(output, 'raw/frames.json'), JSON.stringify({ duration_s: duration, frames }, null, 2));
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'concat', '-safe', '0', '-i', join(output, 'raw/capture.ffconcat'),
        '-t', String(duration), '-vf', 'scale=in_range=pc:out_range=tv,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart', join(output, 'raw/gt.mp4')], { timeout: 120000 });
      return { duration_s: duration, frames: frames.length };
    },
  };
}
