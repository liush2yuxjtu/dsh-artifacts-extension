import {
  TYPES,
  DEFAULT_THEME,
  clone,
  equal,
  createSource,
  element,
  frame,
  uid,
  themeFor,
  bounds,
  artifactHtml,
  artifactSvg,
  chartSvg,
  dataView,
  whiteboardSvg,
} from "./model.js";

const BASE = new URL("./", import.meta.url);
const API = new URL("api/artifacts", BASE).pathname;
const LABELS = {
  docs: ["Docs", "Write, format and revise documents"],
  slides: ["Slides", "Arrange an editable presentation"],
  design: ["Design", "Shape interfaces across artboards"],
  data: ["Data", "Edit source data and explore charts"],
  whiteboard: ["Whiteboard", "Connect and organize your thinking"],
  html: ["HTML", "Edit and run an interactive artifact"],
};
const S = {
  rows: [],
  legacy: [],
  query: "",
  id: null,
  record: null,
  source: null,
  saved: null,
  dirty: false,
  saving: null,
  past: [],
  future: [],
  selection: [],
  page: 0,
  zoom: "fit",
  inspector: "properties",
  tweak: null,
  errors: [],
  instruction: "",
  requestCommand: "",
  conflict: null,
  timer: null,
  external: null,
  libraryOpen: false,
};
const root = document.getElementById("app");
let toastTimer;
let lastRenderedId;
function node(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on"))
      el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = value;
    else if (key === "value") continue;
    else if (key === "checked" || key === "disabled") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  // Set values after type/min/max/step. Range inputs otherwise clamp against
  // their temporary browser defaults before their real constraints are set.
  if (attrs.value !== undefined) el.value = attrs.value;
  for (const child of children.flat(Infinity))
    if (child !== undefined && child !== null && child !== false)
      el.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return el;
}
const btn = (text, fn, attrs = {}) =>
  node("button", { type: "button", onclick: fn, ...attrs }, text);
