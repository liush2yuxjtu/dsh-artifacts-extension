import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Workspace } from "../workbench/store.js";
import {
  createSource,
  clone,
  validateSource,
  mergeSources,
  bounds,
  dataView,
  chartData,
  artifactHtml,
  artifactSvg,
} from "../workbench/model.js";
import { exportArtifact, parseCsv } from "../workbench/exports.js";
import { startHarness } from "../scripts/dev-workbench.mjs";
const exec = promisify(execFile);

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "artifacts-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new Workspace(dir);
}
function unzip(bytes) {
  const files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18),
      nameLen = bytes.readUInt16LE(offset + 26),
      extraLen = bytes.readUInt16LE(offset + 28),
      start = offset + 30 + nameLen + extraLen;
    files.set(
      bytes.subarray(offset + 30, offset + 30 + nameLen).toString(),
      bytes.subarray(start, start + size).toString(),
    );
    offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  return files;
}

test("every type starts from a valid editable schema", () => {
  for (const type of ["docs", "slides", "design", "data", "whiteboard", "html"])
    assert.equal(validateSource(createSource(type, "中文 & test")).type, type);
  assert.equal(createSource("design").frames.length, 3);
});
test("invalid geometry, relationships, themes and resource escapes are rejected", () => {
  const design = createSource("design");
  design.frames[0].elements[0].w = -2;
  assert.throws(() => validateSource(design), /dimensions/);
  const board = createSource("whiteboard");
  board.edges[0].to = "missing";
  assert.throws(() => validateSource(board), /endpoint/);
  const bad = createSource("design");
  bad.theme.fontFamily = "x; background:url(https://evil)";
  assert.throws(() => validateSource(bad), /font/);
  const html = createSource("html");
  html.assets = { "../secret": "YQ==" };
  assert.throws(() => validateSource(html), /resource path/);
});
test("save survives a new instance; restore appends and preserves all history", async (t) => {
  const store = await fixture(t),
    record = await store.create("docs", "Durable");
  const source = clone(record.source);
  source.body = "Hand-edited paragraph";
  const saved = await store.save(record.id, source, 1);
  assert.equal(
    (await new Workspace(store.root).get(record.id)).source.body,
    source.body,
  );
  assert.equal(saved.revision, 2);
  const restored = await store.restore(record.id, 1, 2);
  assert.equal(restored.revision, 3);
  assert.equal(restored.source.body, record.source.body);
  assert.equal(
    (await store.version(record.id, 2)).source.body,
    "Hand-edited paragraph",
  );
  assert.equal((await store.history(record.id)).length, 3);
});
test("simultaneous saves produce one winner and a recoverable 409", async (t) => {
  const store = await fixture(t),
    record = await store.create("docs", "Concurrent");
  const a = { ...record.source, body: "Editor A" },
    b = { ...record.source, body: "Editor B" };
  const results = await Promise.allSettled([
    store.save(record.id, a, 1),
    store.save(record.id, b, 1),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failure = results.find((r) => r.status === "rejected").reason;
  assert.equal(failure.status, 409);
  assert.ok(failure.detail.current);
  const recovery = await new Workspace(store.root).recovery(
    record.id,
    failure.detail.recoveryId,
  );
  assert.ok(["Editor A", "Editor B"].includes(recovery.source.body));
  assert.notEqual(
    recovery.source.body,
    (await store.get(record.id)).source.body,
  );
  assert.equal((await store.history(record.id)).length, 2);
});
test("a separate Agent CLI proposes without overwriting manual changes", async (t) => {
  const store = await fixture(t),
    record = await store.create("docs", "Original title");
  const request = await store.request(record.id, 1, {
    instruction: "Revise the paragraph",
    selection: "Write here",
  });
  const manual = { ...record.source, title: "Manual title survives" };
  await store.save(record.id, manual, 1);
  const proposed = {
      ...record.source,
      body: "Actually revised by the agent CLI path",
    },
    path = join(store.root, "proposal-source.tmp");
  await writeFile(path, JSON.stringify(proposed));
  await exec(
    process.execPath,
    [
      resolve("scripts/workspace.mjs"),
      "propose",
      record.id,
      request.id,
      "--file",
      path,
    ],
    { env: { ...process.env, DSH_ARTIFACTS_WORKSPACE: store.root } },
  );
  assert.equal((await store.get(record.id)).source.body, record.source.body);
  const proposal = (await store.get(record.id)).proposals[0];
  const result = await store.resolveProposal(
    record.id,
    proposal.id,
    "apply",
    2,
  );
  assert.equal(result.source.title, manual.title);
  assert.equal(result.source.body, proposed.body);
  assert.equal(result.revision, 3);
});
test("competing Agent and manual text edits preserve both alternatives", async (t) => {
  const store = await fixture(t),
    record = await store.create("docs", "Conflict");
  const request = await store.request(record.id, 1, { instruction: "Revise" });
  await store.save(
    record.id,
    { ...record.source, body: "My newer paragraph" },
    1,
  );
  const p = await store.propose(record.id, request.id, {
    ...record.source,
    body: "Agent paragraph",
  });
  await assert.rejects(
    store.resolveProposal(record.id, p.id, "apply", 2),
    (e) => e.status === 409 && e.detail.conflicts.includes("/body"),
  );
  assert.equal((await store.get(record.id)).source.body, "My newer paragraph");
  assert.equal(
    (await store.proposal(record.id, p.id)).source.body,
    "Agent paragraph",
  );
  assert.equal((await store.proposal(record.id, p.id)).status, "pending");
  await store.resolveProposal(record.id, p.id, "cancel", 2);
  assert.equal((await store.get(record.id)).revision, 2);
});
test("source and revision guards reject type changes and missing versions", async (t) => {
  const store = await fixture(t),
    record = await store.create("docs", "Safe");
  await assert.rejects(
    store.save(record.id, createSource("data"), 1),
    /type cannot change/,
  );
  await assert.rejects(
    store.save(record.id, record.source, undefined),
    (e) => e.status === 409,
  );
  await assert.rejects(
    store.restore(record.id, 700, 1),
    (e) => e.status === 404,
  );
  await assert.rejects(store.get("../escape"), (e) => e.status === 400);
});
test("workspace source symlinks cannot escape the local source directory", async (t) => {
  const store = await fixture(t);
  const path = join(store.root, "outside.tmp");
  await writeFile(path, '{"private":true}');
  await symlink(path, join(store.root, "escape.json"));
  await assert.rejects(store.get("escape"), /regular files/);
});
test("three-way merge retains independent object fields and reports array conflicts", () => {
  assert.deepEqual(
    mergeSources({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }),
    { value: { a: 2, b: 3 }, conflicts: [] },
  );
  assert.deepEqual(
    mergeSources({ list: [1] }, { list: [2] }, { list: [3] }).conflicts,
    ["/list"],
  );
});
test("data filters preserve raw rows and chart/export values agree", () => {
  const source = createSource("data");
  const before = JSON.stringify(source.rows);
  source.filter.value = "Jan";
  assert.equal(dataView(source).length, 1);
  assert.deepEqual(chartData(source), [{ label: "Jan", value: 120 }]);
  const csv = exportArtifact(source, "csv", {
    filtered: true,
  }).bytes.toString();
  assert.ok(csv.includes("Jan"));
  assert.ok(!csv.includes("Feb"));
  assert.ok(exportArtifact(source, "csv").bytes.toString().includes("Feb"));
  assert.equal(JSON.stringify(source.rows), before);
  assert.deepEqual(
    parseCsv('\ufeff"Name","Value"\r\n"A, B","1"\r\n"Two\nlines","x""y"\r\n'),
    [
      ["Name", "Value"],
      ["A, B", "1"],
      ["Two\nlines", 'x"y'],
    ],
  );
});
test("content exports exclude authoring chrome and retain live design links", () => {
  const source = createSource("design");
  const html = artifactHtml(source);
  assert.ok(html.includes('href="#details"'));
  assert.ok(html.includes("Explore details"));
  assert.ok(!html.includes("Global Tweaks"));
  assert.ok(!html.includes("resize-handle"));
  assert.ok(!html.includes("data-node"));
  const svg = artifactSvg(source);
  assert.ok(svg.includes("A considered space"));
  assert.ok(!svg.includes("selected"));
});
test("whiteboard export includes nodes at negative and distant positions", () => {
  const source = createSource("whiteboard");
  source.nodes[0].x = -800;
  source.nodes[1].x = 2500;
  const b = bounds(source.nodes);
  assert.ok(b.x < -800);
  assert.ok(b.x + b.width > 2500 + source.nodes[1].w);
  const svg = artifactSvg(source);
  assert.ok(svg.includes(`viewBox="${b.x} ${b.y} ${b.width} ${b.height}"`));
  assert.ok(svg.includes("marker-end"));
});
test("DOCX contains editable text and headings rather than screenshot wrappers", () => {
  const source = createSource("docs", "Editable 文档");
  source.body =
    "# Heading\n\n**Bold** and body\n[Source](https://example.com/?a=1&b=2)";
  const files = unzip(exportArtifact(source, "docx").bytes);
  const document = files.get("word/document.xml");
  assert.ok(document.includes("Heading1"));
  assert.ok(document.includes('<w:t xml:space="preserve">Bold</w:t>'));
  assert.ok(document.includes("<w:b/>"));
  assert.ok(!document.includes("drawing"));
  assert.ok(files.has("word/styles.xml"));
  assert.ok(document.includes("<w:hyperlink"));
  assert.ok(files.get("word/_rels/document.xml.rels").includes("a=1&amp;b=2"));
});
test("PPTX page sequence, text and positions reflect the current source", () => {
  const source = createSource("slides");
  source.frames.reverse();
  source.frames[0].elements[0].text = "Reordered first";
  source.frames[0].elements[0].x = 130;
  const files = unzip(exportArtifact(source, "pptx").bytes);
  assert.ok(
    files.get("ppt/slides/slide1.xml").includes("<a:t>Reordered first</a:t>"),
  );
  assert.ok(files.get("ppt/slides/slide1.xml").includes('x="1238250"'));
  assert.ok(files.get("ppt/slides/slide2.xml").includes("A new presentation"));
  assert.ok(files.has("ppt/slideMasters/slideMaster1.xml"));
  assert.ok(![...files.keys()].some((k) => k.startsWith("ppt/media")));
});
test("ZIP preserves editable source and all artboards; unavailable formats fail clearly", () => {
  const source = createSource("design"),
    files = unzip(exportArtifact(source, "zip").bytes);
  assert.equal(
    [...files.keys()].filter((k) => /page-\d.svg/.test(k)).length,
    3,
  );
  assert.deepEqual(JSON.parse(files.get("source.artifact.json")), source);
  assert.throws(() => exportArtifact(source, "docx"), /unavailable/);
});

test("HTML exports inline local scripts, styles and nested CSS resources without a host cookie", () => {
  const source = createSource("html");
  source.html =
    '<link rel="stylesheet" href="css/style.css"><script src="app.js"></script>';
  source.assets = {
    "css/style.css": Buffer.from(
      "body{background-image:url(../image.png)}",
    ).toString("base64"),
    "image.png": Buffer.from("image bytes").toString("base64"),
    "app.js": Buffer.from('document.body.dataset.works="yes"').toString(
      "base64",
    ),
  };
  const html = artifactHtml(source);
  assert.ok(html.includes("data:text/javascript;base64,"));
  const encoded = html.match(/data:text\/css;base64,([^"']+)/)[1];
  assert.ok(
    Buffer.from(encoded, "base64")
      .toString()
      .includes("data:image/png;base64,"),
  );
});
test("real host registration authenticates API and rejects cross-site/non-JSON writes", async (t) => {
  const store = await fixture(t);
  const app = await startHarness({ root: store.root });
  t.after(() => new Promise((done) => app.server.close(done)));
  const path = app.url + "/dsh-artifacts/asset/_workbench/api/artifacts";
  assert.equal((await fetch(path)).status, 401);
  const headers = {
    cookie: `artifacts-dev=${app.cookie}`,
    "content-type": "application/json",
  };
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers: { ...headers, origin: "https://wrong.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  const created = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "docs", title: "HTTP-created" }),
  });
  assert.equal(created.status, 201);
  const record = await created.json();
  assert.equal((await store.get(record.id)).source.title, "HTTP-created");
  const response = await fetch(
    path + "/" + record.id + "/export/1?format=docx",
    { headers },
  );
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-disposition").includes("attachment"));
  assert.equal(
    Buffer.from(await response.arrayBuffer()).readUInt32LE(0),
    0x04034b50,
  );
  assert.equal(
    (
      await fetch(path + "/" + record.id, {
        method: "POST",
        headers,
        body: JSON.stringify({ baseRevision: 0, source: record.source }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await fetch(app.url + "/dsh-artifacts/asset/_workbench/../store.js", {
        headers,
      })
    ).status,
    404,
  );
  assert.equal(app.commands.size, 3);
});
test("existing command lifecycle queues a pinned native edit, not an unguarded file rewrite", async (t) => {
  const store = await fixture(t),
    app = await startHarness({ root: store.root });
  t.after(() => new Promise((done) => app.server.close(done)));
  const record = await store.create("design", "Agent target");
  const request = await store.request(record.id, 1, {
    instruction: "More restrained, preserve interactions",
  });
  const calls = [];
  const result = await app.commands.get("artifact-store").handler({
    rawInput: `edit ${record.id} ${request.id}`,
    agent: { followup: (message) => calls.push(message) },
  });
  assert.equal(result.kind, "success");
  assert.equal(calls.length, 1);
  const text = calls[0].content[0].text;
  assert.ok(text.includes(`propose ${record.id} ${request.id}`));
  assert.ok(text.includes("base revision 1"));
  assert.ok(text.includes("do not replace workspace files"));
  assert.ok(Object.isFrozen(calls[0]));
});