const row = (...children) => node("div", { class: "row" }, children);
const note = (text) => node("p", { class: "small muted" }, text);
function toast(message) {
  const target = document.getElementById("notifications");
  target.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (target.textContent = ""), 5000);
}
async function api(suffix = "", input) {
  const response = await fetch(API + suffix, {
    credentials: "same-origin",
    ...(input === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    Object.assign(error, data, { status: response.status });
    throw error;
  }
  return data;
}
function dialog(title, children, wide = false) {
  const el = node(
    "dialog",
    { class: wide ? "wide" : "", "aria-label": title },
    node(
      "div",
      { class: "dialog-head" },
      node("h2", {}, title),
      btn("Close", () => el.close(), { class: "quiet" }),
    ),
    ...children,
  );
  el.addEventListener("close", () => el.remove());
  document.body.append(el);
  el.showModal();
  return el;
}
function select(value, values, change, attrs = {}) {
  const el = node("select", {
    onchange: (event) => change(event.target.value),
    ...attrs,
  });
  for (const item of values) {
    const [v, label] = Array.isArray(item) ? item : [item, item];
    const option = node("option", { value: v }, label);
    option.selected = String(v) === String(value);
    el.append(option);
  }
  return el;
}
function field(label, value, change, attrs = {}) {
  const input = node("input", {
    value,
    "aria-label": label,
    ...attrs,
    onchange: (event) =>
      change(
        attrs.type === "number" || attrs.type === "range"
          ? Number(event.target.value)
          : event.target.value,
      ),
  });
  return node("label", {}, label, input);
}
function downloadBlob(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = node("a", { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("Copied");
  } catch {
    const text = node("textarea", { readonly: true, value });
    const el = dialog("Copy command", [text]);
    text.select();
    el.focus();
  }
}
function sourceName(suffix) {
  return `${S.source.title.replace(/[\\/:*?"<>|]/g, "-")}.${suffix}`;
}
function sourceText(source) {
  return source.type === "docs"
    ? `Title: ${source.title}\n\n${source.body}`
    : JSON.stringify(source, null, 2);
}
function comparison(before, after, beforeLabel, afterLabel) {
  const a = sourceText(before).split("\n"),
    b = sourceText(after).split("\n");
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const removed = a.slice(start, a.length - end),
    added = b.slice(start, b.length - end);
  return node(
    "div",
    { class: "stack" },
    note(`${removed.length} removed lines · ${added.length} added lines`),
    node(
      "pre",
      { class: "source-diff" },
      a
        .slice(Math.max(0, start - 2), start)
        .map((line) => node("span", { class: "diff-line" }, `  ${line}\n`)),
      removed.map((line) =>
        node("span", { class: "diff-line diff-remove" }, `− ${line}\n`),
      ),
      added.map((line) =>
        node("span", { class: "diff-line diff-add" }, `+ ${line}\n`),
      ),
      a
        .slice(a.length - end, a.length - end + 2)
        .map((line) => node("span", { class: "diff-line" }, `  ${line}\n`)),
    ),
    node(
      "div",
      { class: "diff-columns" },
      node(
        "div",
        {},
        node("h3", {}, beforeLabel),
        node("pre", {}, sourceText(before)),
      ),
      node(
        "div",
        {},
        node("h3", {}, afterLabel),
        node("pre", {}, sourceText(after)),
      ),
    ),
  );
}
function scheduleSave() {
  clearTimeout(S.timer);
  if (!S.conflict) S.timer = setTimeout(() => save(), 1000);
}
function status() {
  updateAgentReview();
  const label = document.querySelector(".save-state");
  if (label) {
    label.textContent = S.saving
      ? "Saving…"
      : S.conflict
        ? "Conflict · draft kept"
        : S.external
          ? "New saved version available"
          : S.dirty
            ? "Unsaved changes"
            : `Saved · v${S.record?.revision ?? 1}`;
    label.dataset.dirty = String(S.dirty);
  }
  const undoButton = document.querySelector('[data-action="undo"]'),
    redoButton = document.querySelector('[data-action="redo"]');
  if (undoButton) undoButton.disabled = !S.past.length || !!S.tweak;
  if (redoButton) redoButton.disabled = !S.future.length || !!S.tweak;
}
function updateAgentReview() {
  const strip = document.querySelector(".agent-strip");
  if (!strip) return;
  const existing = strip.querySelector('[data-action="agent-review"]');
  const pending = S.record?.proposals?.some(
    (proposal) => proposal.status === "pending",
  );
  if (pending && !existing)
    strip
      .querySelector(".row")
      ?.append(
        btn("Review Agent", () => reviewProposals(), {
          "data-action": "agent-review",
        }),
      );
  if (!pending) existing?.remove();
}
function mutate(fn, redraw = true, reason = "Edited") {
  const before = clone(S.source);
  fn(S.source);
  if (equal(before, S.source)) return;
  S.past.push(before);
  if (S.past.length > 100) S.past.shift();
  S.future = [];
  S.dirty = !equal(S.source, S.saved);
  S.reason = reason;
  scheduleSave();
  if (redraw) render();
  else status();
}
async function save(reason = S.reason || "Edited") {
  clearTimeout(S.timer);
  if (S.saving) await S.saving.catch(() => {});
  if (!S.id || !S.dirty) return true;
  if (S.conflict) {
    showConflict();
    return false;
  }
  const id = S.id,
    source = clone(S.source),
    baseRevision = S.record.revision;
  const job = api(`/${id}`, { source, baseRevision, reason });
  S.saving = job;
  status();
  try {
    const record = await job;
    if (S.id === id) {
      S.record = record;
      S.saved = source;
      S.dirty = !equal(S.source, source);
      S.external = null;
      updateRow(record);
      status();
      if (S.dirty) scheduleSave();
    }
    return true;
  } catch (error) {
    if (error.status === 409) {
      S.conflict = error;
      if (error.current) S.record.recoveries = error.current.recoveries;
    }
    toast(error.message);
    status();
    return false;
  } finally {
    S.saving = null;
    status();
  }
}
function updateRow(record) {
  const entry = {
    id: record.id,
    title: record.source.title,
    type: record.source.type,
    revision: record.revision,
    updatedAt: record.updatedAt,
  };
  const i = S.rows.findIndex((r) => r.id === entry.id);
  if (i < 0) S.rows.unshift(entry);
  else S.rows[i] = entry;
  renderLibrary();
}
function adopt(record) {
  S.id = record.id;
  S.record = record;
  S.source = clone(record.source);
  S.saved = clone(record.source);
  S.dirty = false;
  S.conflict = null;
  S.external = null;
  S.past = [];
  S.future = [];
  S.selection = [];
  S.page = 0;
  S.tweak = null;
  S.errors = [];
  S.instruction = "";
  S.libraryOpen = false;
  history.replaceState(null, "", `#${record.id}`);
  render();
}
async function openArtifact(id) {
  if (!(await save())) return;
  if (S.tweak) {
    toast("Apply or cancel the Tweaks preview before switching artifacts.");
    return;
  }
  try {
    adopt(await api(`/${id}`));
  } catch (error) {
    toast(error.message);
  }
}
function undo(redo = false) {
  const from = redo ? S.future : S.past,
    to = redo ? S.past : S.future;
  if (!from.length || S.tweak) return;
  to.push(clone(S.source));
  S.source = from.pop();
  S.page = Math.min(S.page, (S.source.frames?.length ?? 1) - 1);
  S.selection =
    S.source.frames || S.source.nodes
      ? S.selection.filter((id) => currentNodes().some((n) => n.id === id))
      : [];
  S.dirty = !equal(S.source, S.saved);
  S.reason = redo ? "Redo" : "Undo";
  scheduleSave();
  render();
}

function showConflict() {
  const el = dialog("Your draft is preserved", [
    node(
      "div",
      { class: "error" },
      S.conflict?.message || "A newer version exists.",
    ),
    note(
      "Download your draft or save it as a separate artifact before reloading. The saved history is unchanged.",
    ),
    node(
      "div",
      { class: "actions" },
      btn("Download my draft", () =>
        downloadBlob(
          JSON.stringify(S.source, null, 2),
          sourceName("artifact.json"),
          "application/json",
        ),
      ),
      btn("Save draft as a copy", async () => {
        try {
          const copy = await api("", {
            source: {
              ...clone(S.source),
              title: `${S.source.title} (recovered)`,
            },
          });
          clearTimeout(S.timer);
          el.close();
          adopt(copy);
          await refreshLibrary();
        } catch (error) {
          toast(error.message);
        }
      }),
      btn("Reload saved version", async () => {
        const record = await api(`/${S.id}`);
        el.close();
        adopt(record);
      }),
    ),
  ]);
}
async function recoveredDrafts() {
  try {
    const record = await api(`/${S.id}`);
    const el = dialog("Recovered drafts", [
      note(
        "These drafts were retained on disk when another editor saved first. Current source and all saved versions are preserved.",
      ),
      ...record.recoveries.map((item) =>
        node(
          "div",
          { class: "version-row" },
          node("span", { class: "grow" }, new Date(item.at).toLocaleString()),
          btn("Download", async () => {
            const draft = await api(`/${S.id}/recoveries/${item.id}`);
            downloadBlob(
              JSON.stringify(draft.source, null, 2),
              sourceName("recovered.artifact.json"),
              "application/json",
            );
          }),
          btn("Open as a copy", async () => {
            const draft = await api(`/${S.id}/recoveries/${item.id}`);
            const copy = await api("", {
              source: {
                ...draft.source,
                title: `${draft.source.title} (recovered)`,
              },
            });
            clearTimeout(S.timer);
            el.close();
            adopt(copy);
            updateRow(copy);
          }),
        ),
      ),
    ]);
  } catch (error) {
    toast(error.message);
  }
}
function newArtifact(type = "docs") {
  const title = node("input", {
    value: "Untitled",
    "aria-label": "Artifact title",
    required: true,
    maxlength: 300,
  });
  const typeInput = select(
    type,
    TYPES.map((t) => [t, LABELS[t][0]]),
    () => {},
    { "aria-label": "Artifact type" },
  );
  const form = node(
    "form",
    {
      class: "stack",
      onsubmit: async (event) => {
        event.preventDefault();
        if (!(await save())) return;
        if (S.tweak) {
          toast("Apply or cancel Tweaks before creating another artifact.");
          return;
        }
        try {
          const record = await api("", {
            type: typeInput.value,
            title: title.value,
          });
          el.close();
          adopt(record);
          updateRow(record);
        } catch (error) {
          toast(error.message);
        }
      },
    },
    node("label", {}, "Type", typeInput),
    node("label", {}, "Title", title),
    note("Stored on this machine. No repository configuration needed."),
    node(
      "div",
      { class: "actions" },
      node("button", { type: "submit", class: "primary" }, "Create artifact"),
    ),
  );
  const el = dialog("New artifact", [form]);
  title.select();
}
async function importFile(file) {
  if (!file || file.size > 2_000_000) {
    toast(
      "Choose a Markdown, HTML, CSV or artifact JSON file smaller than 2 MB.",
    );
    return;
  }
  if (!(await save())) return;
  if (S.tweak) {
    toast("Apply or cancel the Tweaks preview first.");
    return;
  }
  try {
    const text = await file.text(),
      title = file.name.replace(/\.[^.]+$/, "");
    let input;
    if (/\.csv$/i.test(file.name)) input = { csv: text, title };
    else if (/\.json$/i.test(file.name)) input = { source: JSON.parse(text) };
    else {
      const source = createSource(
        /\.html?$/i.test(file.name) ? "html" : "docs",
        title,
      );
      if (source.type === "html") source.html = text;
      else source.body = text;
      input = { source };
    }
    const record = await api("", input);
    adopt(record);
    updateRow(record);
  } catch (error) {
    toast(error.message);
  }
}
async function importLegacy(slug) {
  if (!(await save())) return;
  if (S.tweak) {
    toast("Apply or cancel the Tweaks preview first.");
    return;
  }
  try {
    const record = await api("", { legacySlug: slug });
    adopt(record);
    updateRow(record);
    toast(
      "Created an editable local copy. The original HTML cache is preserved.",
    );
  } catch (error) {
    toast(error.message);
  }
}
async function refreshLibrary() {
  const native = await api();
  S.rows = native.artifacts;
  try {
    const response = await fetch(new URL("../../list", BASE), {
      credentials: "same-origin",
    });
    const legacy = await response.json();
    S.legacy = legacy.artifacts ?? [];
  } catch {
    S.legacy = [];
  }
  renderLibrary();
}
function renderLibrary() {
  const target = document.getElementById("library-list");
  if (!target) return;
  target.replaceChildren();
  const query = S.query.trim().toLowerCase();
  target.append(node("div", { class: "library-section" }, "Local workspace"));
  for (const item of S.rows.filter((r) =>
    `${r.title} ${r.type}`.toLowerCase().includes(query),
  ))
    target.append(
      btn("", () => (item.error ? toast(item.error) : openArtifact(item.id)), {
        class: "library-item",
        "aria-current": String(S.id === item.id),
        title: item.title,
      }),
    );
  const buttons = target.querySelectorAll(".library-item");
  const visible = S.rows.filter((r) =>
    `${r.title} ${r.type}`.toLowerCase().includes(query),
  );
  buttons.forEach((button, i) =>
    button.append(
      node("strong", {}, visible[i].title),
      node(
        "span",
        {},
        visible[i].error
          ? "Source unavailable"
          : `${LABELS[visible[i].type]?.[0] ?? visible[i].type} · v${visible[i].revision}`,
      ),
    ),
  );
  if (!visible.length)
    target.append(
      node(
        "p",
        { class: "small muted", style: "padding:12px" },
        query ? "No matching artifacts" : "Create your first artifact",
      ),
    );
  if (S.legacy.length) {
    target.append(
      node("div", { class: "library-section" }, "Saved HTML · editable copies"),
    );
    for (const item of S.legacy.filter((r) =>
      `${r.title} ${r.description} ${(r.tags ?? []).join(" ")}`
        .toLowerCase()
        .includes(query),
    ))
      target.append(
        btn("", () => importLegacy(item.slug), {
          class: "library-item",
          title: "Create an editable local copy",
        }).appendChild(node("strong", {}, item.title)).parentNode,
      );
  }
}
function library() {
  const input = node("input", {
    type: "file",
    accept: ".json,.md,.txt,.csv,.html,.htm",
    hidden: true,
    onchange: (event) => importFile(event.target.files[0]),
  });
  return node(
    "aside",
    {
      class: `library${S.libraryOpen ? " open" : ""}`,
      "aria-label": "Artifact library",
    },
    node(
      "div",
      { class: "library-head" },
      row(
        node("h1", {}, "Artifacts"),
        node("div", { class: "spacer" }),
        btn(
          "Close",
          () => {
            S.libraryOpen = false;
            render();
          },
          { class: "quiet mobile-library" },
        ),
      ),
      note("Your local creative workspace"),
    ),
    node("input", {
      type: "search",
      placeholder: "Search artifacts",
      "aria-label": "Search artifacts",
      value: S.query,
      oninput: (event) => {
        S.query = event.target.value;
        renderLibrary();
      },
    }),
    btn("+ New artifact", () => newArtifact(), { class: "primary full" }),
    node("div", { id: "library-list", class: "library-list" }),
    node(
      "div",
      { class: "library-footer stack" },
      row(
        btn("Import file", () => input.click()),
        btn("Refresh", async () => {
          await refreshLibrary();
          if (S.external) await openArtifact(S.id);
        }),
      ),
      input,
      note("Private to this machine · export anytime"),
    ),
  );
}
function agentStrip() {
  return node(
    "div",
    { class: "agent-strip" },
    row(
      node("input", {
        value: S.instruction,
        placeholder:
          S.source.type === "design"
            ? "Describe an overall design direction…"
            : "Ask Agent to revise this artifact…",
        "aria-label": "Agent instruction",
        oninput: (event) => (S.instruction = event.target.value),
      }),
      btn("Ask Agent", () => requestAgent(), { class: "primary" }),
      S.record?.proposals?.some((p) => p.status === "pending") &&
        btn("Review Agent", () => reviewProposals(), {
          "data-action": "agent-review",
        }),
    ),
    note(
      "Uses the current artifact and selected text/objects. Copy the command into your DSH session; review the proposed result here.",
    ),
  );
}
async function requestAgent(instruction = S.instruction) {
  if (!instruction.trim()) {
    toast("Describe the change you want.");
    return;
  }
  if (!(await save())) return;
  try {
    const selection = document.getElementById("source-editor");
    const selectedText = selection
      ? selection.value.slice(selection.selectionStart, selection.selectionEnd)
      : S.selection.join(", ");
    const result = await api(`/${S.id}/requests`, {
      baseRevision: S.record.revision,
      instruction,
      selection: selectedText,
      errors: S.errors.join("\n"),
    });
    S.requestCommand = result.command;
    dialog("Send to your DSH Agent", [
      note(
        "Paste this command into the current DSH session. The Agent reads this exact artifact version and returns a proposal for review. Manual edits can continue while it works.",
      ),
      node("pre", {}, result.command),
      row(
        btn("Copy command", () => copy(result.command), { class: "primary" }),
        btn("Check for proposal", () => reviewProposals()),
      ),
    ]);
  } catch (error) {
    toast(error.message);
  }
}
function contentHtml(source) {
  let html = artifactHtml(source);
  if (source.type === "html" && Object.keys(source.assets ?? {}).length)
    html =
      `<base href="${new URL(`api/artifacts/${S.id}/resource/`, BASE).href}">` +
      html;
  return html;
}
function previewHtml(source) {
  const html = contentHtml(source);
  const script = `<script>addEventListener('error',function(e){parent.postMessage({type:'artifact-preview-error',id:${JSON.stringify(S.id)},message:String(e.message)+' @ '+String(e.filename)+':'+e.lineno},'*')});addEventListener('unhandledrejection',function(e){parent.postMessage({type:'artifact-preview-error',id:${JSON.stringify(S.id)},message:String(e.reason)},'*')});addEventListener('message',function(e){if(e.source!==parent||e.data?.type!=='artifact-preview-snapshot-request')return;parent.postMessage({type:'artifact-preview-snapshot',id:${JSON.stringify(S.id)},requestId:e.data.requestId,html:'<!doctype html>'+document.documentElement.outerHTML},'*')});<\/script>`;
  return html.includes("<head>")
    ? html.replace("<head>", "<head>" + script)
    : script + html;
}
function preview(source = S.source, attrs = {}) {
  return node("iframe", {
    title: `${source.title} preview`,
    class: "preview",
    sandbox: "allow-scripts",
    srcdoc: previewHtml(source),
    "data-preview": "true",
    ...attrs,
  });
}
window.addEventListener("message", (event) => {
  if (
    !event.data ||
    event.data.type !== "artifact-preview-error" ||
    event.data.id !== S.id ||
    ![...document.querySelectorAll("iframe[data-preview]")].some(
      (f) => f.contentWindow === event.source,
    )
  )
    return;
  const message = String(event.data.message).slice(0, 2000);
  if (S.errors.includes(message)) return;
  S.errors.push(message);
  const box = document.getElementById("preview-errors");
  if (box) {
    box.replaceChildren(
      node("div", { class: "error" }, S.errors.join("\n")),
      btn("Ask Agent to repair", () =>
        requestAgent(
          "Fix the preview runtime errors while preserving the current content and interactions.",
        ),
      ),
    );
  }
});
function header() {
  return node(
    "header",
    { class: "work-header" },
    btn(
      "Library",
      () => {
        S.libraryOpen = true;
        render();
      },
      { class: "mobile-library" },
    ),
    node(
      "div",
      { class: "work-title" },
      node("input", {
        value: S.source.title,
        "aria-label": "Artifact title",
        maxlength: 300,
        oninput: (event) =>
          mutate((source) => (source.title = event.target.value), false),
      }),
      node(
        "div",
        { class: "meta" },
        node("span", {}, LABELS[S.source.type][0]),
        node("span", { class: "save-state", role: "status" }),
        S.external && btn("Load newer version", () => openArtifact(S.id)),
        S.conflict && btn("Recover draft", showConflict),
        S.record?.recoveries?.length > 0 &&
          btn("Recovered drafts", recoveredDrafts),
      ),
    ),
    node(
      "div",
      { class: "header-tools" },
      btn("Undo", () => undo(), {
        "data-action": "undo",
        disabled: !S.past.length || !!S.tweak,
        title: "Ctrl/⌘ Z",
      }),
      btn("Redo", () => undo(true), {
        "data-action": "redo",
        disabled: !S.future.length || !!S.tweak,
      }),
      btn("Save", () => save(), { title: "Ctrl/⌘ S" }),
      btn("History", historyDialog),
      btn("Export", exportDialog, { class: "primary" }),
    ),
  );
}
function welcome() {
  return node(
    "div",
    { class: "welcome" },
    node(
      "div",
      { class: "welcome-inner" },
      node("h1", {}, "Make something worth keeping."),
      node(
        "p",
        {},
        "Create an artifact, work directly on it, and bring in your Agent when you need another perspective. Every saved version stays here.",
      ),
      node(
        "div",
        { class: "type-list" },
        TYPES.map(
          (type) =>
            btn("", () => newArtifact(type), {
              class: "type-choice",
            }).appendChild(node("strong", {}, LABELS[type][0])).parentNode,
        ).map((button, i) => {
          button.append(node("span", {}, LABELS[TYPES[i]][1]));
          return button;
        }),
      ),
    ),
  );
}
function render() {
  const scroll =
    lastRenderedId === S.id
      ? [
          ...document.querySelectorAll(
            ".canvas-scroll,.pages,.inspector,.data-main",
          ),
        ].map((el) => [el.className, el.scrollLeft, el.scrollTop])
      : [];
  root.replaceChildren(
    node(
      "div",
      { class: "app-shell" },
      library(),
      node(
        "main",
        { class: "work-area" },
        S.source ? [header(), editor(), agentStrip()] : welcome(),
      ),
    ),
  );
  renderLibrary();
  status();
  for (const [className, x, y] of scroll) {
    const el = [
      ...document.querySelectorAll(
        ".canvas-scroll,.pages,.inspector,.data-main",
      ),
    ].find((item) => item.className === className);
    if (el) {
      el.scrollLeft = x;
      el.scrollTop = y;
    }
  }
  lastRenderedId = S.id;
}

function editor() {
  if (S.source.type === "docs" || S.source.type === "html") return textEditor();
  if (S.source.type === "data") return dataEditor();
  return canvasEditor();
}
function textEditor() {
  const docs = S.source.type === "docs",
    key = docs ? "body" : "html";
  const area = node("textarea", {
    id: "source-editor",
    class: "source-editor",
    value: S.source[key],
    spellcheck: String(docs),
    "aria-label": docs ? "Document Markdown" : "HTML source",
    oninput: (event) => {
      mutate((source) => (source[key] = event.target.value), false);
      clearTimeout(S.previewTimer);
      S.previewTimer = setTimeout(() => {
        const iframe = document.getElementById("text-preview");
        if (iframe) iframe.srcdoc = previewHtml(S.source);
      }, 300);
    },
  });
  const format = (before, after = before) => {
    const start = area.selectionStart,
      end = area.selectionEnd,
      value = area.value,
      selected = value.slice(start, end);
    mutate(
      (source) =>
        (source.body =
          value.slice(0, start) + before + selected + after + value.slice(end)),
    );
    const next = document.getElementById("source-editor");
    next.focus();
    next.setSelectionRange(start + before.length, end + before.length);
  };
  const toolbar = docs
    ? [
        btn("Bold", () => format("**")),
        btn("Italic", () => format("*")),
        btn("Heading", () => format("## ", "")),
        btn("List", () => format("- ", "")),
        btn("Code", () => format("`")),
        btn("Link", () => format("[", "](https://example.com)")),
      ]
    : [
        btn("Run preview", () => {
          S.errors = [];
          render();
        }),
        note("Scripts run in an isolated preview"),
      ];
  return node(
    "div",
    { class: "editor" },
    node(
      "div",
      { class: "editor-toolbar" },
      toolbar,
      node(
        "span",
        { class: "muted" },
        docs
          ? "Markdown · select text for Agent"
          : "HTML · runtime errors appear below",
      ),
    ),
    node(
      "div",
      { class: "split-editor" },
      area,
      node(
        "div",
        { class: "preview-wrap" },
        node("div", { class: "preview-label" }, "Preview"),
        preview(S.source, { id: "text-preview" }),
        node(
          "div",
          { id: "preview-errors", class: "preview-errors" },
          S.errors.length
            ? node("div", { class: "error" }, S.errors.join("\n"))
            : null,
        ),
      ),
    ),
  );
}

function currentNodes() {
  return S.source.type === "whiteboard"
    ? S.source.nodes
    : S.source.frames[S.page].elements;
}
function selectedNodes() {
  return currentNodes().filter((n) => S.selection.includes(n.id));
}
function addObject(kind) {
  const values = {
    x: 48 + (currentNodes().length % 6) * 24,
    y: 120 + (currentNodes().length % 5) * 30,
    text:
      kind === "text"
        ? "Your text"
        : kind === "sticky"
          ? "A new idea"
          : kind === "button"
            ? "Continue"
            : "",
  };
  const object = element(kind, values);
  mutate(() => {
    currentNodes().push(object);
    S.selection = [object.id];
  });
}
function deleteObjects() {
  if (!S.selection.length) return;
  mutate((source) => {
    const ids = S.selection;
    if (source.type === "whiteboard") {
      source.nodes = source.nodes.filter((n) => !ids.includes(n.id));
      source.edges = source.edges.filter(
        (e) => !ids.includes(e.from) && !ids.includes(e.to),
      );
    } else
      source.frames[S.page].elements = currentNodes().filter(
        (n) => !ids.includes(n.id),
      );
    S.selection = [];
  });
}
function alignObjects(kind) {
  const selected = selectedNodes();
  if (!selected.length) return;
  mutate(() => {
    const minX = Math.min(...selected.map((n) => n.x)),
      minY = Math.min(...selected.map((n) => n.y)),
      maxX = Math.max(...selected.map((n) => n.x + n.w));
    const page = S.source.frames?.[S.page];
    for (const n of selected) {
      if (kind === "left") n.x = selected.length > 1 ? minX : 32;
      if (kind === "top") n.y = selected.length > 1 ? minY : 32;
      if (kind === "center")
        n.x =
          selected.length > 1
            ? (minX + maxX - n.w) / 2
            : ((page?.width ?? 960) - n.w) / 2;
    }
  });
}
function pageActions(action) {
  if (S.tweak) {
    toast("Apply or cancel the Tweaks preview first.");
    return;
  }
  mutate((source) => {
    const pages = source.frames;
    if (action === "add") {
      pages.push(
        frame(`Page ${pages.length + 1}`, {
          width: pages[0].width,
          height: pages[0].height,
        }),
      );
      S.page = pages.length - 1;
    }
    if (action === "duplicate") {
      const copy = clone(pages[S.page]);
      copy.id = uid();
      copy.title += " copy";
      copy.elements.forEach((n) => (n.id = uid()));
      pages.splice(S.page + 1, 0, copy);
      S.page++;
    }
    if (action === "delete" && pages.length > 1) {
      pages.splice(S.page, 1);
      S.page = Math.max(0, S.page - 1);
    }
    const target =
      action === "up" ? S.page - 1 : action === "down" ? S.page + 1 : -1;
    if (target >= 0 && target < pages.length) {
      const [item] = pages.splice(S.page, 1);
      pages.splice(target, 0, item);
      S.page = target;
    }
    S.selection = [];
  });
}
function pageRail() {
  return node(
    "nav",
    { class: "pages", "aria-label": "Pages" },
    S.source.frames.map((page, i) =>
      node(
        "div",
        {
          class: "page-row",
          draggable: true,
          ondragstart: (e) => e.dataTransfer.setData("text/plain", String(i)),
          ondragover: (e) => e.preventDefault(),
          ondrop: (e) => {
            e.preventDefault();
            const index = Number(e.dataTransfer.getData("text/plain"));
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index >= S.source.frames.length ||
              S.tweak
            )
              return;
            mutate((source) => {
              const [item] = source.frames.splice(index, 1);
              source.frames.splice(i, 0, item);
              S.page = i;
              S.selection = [];
            });
          },
        },
        btn(
          "",
          () => {
            if (S.tweak && S.tweak.scope !== "global") {
              toast("Apply or cancel this artboard preview first.");
              return;
            }
            S.page = i;
            S.selection = [];
            render();
          },
          {
            class: i === S.page ? "active" : "",
            "aria-label": `Page ${i + 1}: ${page.title}`,
          },
        )
          .appendChild(
            node(
              "small",
              {},
              `${i + 1}${Object.keys(page.overrides ?? {}).length ? " · override" : ""}`,
            ),
          )
          .parentNode.appendChild(document.createTextNode(page.title))
          .parentNode,
      ),
    ),
    node(
      "div",
      { class: "page-actions" },
      btn("+ Page", () => pageActions("add")),
      btn("Copy", () => pageActions("duplicate")),
      btn("Move up", () => pageActions("up"), { disabled: S.page === 0 }),
      btn("Move down", () => pageActions("down"), {
        disabled: S.page === S.source.frames.length - 1,
      }),
      btn("Delete", () => pageActions("delete"), {
        disabled: S.source.frames.length === 1,
        class: "danger",
      }),
    ),
  );
}
function draftSource() {
  if (!S.tweak) return S.source;
  const source = clone(S.source);
  if (S.tweak.scope === "global")
    source.theme = { ...source.theme, ...S.tweak.values };
  else
    source.frames[S.page].overrides = {
      ...source.frames[S.page].overrides,
      ...S.tweak.values,
    };
  return source;
}
function scaleFor(width) {
  if (S.zoom !== "fit") return Number(S.zoom);
  const available =
    window.innerWidth < 430
      ? window.innerWidth - 30
      : window.innerWidth -
        (window.innerWidth <= 760 ? 0 : window.innerWidth <= 1050 ? 180 : 220) -
        (S.source.type === "whiteboard"
          ? 0
          : window.innerWidth <= 1050
            ? 120
            : 152) -
        (window.innerWidth <= 1050 ? 214 : 246) -
        64;
  return Math.max(0.12, Math.min(1, available / width));
}
function canvasEditor() {
  const board = S.source.type === "whiteboard",
    design = S.source.type === "design",
    draft = draftSource();
  const tools = [
    btn("Text", () => addObject("text")),
    btn("Rectangle", () => addObject("rect")),
    btn("Ellipse", () => addObject("ellipse")),
    board
      ? btn("Sticky", () => addObject("sticky"))
      : btn("Button", () => addObject("button")),
    board &&
      btn("Connect", connectNodes, { disabled: S.selection.length !== 2 }),
    btn("Delete object", deleteObjects, { disabled: !S.selection.length }),
    select(
      S.zoom,
      [
        ["fit", "Fit"],
        ["0.25", "25%"],
        ["0.5", "50%"],
        ["0.75", "75%"],
        ["1", "100%"],
        ["1.5", "150%"],
      ],
      (value) => {
        S.zoom = value;
        render();
      },
      { "aria-label": "Canvas zoom" },
    ),
    S.source.type === "slides" &&
      btn("Present", () =>
        dialog(
          "Presentation",
          [
            preview(S.source, {
              class: "review-preview",
              style: "height:65vh",
            }),
          ],
          true,
        ),
      ),
  ];
  const canvas = node("div", {
    class: "canvas-scroll",
    "aria-label": board ? "Whiteboard canvas" : "Artboard canvas",
  });
  if (board) {
    const b = bounds(draft.nodes, 64),
      scale = scaleFor(Math.max(800, b.width));
    const artboard = node("div", {
      class: "artboard current",
      style: `width:${b.width}px;height:${Math.max(500, b.height)}px;transform:scale(${scale});background:${draft.theme.background}`,
      onpointerdown: (event) => {
        if (event.target === artboard) {
          S.selection = [];
          render();
        }
      },
    });
    const edgeSvg = node("div", { class: "edge-layer" });
    edgeSvg.innerHTML = whiteboardSvg({
      ...draft,
      nodes: draft.nodes.map((n) => ({ ...n, x: n.x - b.x, y: n.y - b.y })),
    }).replace(/<rect[^>]*\/>/, "");
    // Only connections belong behind native editable node elements.
    const svg = edgeSvg.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", `0 0 ${b.width} ${Math.max(500, b.height)}`);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
    }
    if (svg)
      for (const child of [...svg.children])
        if (child.tagName !== "defs" && !child.hasAttribute("data-connection"))
          child.remove();
    artboard.append(
      edgeSvg,
      ...draft.nodes.map((n) => objectNode(n, draft.theme, scale, b.x, b.y, 0)),
    );
    canvas.append(
      node(
        "div",
        {
          class: "frame-wrapper",
          style: `width:${b.width * scale}px;height:${Math.max(500, b.height) * scale}px`,
        },
        artboard,
      ),
    );
  } else {
    const pages = design ? draft.frames : [draft.frames[S.page]];
    pages.forEach((page) => {
      const pageIndex = draft.frames.findIndex((p) => p.id === page.id),
        scale = scaleFor(page.width),
        theme = themeFor(draft, page);
      const artboard = node(
        "div",
        {
          class: `artboard${pageIndex === S.page ? " current" : ""}`,
          style: `width:${page.width}px;height:${page.height}px;transform:scale(${scale});background:${theme.background}`,
          onpointerdown: (event) => {
            if (event.target === artboard) {
              S.page = pageIndex;
              S.selection = [];
              render();
            }
          },
        },
        page.elements.map((n) => objectNode(n, theme, scale, 0, 0, pageIndex)),
      );
      canvas.append(
        node(
          "div",
          { class: "frame-caption" },
          `${pageIndex + 1} / ${page.title}`,
          node(
            "span",
            {},
            Object.keys(page.overrides ?? {}).length
              ? "Artboard override"
              : "Follows global",
          ),
        ),
        node(
          "div",
          {
            class: "frame-wrapper",
            style: `width:${page.width * scale}px;height:${page.height * scale}px`,
          },
          artboard,
        ),
      );
    });
  }
  return node(
    "div",
    { class: "editor" },
    node("div", { class: "editor-toolbar" }, tools),
    S.tweak &&
      node(
        "div",
        { class: "tweak-bar" },
        node(
          "span",
          { class: "grow" },
          `Previewing ${S.tweak.scope === "global" ? "global direction" : "this artboard"} · not yet applied`,
        ),
        btn("Cancel preview", () => {
          S.tweak = null;
          render();
        }),
        btn("Apply Tweaks", applyTweaks, { class: "primary" }),
      ),
    node(
      "div",
      { class: "canvas-layout" },
      !board && pageRail(),
      canvas,
      inspector(),
    ),
    node(
      "div",
      { class: "canvas-info" },
      "Shift-click to select several objects · drag to move · use Properties to resize and align · arrow keys to nudge",
    ),
  );
}
function objectNode(object, theme, scale, offsetX, offsetY, pageIndex) {
  const selected =
    S.selection.includes(object.id) &&
    (S.source.type === "whiteboard" || S.page === pageIndex);
  const background =
    object.fill ??
    (object.kind === "text"
      ? "transparent"
      : object.kind === "button"
        ? theme.accent
        : object.kind === "sticky"
          ? "#fff1a8"
          : "#eef1f6");
  const el = node(
    "div",
    {
      class: `object${selected ? " selected" : ""}`,
      tabindex: 0,
      role: "option",
      "aria-selected": String(selected),
      "aria-label": `${object.kind}: ${object.text || "shape"}`,
      "data-node": object.id,
      style: `left:${object.x - offsetX}px;top:${object.y - offsetY}px;width:${object.w}px;height:${object.h}px;padding:${object.kind === "text" ? 0 : 12 * theme.spacing}px;border-radius:${object.kind === "ellipse" ? "50%" : `${object.radius ?? theme.radius}px`};background:${background};color:${object.color ?? (object.kind === "button" ? "#ffffff" : theme.foreground)};font-family:${theme.fontFamily};font-size:${(object.fontSize ?? (object.kind === "text" ? 24 : 18)) * theme.fontScale}px;box-shadow:${object.kind === "text" ? "none" : `0 6px 20px rgba(0,0,0,${theme.shadow})`}`,
      onpointerdown: (event) => dragObject(event, object.id, scale, pageIndex),
      ondblclick: () => {
        S.page = pageIndex;
        S.selection = [object.id];
        render();
        document.querySelector('[aria-label="Object text"]')?.focus();
      },
      onkeydown: (event) => {
        if (event.key === "Enter") {
          S.page = pageIndex;
          S.selection = [object.id];
          render();
        }
      },
    },
    object.text,
  );
  if (selected)
    el.append(
      node("span", {
        class: "resize-handle",
        "data-resize": "true",
        "aria-hidden": "true",
      }),
    );
  return el;
}
function dragObject(event, id, scale, pageIndex) {
  if (event.button !== 0 || S.tweak) return;
  event.preventDefault();
  if (S.source.type !== "whiteboard" && S.page !== pageIndex) {
    S.page = pageIndex;
    S.selection = [];
  }
  const nodes = currentNodes(),
    clicked = nodes.find((n) => n.id === id),
    group = clicked.group
      ? nodes.filter((n) => n.group === clicked.group).map((n) => n.id)
      : [id];
  if (event.shiftKey)
    S.selection = S.selection.includes(id)
      ? S.selection.filter((item) => !group.includes(item))
      : [...new Set([...S.selection, ...group])];
  else if (!S.selection.includes(id)) S.selection = group;
  const original = clone(S.source),
    selected = selectedNodes(),
    positions = selected.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
    }));
  const x = event.clientX,
    y = event.clientY,
    resize = !!event.target.closest("[data-resize]");
  let moved = false;
  document
    .querySelectorAll(".object")
    .forEach((el) =>
      el.classList.toggle("selected", S.selection.includes(el.dataset.node)),
    );
  const controller = new AbortController();
  window.addEventListener(
    "pointermove",
    (e) => {
      const dx = (e.clientX - x) / scale,
        dy = (e.clientY - y) / scale;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      for (const p of positions) {
        const object = nodes.find((n) => n.id === p.id);
        if (!object) continue;
        if (resize) {
          object.w = Math.max(8, Math.round(p.w + dx));
          object.h = Math.max(8, Math.round(p.h + dy));
        } else {
          object.x = Math.round(p.x + dx);
          object.y = Math.round(p.y + dy);
        }
        const el = [...document.querySelectorAll(".object")].find(
          (item) => item.dataset.node === p.id,
        );
        if (el) {
          if (resize) {
            el.style.width = `${object.w}px`;
            el.style.height = `${object.h}px`;
          } else
            el.style.transform = `translate(${object.x - p.x}px,${object.y - p.y}px)`;
        }
      }
    },
    { signal: controller.signal },
  );
  const finish = () => {
    controller.abort();
    if (moved) {
      S.past.push(original);
      S.future = [];
      S.dirty = !equal(S.source, S.saved);
      S.reason = resize ? "Resized objects" : "Moved objects";
      scheduleSave();
    }
    render();
  };
  window.addEventListener("pointerup", finish, {
    once: true,
    signal: controller.signal,
  });
  window.addEventListener("pointercancel", finish, {
    once: true,
    signal: controller.signal,
  });
}
function inspector() {
  const design = S.source.type === "design",
    board = S.source.type === "whiteboard";
  const panel = node(
    "aside",
    { class: "inspector", "aria-label": "Inspector" },
    design &&
      node(
        "div",
        { class: "tabs" },
        btn(
          "Properties",
          () => {
            S.inspector = "properties";
            render();
          },
          { class: S.inspector === "properties" ? "active" : "" },
        ),
        btn(
          "Global Tweaks",
          () => {
            S.inspector = "tweaks";
            render();
          },
          { class: S.inspector === "tweaks" ? "active" : "" },
        ),
      ),
  );
  if (design && S.inspector === "tweaks") {
    panel.append(tweaksInspector());
    return panel;
  }
  const selected = selectedNodes();
  panel.append(
    node(
      "h2",
      {},
      selected.length ? `${selected.length} selected` : "Properties",
    ),
  );
  if (!board) {
    const page = S.source.frames[S.page];
    panel.append(
      node(
        "div",
        { class: "stack" },
        field("Page title", page.title, (value) =>
          mutate(() => (page.title = value)),
        ),
        design &&
          node(
            "div",
            { class: "properties-grid" },
            field(
              "Page width",
              page.width,
              (value) => mutate(() => (page.width = Math.max(100, value))),
              { type: "number", min: 100 },
            ),
            field(
              "Page height",
              page.height,
              (value) => mutate(() => (page.height = Math.max(100, value))),
              { type: "number", min: 100 },
            ),
          ),
      ),
    );
  }
  if (!selected.length)
    panel.append(
      node(
        "p",
        { class: "empty-properties section" },
        "Select an object on the canvas to edit its text, dimensions and appearance. Hold Shift to select several objects.",
      ),
    );
  else {
    const first = selected[0],
      update = (key, value) =>
        mutate(() => selected.forEach((n) => (n[key] = value)));
    panel.append(
      node(
        "div",
        { class: "stack section" },
        node(
          "label",
          {},
          "Text",
          node("textarea", {
            value: first.text,
            "aria-label": "Object text",
            rows: 3,
            onchange: (e) => update("text", e.target.value),
          }),
        ),
        node(
          "div",
          { class: "properties-grid" },
          ["x", "y", "w", "h"].map((key) =>
            field(
              { x: "X", y: "Y", w: "Width", h: "Height" }[key],
              Math.round(first[key]),
              (value) =>
                update(
                  key,
                  ["w", "h"].includes(key) ? Math.max(8, value) : value,
                ),
              { type: "number", step: 1 },
            ),
          ),
        ),
        node(
          "div",
          { class: "properties-grid" },
          field(
            "Font size",
            first.fontSize ?? 24,
            (value) => update("fontSize", value),
            { type: "number", min: 6, max: 240 },
          ),
          field(
            "Corner radius",
            first.radius ??
              themeFor(S.source, S.source.frames?.[S.page]).radius,
            (value) => update("radius", value),
            { type: "number", min: 0, max: 500 },
          ),
          field(
            "Fill",
            first.fill ?? "#eef1f6",
            (value) => update("fill", value),
            { type: "color" },
          ),
          field(
            "Text color",
            first.color ?? S.source.theme.foreground,
            (value) => update("color", value),
            { type: "color" },
          ),
        ),
        first.kind === "button" &&
          field("Button link", first.action ?? "", (value) => {
            if (/^(https?:\/\/|#|$)/.test(value)) update("action", value);
            else toast("Use an http(s) URL or an anchor.");
          }),
        row(
          btn("Align left", () => alignObjects("left")),
          btn("Center", () => alignObjects("center")),
          btn("Align top", () => alignObjects("top")),
        ),
        row(
          btn(
            "Group",
            () => {
              const group = uid();
              mutate(() => selected.forEach((n) => (n.group = group)));
            },
            { disabled: selected.length < 2 },
          ),
          btn("Ungroup", () =>
            mutate(() => selected.forEach((n) => delete n.group)),
          ),
          btn("Reset style", () =>
            mutate(() =>
              selected.forEach((n) =>
                ["fill", "color", "radius", "fontSize"].forEach(
                  (key) => delete n[key],
                ),
              ),
            ),
          ),
        ),
        note(
          "Object overrides are kept when global Tweaks change. Reset style to follow the theme again.",
        ),
      ),
    );
  }
  if (board && S.source.edges.length)
    panel.append(
      node(
        "div",
        { class: "section stack" },
        node("h3", {}, "Connections"),
        S.source.edges.map((edge) =>
          row(
            node("input", {
              value: edge.label,
              "aria-label": "Connection label",
              class: "grow",
              onchange: (e) => mutate(() => (edge.label = e.target.value)),
            }),
            btn("Remove", () =>
              mutate(
                (source) =>
                  (source.edges = source.edges.filter(
                    (item) => item.id !== edge.id,
                  )),
              ),
            ),
          ),
        ),
      ),
    );
  return panel;
}
function connectNodes() {
  if (S.selection.length !== 2) return;
  mutate((source) =>
    source.edges.push({
      id: uid(),
      from: S.selection[0],
      to: S.selection[1],
      label: "connects to",
    }),
  );
}
function tweaksInspector() {
  const page = S.source.frames[S.page],
    scope = S.tweak?.scope ?? "global";
  const controls = node(
    "div",
    { class: "stack" },
    node("h2", {}, "Design direction"),
    note(
      "A coordinated preview across typography, spacing, color, shape, elevation and motion.",
    ),
    node(
      "label",
      {},
      "Scope",
      select(
        scope,
        [
          ["global", "Global · all following artboards"],
          ["page", `Override · ${page.title}`],
        ],
        (value) => {
          S.tweak = { scope: value, values: {} };
          render();
        },
        { "aria-label": "Tweaks scope" },
      ),
    ),
    note(
      `${S.source.frames.filter((p) => !Object.keys(p.overrides ?? {}).length).length} artboards follow global · ${S.source.frames.filter((p) => Object.keys(p.overrides ?? {}).length).length} have overrides. Object Properties are preserved.`,
    ),
  );
  const values = {
    ...DEFAULT_THEME,
    ...S.source.theme,
    ...(scope === "page" ? page.overrides : {}),
    ...S.tweak?.values,
  };
  const update = (key, value) => {
    if (!S.tweak) S.tweak = { scope, values: {} };
    S.tweak.values[key] = value;
    render();
  };
  controls.append(
    node(
      "label",
      {},
      "Typeface",
      select(
        values.fontFamily,
        ["system-ui", "Georgia", "Arial", "monospace"],
        (value) => update("fontFamily", value),
        { "aria-label": "Global typeface" },
      ),
    ),
    ...[
      ["fontScale", "Type scale", 0.5, 2, 0.05],
      ["spacing", "Spacing rhythm", 0.5, 2, 0.05],
      ["radius", "Corner language", 0, 48, 1],
      ["shadow", "Elevation", 0, 0.3, 0.01],
      ["motion", "Motion duration (ms)", 0, 600, 25],
    ].map(([key, label, min, max, step]) =>
      field(
        `${label} · ${values[key]}`,
        values[key],
        (value) => update(key, value),
        { type: "range", min, max, step, "aria-label": label },
      ),
    ),
    node(
      "div",
      { class: "properties-grid" },
      ...[
        ["background", "Surface"],
        ["foreground", "Ink"],
        ["accent", "Accent"],
        ["muted", "Secondary"],
      ].map(([key, label]) =>
        field(label, values[key], (value) => update(key, value), {
          type: "color",
          "aria-label": `Global ${label}`,
        }),
      ),
    ),
    btn(
      "Restore artboard to global",
      () => {
        S.tweak = null;
        mutate(() => (page.overrides = {}), true, "Artboard follows global");
      },
      { disabled: !Object.keys(page.overrides ?? {}).length },
    ),
    note(
      "For a complex direction such as “more Apple-like, keep all content and actions”, describe it to your Agent below. The Agent proposes a complete design change for review.",
    ),
  );
  return controls;
}
async function applyTweaks() {
  if (!S.tweak) return;
  const draft = clone(S.tweak);
  S.tweak = null;
  mutate(
    (source) => {
      if (draft.scope === "global")
        source.theme = { ...source.theme, ...draft.values };
      else
        source.frames[S.page].overrides = {
          ...source.frames[S.page].overrides,
          ...draft.values,
        };
    },
    true,
    draft.scope === "global"
      ? "Applied global Tweaks"
      : "Applied artboard override",
  );
  await save();
}

function dataEditor() {
  const source = S.source,
    chart = node("div", { class: "chart-container" });
  chart.innerHTML = chartSvg(source);
  const filtered = dataView(source);
  const visible = filtered.slice(0, 250);
  const body = node(
    "tbody",
    {},
    visible.map((values) => {
      const index = source.rows.indexOf(values);
      return node(
        "tr",
        {},
        values.map((value, col) =>
          node(
            "td",
            {},
            node("input", {
              value: value ?? "",
              "aria-label": `Row ${index + 1} ${source.columns[col]}`,
              onchange: (e) =>
                mutate((s) => (s.rows[index][col] = e.target.value)),
            }),
          ),
        ),
        node(
          "td",
          {},
          btn("×", () => mutate((s) => s.rows.splice(index, 1)), {
            "aria-label": `Delete row ${index + 1}`,
          }),
        ),
      );
    }),
  );
  const table = node(
    "div",
    { class: "table-scroll" },
    node(
      "table",
      { "aria-label": "Editable source data" },
      node(
        "thead",
        {},
        node(
          "tr",
          {},
          source.columns.map((column) => node("th", {}, column)),
          node("th", {}, ""),
        ),
      ),
      body,
    ),
  );
  const config = node(
    "aside",
    { class: "inspector stack", "aria-label": "Chart configuration" },
    node("h2", {}, "Chart & data"),
    node(
      "label",
      {},
      "Chart type",
      select(
        source.chart.kind,
        ["bar", "line", "pie"],
        (value) => mutate((s) => (s.chart.kind = value)),
        { "aria-label": "Chart type" },
      ),
    ),
    node(
      "label",
      {},
      "Category",
      select(
        source.chart.x,
        source.columns,
        (value) => mutate((s) => (s.chart.x = value)),
        { "aria-label": "Chart category" },
      ),
    ),
    node(
      "label",
      {},
      "Measure",
      select(
        source.chart.y,
        source.columns,
        (value) => mutate((s) => (s.chart.y = value)),
        { "aria-label": "Chart measure" },
      ),
    ),
    node(
      "label",
      {},
      "Aggregation",
      select(
        source.chart.aggregation,
        ["sum", "mean", "count"],
        (value) => mutate((s) => (s.chart.aggregation = value)),
        { "aria-label": "Aggregation" },
      ),
    ),
    field(
      "Chart color",
      source.chart.color,
      (value) => mutate((s) => (s.chart.color = value)),
      { type: "color" },
    ),
    node(
      "div",
      { class: "section stack" },
      node("h3", {}, "Filter view"),
      node(
        "label",
        {},
        "Column",
        select(
          source.filter.column,
          source.columns,
          (value) => mutate((s) => (s.filter.column = value)),
          { "aria-label": "Filter column" },
        ),
      ),
      node(
        "label",
        {},
        "Operator",
        select(
          source.filter.operator,
          ["contains", "equals", "gt", "lt"],
          (value) => mutate((s) => (s.filter.operator = value)),
          { "aria-label": "Filter operator" },
        ),
      ),
      field("Filter value", source.filter.value, (value) =>
        mutate((s) => (s.filter.value = value)),
      ),
      btn("Clear filter", () => mutate((s) => (s.filter.value = ""))),
      note(
        "Filtering changes the view. All original rows remain in the source.",
      ),
    ),
    node(
      "label",
      { class: "section" },
      "Data source",
      node("textarea", {
        value: source.provenance,
        "aria-label": "Data source",
        rows: 3,
        onchange: (e) => mutate((s) => (s.provenance = e.target.value)),
      }),
    ),
    node(
      "label",
      {},
      "Calculation notes",
      node("textarea", {
        value: source.calculation,
        "aria-label": "Calculation notes",
        rows: 4,
        onchange: (e) => mutate((s) => (s.calculation = e.target.value)),
      }),
    ),
  );
  return node(
    "div",
    { class: "editor" },
    node(
      "div",
      { class: "data-layout" },
      node(
        "div",
        { class: "data-main" },
        chart,
        node(
          "div",
          { class: "table-summary" },
          node("h2", {}, "Source data"),
          row(
            btn("+ Row", () =>
              mutate((s) => s.rows.push(s.columns.map(() => ""))),
            ),
            btn("+ Column", () => {
              const name = `Column ${source.columns.length + 1}`;
              mutate((s) => {
                s.columns.push(name);
                s.rows.forEach((r) => r.push(""));
              });
            }),
          ),
        ),
        table,
        node(
          "div",
          { class: "source-note" },
          `${filtered.length} of ${source.rows.length} source rows${visible.length < filtered.length ? " · first 250 shown, all rows included in exports" : ""}`,
        ),
        note(source.provenance),
        note(
          `${source.chart.aggregation}(${source.chart.y}) grouped by ${source.chart.x}. ${source.chart.kind === "pie" ? "Pie charts show positive values only." : ""} ${source.calculation}`,
        ),
      ),
      config,
    ),
  );
}

async function historyDialog() {
  try {
    const { versions } = await api(`/${S.id}/history`);
    const detail = node("div", {});
    const list = node(
      "div",
      { class: "history-list" },
      [...versions].reverse().map((version) =>
        node(
          "div",
          { class: "version-row" },
          node(
            "div",
            { class: "grow" },
            node("strong", {}, `v${version.revision} · ${version.reason}`),
            note(new Date(version.at).toLocaleString()),
          ),
          btn("Compare", async () => {
            const {
              versions: [old],
            } = await api(`/${S.id}/history/${version.revision}`);
            detail.replaceChildren(
              comparison(
                old.source,
                S.source,
                `Version ${version.revision}`,
                "Current working draft",
              ),
            );
          }),
          btn("Restore", async () => {
            if (!(await save())) return;
            try {
              const record = await api(`/${S.id}/restore`, {
                targetRevision: version.revision,
                baseRevision: S.record.revision,
              });
              el.close();
              adopt(record);
              updateRow(record);
              toast(
                `Restored v${version.revision} as v${record.revision}. Previous history is preserved.`,
              );
            } catch (error) {
              toast(error.message);
            }
          }),
        ),
      ),
    );
    const el = dialog(
      "Version history",
      [
        note(
          "Every restore creates a new version. Compare either version with the current draft.",
        ),
        list,
        detail,
      ],
      true,
    );
  } catch (error) {
    toast(error.message);
  }
}
async function reviewProposals() {
  try {
    const record = await api(`/${S.id}`);
    S.record.proposals = record.proposals;
    const pending = record.proposals.filter((p) => p.status === "pending");
    if (!pending.length) {
      toast(
        "No Agent proposal yet. Run the copied command in your DSH session first.",
      );
      return;
    }
    if (pending.length === 1) return reviewProposal(pending[0].id);
    const el = dialog(
      "Agent proposals",
      pending.map((p) =>
        btn(
          p.summary,
          () => {
            el.close();
            reviewProposal(p.id);
          },
          { class: "full" },
        ),
      ),
    );
  } catch (error) {
    toast(error.message);
  }
}
async function reviewProposal(id) {
  try {
    const proposal = await api(`/${S.id}/proposals/${id}`),
      errors = node("div", {});
    const el = dialog(
      "Review Agent proposal",
      [
        node("p", {}, proposal.summary),
        note(
          `Based on saved version ${proposal.baseRevision}. Newer independent edits are merged when applied; conflicts stay available for recovery.`,
        ),
        preview(proposal.source, { class: "review-preview" }),
        node(
          "details",
          {},
          node("summary", {}, "Compare source changes"),
          node(
            "div",
            { class: "diff-columns" },
            node(
              "div",
              {},
              node("h3", {}, "Current draft"),
              node("pre", {}, JSON.stringify(S.source, null, 2)),
            ),
            node(
              "div",
              {},
              node("h3", {}, "Agent proposal"),
              node("pre", {}, JSON.stringify(proposal.source, null, 2)),
            ),
          ),
        ),
        errors,
        node(
          "div",
          { class: "actions" },
          btn("Save proposal as a copy", async () => {
            const record = await api("", {
              source: {
                ...proposal.source,
                title: `${proposal.source.title} (Agent proposal)`,
              },
            });
            updateRow(record);
            toast("Proposal saved as a separate editable artifact.");
          }),
          btn("Cancel proposal", async () => {
            if (!(await save())) return;
            const record = await api(`/${S.id}/proposals/${id}`, {
              action: "cancel",
              baseRevision: S.record.revision,
            });
            S.record = record;
            el.close();
            render();
          }),
          btn(
            "Apply proposal",
            async () => {
              if (!(await save())) return;
              try {
                const record = await api(`/${S.id}/proposals/${id}`, {
                  action: "apply",
                  baseRevision: S.record.revision,
                });
                el.close();
                adopt(record);
                updateRow(record);
                toast("Agent changes applied as a new recoverable version.");
              } catch (error) {
                errors.replaceChildren(
                  node(
                    "div",
                    { class: "error" },
                    `${error.message}${error.conflicts ? "\nConflicting fields: " + error.conflicts.join(", ") : ""}`,
                  ),
                );
              }
            },
            { class: "primary" },
          ),
        ),
      ],
      true,
    );
  } catch (error) {
    toast(error.message);
  }
}
async function exportDialog() {
  if (S.tweak) {
    toast(
      "Apply or cancel Tweaks before exporting. Exports use the applied design.",
    );
    return;
  }
  if (!(await save())) return;
  const formats = [
    ["json", "Editable source · JSON"],
    [
      "html",
      S.source.type === "html" && Object.keys(S.source.assets ?? {}).length
        ? "HTML · use ZIP for resources"
        : "Runnable HTML",
    ],
    ["zip", "HTML + editable source · ZIP"],
  ];
  if (S.source.type === "docs")
    formats.unshift(["md", "Markdown"], ["docx", "Editable Word · DOCX"]);
  if (S.source.type === "slides")
    formats.unshift(["pptx", "Editable PowerPoint · PPTX"]);
  if (S.source.type === "data")
    formats.unshift(
      ["csv", "Source data · CSV"],
      ["csv-filtered", "Filtered view · CSV"],
    );
  if (["data", "design", "slides", "whiteboard"].includes(S.source.type))
    formats.push(["svg", "Vector · SVG"], ["png", "Image · PNG"]);
  const help = S.source.frames
    ? note(
        `SVG and PNG export the selected page (${S.page + 1}); ZIP includes every page. PPTX and PDF include all pages.`,
      )
    : note(
        "The editable JSON source can be imported again. Export controls and selection outlines are excluded.",
      );
  dialog("Export artifact", [
    help,
    node(
      "div",
      { class: "export-grid" },
      formats.map(([format, label]) =>
        btn(label, async () => {
          try {
            if (!(await save())) return;
            if (format === "png") return pngExport();
            const filtered = format.endsWith("-filtered"),
              realFormat = filtered ? format.replace("-filtered", "") : format;
            const url = `${API}/${S.id}/export/${S.record.revision}?format=${realFormat}&page=${S.page}&filtered=${filtered}`;
            const response = await fetch(url, { credentials: "same-origin" });
            if (!response.ok) throw new Error((await response.json()).error);
            downloadBlob(
              await response.blob(),
              sourceName(`${filtered ? "filtered." : ""}${realFormat}`),
              response.headers.get("content-type"),
            );
          } catch (error) {
            toast(error.message);
          }
        }),
      ),
      btn("PDF · browser print dialog", printExport),
    ),
    note(
      "PDF opens your browser’s print dialog. Choose “Save as PDF”. PNG requires the browser’s image renderer; neither format needs deployment.",
    ),
  ]);
}
async function pngExport() {
  try {
    const svg = artifactSvg(S.source, S.page),
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () =>
          reject(
            new Error(
              "This browser could not render the SVG. Export SVG instead.",
            ),
          );
        image.src = url;
      });
      const scale = Math.min(2, 8192 / Math.max(image.width, image.height));
      const canvas = node("canvas");
      canvas.width = Math.ceil(image.width * scale);
      canvas.height = Math.ceil(image.height * scale);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG rendering failed. Export SVG instead.");
      downloadBlob(blob, sourceName("png"), "image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    toast(error.message);
  }
}
async function printExport() {
  if (!(await save())) return;
  let html = contentHtml(S.source);
  if (S.source.type === "html") {
    const target = document.getElementById("text-preview")?.contentWindow;
    if (!target) {
      toast("Run the HTML preview before printing.");
      return;
    }
    try {
      html = await new Promise((resolve, reject) => {
        const requestId = uid();
        const receive = (event) => {
          if (
            event.source !== target ||
            event.data?.type !== "artifact-preview-snapshot" ||
            event.data.requestId !== requestId
          )
            return;
          clearTimeout(timer);
          window.removeEventListener("message", receive);
          resolve(String(event.data.html));
        };
        const timer = setTimeout(() => {
          window.removeEventListener("message", receive);
          reject(
            new Error(
              "Preview is still loading. Run it, then try printing again.",
            ),
          );
        }, 2500);
        window.addEventListener("message", receive);
        target.postMessage(
          { type: "artifact-preview-snapshot-request", requestId },
          "*",
        );
      });
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  // Print a passive snapshot. User scripts keep their opaque preview origin and
  // never receive the workbench's origin just to access the print dialog.
  const documentCopy = new DOMParser().parseFromString(html, "text/html");
  documentCopy.querySelectorAll("script").forEach((script) => script.remove());
  documentCopy.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes])
      if (attribute.name.startsWith("on"))
        element.removeAttribute(attribute.name);
  });
  const printFrame = node("iframe", {
    sandbox: "allow-same-origin allow-modals",
    title: "Print artifact",
    style: "position:fixed;left:-12000px;width:1200px;height:900px",
  });
  printFrame.addEventListener(
    "load",
    () => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
    },
    { once: true },
  );
  printFrame.srcdoc =
    "<!doctype html>" + documentCopy.documentElement.outerHTML;
  document.body.append(printFrame);
  setTimeout(() => printFrame.remove(), 120000);
  toast("Print dialog opened. Choose Save as PDF.");
}

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
  const input = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
  if (
    !input &&
    !document.querySelector("dialog[open]") &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "z"
  ) {
    event.preventDefault();
    undo(event.shiftKey);
  }
  if (
    input ||
    document.querySelector("dialog[open]") ||
    !S.selection.length ||
    S.tweak
  )
    return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteObjects();
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    mutate(() =>
      selectedNodes().forEach((n) => {
        n.x +=
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0;
        n.y +=
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0;
      }),
    );
  }
});
window.addEventListener("beforeunload", (event) => {
  if (S.dirty || S.tweak) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("hashchange", async () => {
  const id = location.hash.slice(1);
  if (!id || id === S.id) return;
  await openArtifact(id);
  if (S.id !== id) history.replaceState(null, "", `#${S.id ?? ""}`);
});
window.addEventListener("message", async (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.type !== "dsh-artifacts:close-request"
  )
    return;
  if (S.tweak) {
    toast("Apply or cancel the Tweaks preview before leaving the workbench.");
    return;
  }
  if (await save())
    parent.postMessage({ type: "dsh-artifacts:close-ready" }, location.origin);
});
setInterval(async () => {
  if (!S.id || document.hidden || S.saving) return;
  try {
    const record = await api(`/${S.id}`);
    if (record.revision !== S.record.revision) {
      S.external = record.revision;
      status();
    }
    if (!equal(record.proposals, S.record.proposals)) {
      S.record.proposals = record.proposals;
      updateAgentReview();
    }
  } catch {
    /* Keep offline drafts and retry on the next poll. */
  }
}, 3000);

try {
  await refreshLibrary();
  const id = location.hash.slice(1),
    legacy = new URL(location.href).searchParams.get("legacy");
  if (legacy) await importLegacy(legacy);
  else if (id) adopt(await api(`/${id}`));
  else render();
} catch (error) {
  root.replaceChildren(
    node(
      "div",
      { class: "welcome" },
      node(
        "div",
        { class: "stack" },
        node("h1", {}, "Could not open Artifacts"),
        node("div", { class: "error" }, error.message),
        btn("Retry", () => location.reload()),
      ),
    ),
  );
}
