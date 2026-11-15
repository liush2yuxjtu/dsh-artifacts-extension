// Shared, dependency-free native source model. Used by the Host, CLI and editor.
export const TYPES = ["docs", "slides", "design", "data", "whiteboard", "html"];
export const DEFAULT_THEME = Object.freeze({
  background: "#ffffff",
  foreground: "#172033",
  accent: "#4263eb",
  muted: "#64748b",
  fontFamily: "system-ui",
  fontScale: 1,
  spacing: 1,
  radius: 12,
  shadow: 0.08,
  motion: 150,
});
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const color = (value, fallback) =>
  /^#[\da-f]{6}$/i.test(value ?? "") ? value : fallback;
const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
export const uid = () => globalThis.crypto.randomUUID();

export function element(kind = "text", values = {}) {
  return {
    id: uid(),
    kind,
    x: 40,
    y: 40,
    w: 280,
    h: 64,
    text:
      kind === "text" ? "Write something" : kind === "button" ? "Continue" : "",
    ...values,
  };
}

export function frame(title = "Untitled page", values = {}) {
  return {
    id: uid(),
    title,
    width: 960,
    height: 600,
    overrides: {},
    elements: [
      element("text", {
        text: title,
        x: 56,
        y: 56,
        w: 800,
        h: 80,
        fontSize: 40,
      }),
    ],
    ...values,
  };
}

export function createSource(type, title = "Untitled") {
  if (!TYPES.includes(type)) throw new Error("Unknown artifact type");
  const source = { schemaVersion: 1, type, title: title.trim() || "Untitled" };
  if (type === "docs")
    source.body = `# ${source.title}\n\nWrite here. Select text to ask your Agent for a focused revision.\n\n## Next steps\n\n- Add your ideas\n- Refine and export\n`;
  if (type === "html")
    source.html =
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Untitled</title><body><h1>Hello, world</h1><button onclick="this.textContent=\'It works\'">Try me</button></body></html>';
  if (type === "slides" || type === "design") {
    source.theme = clone(DEFAULT_THEME);
    source.frames =
      type === "slides"
        ? [frame("A new presentation"), frame("The next chapter")]
        : [
            frame("Overview", {
              elements: [
                element("text", {
                  text: source.title,
                  x: 56,
                  y: 54,
                  w: 840,
                  h: 90,
                  fontSize: 44,
                }),
                element("text", {
                  text: "A considered space for your next idea.",
                  x: 56,
                  y: 172,
                  w: 700,
                  h: 72,
                  fontSize: 22,
                }),
                element("button", {
                  text: "Explore details",
                  x: 56,
                  y: 304,
                  w: 240,
                  h: 56,
                  action: "#details",
                }),
              ],
            }),
            frame("Details", {
              elements: [
                element("text", {
                  text: "Make room for what matters",
                  x: 56,
                  y: 54,
                  w: 840,
                  h: 100,
                  fontSize: 38,
                }),
                element("rect", { x: 56, y: 204, w: 848, h: 280 }),
                element("text", {
                  text: "Your content stays yours. Edit this panel to tell your story.",
                  x: 88,
                  y: 248,
                  w: 760,
                  h: 140,
                  fontSize: 24,
                }),
              ],
            }),
            frame("Next steps", {
              elements: [
                element("text", {
                  text: "Ready when you are",
                  x: 56,
                  y: 54,
                  w: 800,
                  h: 100,
                  fontSize: 40,
                }),
                element("text", {
                  text: "Review your work, then share the finished result.",
                  x: 56,
                  y: 194,
                  w: 780,
                  h: 100,
                  fontSize: 24,
                }),
                element("button", {
                  text: "Back to overview",
                  x: 56,
                  y: 348,
                  w: 256,
                  h: 56,
                  action: "#overview",
                }),
              ],
            }),
          ];
  }
  if (type === "whiteboard") {
    source.theme = clone(DEFAULT_THEME);
    source.nodes = [
      element("sticky", {
        text: "Start with a question",
        x: 40,
        y: 40,
        w: 240,
        h: 140,
      }),
      element("text", {
        text: "Explore possibilities",
        x: 400,
        y: 80,
        w: 280,
        h: 90,
        fontSize: 24,
      }),
    ];
    source.edges = [
      {
        id: uid(),
        from: source.nodes[0].id,
        to: source.nodes[1].id,
        label: "leads to",
      },
    ];
  }
  if (type === "data") {
    source.columns = ["Month", "Revenue"];
    source.rows = [
      ["Jan", 120],
      ["Feb", 180],
      ["Mar", 150],
      ["Apr", 240],
    ];
    source.provenance = "Example data — replace with your source";
    source.calculation =
      "Sum of the numeric measure by category. Filters affect the view and filtered exports; source rows are preserved.";
    source.chart = {
      kind: "bar",
      x: "Month",
      y: "Revenue",
      aggregation: "sum",
      color: "#4263eb",
    };
    source.filter = { column: "Month", operator: "contains", value: "" };
  }
  return source;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function validTheme(theme = {}) {
  assert(
    theme && typeof theme === "object" && !Array.isArray(theme),
    "Invalid theme",
  );
  for (const key of ["background", "foreground", "accent", "muted"])
    if (key in theme)
      assert(/^#[\da-f]{6}$/i.test(theme[key]), `Invalid ${key} color`);
  for (const [key, min, max] of [
    ["fontScale", 0.5, 3],
    ["spacing", 0.5, 2],
    ["radius", 0, 100],
    ["shadow", 0, 1],
    ["motion", 0, 2000],
  ])
    if (key in theme)
      assert(
        typeof theme[key] === "number" &&
          theme[key] >= min &&
          theme[key] <= max,
        `Invalid theme ${key}`,
      );
  if ("fontFamily" in theme)
    assert(
      ["system-ui", "Georgia", "Arial", "monospace"].includes(theme.fontFamily),
      "Invalid font family",
    );
}
function validElements(nodes, ids) {
  assert(Array.isArray(nodes) && nodes.length <= 2000, "Invalid objects");
  for (const node of nodes) {
    assert(
      node && typeof node.id === "string" && !ids.has(node.id),
      "Object IDs must be unique",
    );
    ids.add(node.id);
    assert(
      ["text", "rect", "ellipse", "button", "sticky"].includes(node.kind),
      "Invalid object kind",
    );
    for (const key of ["x", "y", "w", "h"])
      assert(
        typeof node[key] === "number" &&
          Number.isFinite(node[key]) &&
          Math.abs(node[key]) <= 100000,
        `Invalid object ${key}`,
      );
    assert(node.w >= 8 && node.h >= 8, "Objects need positive dimensions");
    assert(
      typeof node.text === "string" && node.text.length <= 100000,
      "Invalid object text",
    );
    if (node.fontSize !== undefined)
      assert(
        typeof node.fontSize === "number" &&
          node.fontSize >= 6 &&
          node.fontSize <= 240,
        "Invalid font size",
      );
    for (const key of ["fill", "color"])
      if (node[key] !== undefined)
        assert(/^#[\da-f]{6}$/i.test(node[key]), `Invalid object ${key}`);
    if (node.radius !== undefined)
      assert(
        typeof node.radius === "number" &&
          node.radius >= 0 &&
          node.radius <= 500,
        "Invalid radius",
      );
    if (node.action !== undefined)
      assert(
        typeof node.action === "string" &&
          /^(https?:\/\/|#|$)/.test(node.action),
        "Buttons support only http(s) links or anchors",
      );
    if (node.group !== undefined)
      assert(typeof node.group === "string", "Invalid object group");
  }
}
export function validateSource(source) {
  assert(
    source && source.schemaVersion === 1 && TYPES.includes(source.type),
    "Unsupported source schema or type",
  );
  assert(
    typeof source.title === "string" &&
      source.title.trim().length > 0 &&
      source.title.length <= 300,
    "Title is required (maximum 300 characters)",
  );
  assert(
    new TextEncoder().encode(JSON.stringify(source)).length <= 2_000_000,
    "Source exceeds 2 MB",
  );
  const inspectKeys = (value, depth = 0) => {
    assert(depth < 40, "Source nesting is too deep");
    if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value)) {
        assert(
          !["__proto__", "constructor", "prototype"].includes(key),
          "Reserved source property",
        );
        inspectKeys(item, depth + 1);
      }
  };
  inspectKeys(source);
  if (source.type === "docs")
    assert(typeof source.body === "string", "Docs need Markdown text");
  if (source.type === "html") {
    assert(typeof source.html === "string", "HTML source is required");
    if (source.assets !== undefined) {
      assert(
        source.assets &&
          typeof source.assets === "object" &&
          !Array.isArray(source.assets),
        "Invalid HTML assets",
      );
      for (const [path, data] of Object.entries(source.assets)) {
        assert(
          path.length < 300 &&
            !path.startsWith("/") &&
            !path.includes("\\") &&
            path
              .split("/")
              .every((part) => part && part !== "." && part !== "..") &&
            path !== "index.html" &&
            path !== "source.artifact.json",
          "Invalid resource path",
        );
        assert(
          typeof data === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(data),
          "Invalid resource bytes",
        );
      }
    }
  }
  const ids = new Set();
  if (["design", "slides", "whiteboard"].includes(source.type))
    validTheme(source.theme);
  if (source.frames !== undefined) {
    assert(
      ["design", "slides"].includes(source.type) &&
        Array.isArray(source.frames) &&
        source.frames.length > 0 &&
        source.frames.length <= 100,
      "Need 1–100 pages",
    );
    for (const page of source.frames) {
      assert(
        page && typeof page.id === "string" && !ids.has(page.id),
        "Page IDs must be unique",
      );
      ids.add(page.id);
      assert(
        typeof page.title === "string" && page.title.length <= 300,
        "Invalid page title",
      );
      assert(
        Number.isFinite(page.width) &&
          page.width >= 100 &&
          page.width <= 10000 &&
          Number.isFinite(page.height) &&
          page.height >= 100 &&
          page.height <= 10000,
        "Invalid page dimensions",
      );
      validTheme(page.overrides);
      validElements(page.elements, ids);
    }
  } else if (["design", "slides"].includes(source.type))
    throw new Error("Pages are required");
  if (source.type === "whiteboard") {
    validElements(source.nodes, ids);
    assert(
      Array.isArray(source.edges) && source.edges.length <= 4000,
      "Invalid connections",
    );
    for (const edge of source.edges) {
      assert(
        edge && typeof edge.id === "string" && !ids.has(edge.id),
        "Connection IDs must be unique",
      );
      ids.add(edge.id);
      assert(
        source.nodes.some((node) => node.id === edge.from) &&
          source.nodes.some((node) => node.id === edge.to),
        "Connection endpoint is missing",
      );
      assert(typeof edge.label === "string", "Invalid connection label");
    }
  }
  if (source.type === "data") {
    assert(
      Array.isArray(source.columns) &&
        source.columns.length > 0 &&
        source.columns.length <= 100 &&
        source.columns.every(
          (c) => typeof c === "string" && c.length > 0 && c.length <= 200,
        ) &&
        new Set(source.columns).size === source.columns.length,
      "Column names must be nonempty and unique",
    );
    assert(
      Array.isArray(source.rows) &&
        source.rows.length <= 20000 &&
        source.rows.every(
          (row) =>
            Array.isArray(row) &&
            row.length === source.columns.length &&
            row.every(
              (v) =>
                v === null ||
                typeof v === "string" ||
                typeof v === "boolean" ||
                (typeof v === "number" && Number.isFinite(v)),
            ),
        ),
      "Invalid data rows",
    );
    assert(
      source.chart &&
        ["bar", "line", "pie"].includes(source.chart.kind) &&
        source.columns.includes(source.chart.x) &&
        source.columns.includes(source.chart.y),
      "Invalid chart configuration",
    );
    assert(
      ["sum", "mean", "count"].includes(source.chart.aggregation),
      "Invalid aggregation",
    );
    assert(/^#[\da-f]{6}$/i.test(source.chart.color), "Invalid chart color");
    assert(
      source.filter &&
        source.columns.includes(source.filter.column) &&
        ["contains", "equals", "gt", "lt"].includes(source.filter.operator) &&
        typeof source.filter.value === "string",
      "Invalid filter",
    );
    assert(
      typeof source.provenance === "string" &&
        typeof source.calculation === "string",
      "Data source and calculation notes are required",
    );
  }
  return source;
}

// Conflicting edits never disappear. Object fields merge independently; competing
// text/array changes are deliberately left for review rather than guessed at.
export function mergeSources(base, current, proposed, path = "") {
  if (equal(current, base)) return { value: clone(proposed), conflicts: [] };
  if (equal(proposed, base) || equal(current, proposed))
    return { value: clone(current), conflicts: [] };
  if (
    base &&
    current &&
    proposed &&
    [base, current, proposed].every(
      (v) => typeof v === "object" && !Array.isArray(v),
    )
  ) {
    const value = {};
    const conflicts = [];
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(current),
      ...Object.keys(proposed),
    ])) {
      const b = base[key],
        c = current[key],
        p = proposed[key];
      if (c === undefined || p === undefined || b === undefined) {
        if (equal(c, b)) {
          if (p !== undefined) value[key] = clone(p);
        } else if (equal(p, b) || equal(c, p)) {
          if (c !== undefined) value[key] = clone(c);
        } else {
          if (c !== undefined) value[key] = clone(c);
          conflicts.push(`${path}/${key}`);
        }
      } else {
        const merged = mergeSources(b, c, p, `${path}/${key}`);
        value[key] = merged.value;
        conflicts.push(...merged.conflicts);
      }
    }
    return { value, conflicts };
  }
  return { value: clone(current), conflicts: [path || "/"] };
}

export function dataView(source) {
  const { columns, filter } = source;
  const index = columns.indexOf(filter.column);
  return source.rows.filter((row) => {
    if (filter.value === "") return true;
    const value = row[index];
    if (filter.operator === "equals")
      return String(value ?? "") === filter.value;
    if (filter.operator === "gt" || filter.operator === "lt")
      return (
        value !== null &&
        String(value).trim() !== "" &&
        Number.isFinite(Number(value)) &&
        (filter.operator === "gt"
          ? Number(value) > Number(filter.value)
          : Number(value) < Number(filter.value))
      );
    return String(value ?? "")
      .toLowerCase()
      .includes(filter.value.toLowerCase());
  });
}

export function chartData(source) {
  const groups = new Map();
  const x = source.columns.indexOf(source.chart.x),
    y = source.columns.indexOf(source.chart.y);
  for (const row of dataView(source)) {
    const label = String(row[x] ?? "");
    const group = groups.get(label) ?? [];
    if (source.chart.aggregation === "count") group.push(1);
    else if (
      row[y] !== null &&
      String(row[y]).trim() !== "" &&
      Number.isFinite(Number(row[y]))
    )
      group.push(Number(row[y]));
    groups.set(label, group);
  }
  return [...groups].map(([label, values]) => ({
    label,
    value: values.length
      ? values.reduce((a, b) => a + b, 0) /
        (source.chart.aggregation === "mean" ? values.length : 1)
      : 0,
  }));
}

export function bounds(nodes, padding = 32) {
  if (!nodes.length) return { x: 0, y: 0, width: 800, height: 500 };
  const x = Math.min(...nodes.map((n) => n.x)) - padding,
    y = Math.min(...nodes.map((n) => n.y)) - padding;
  return {
    x,
    y,
    width: Math.max(...nodes.map((n) => n.x + n.w)) - x + padding,
    height: Math.max(...nodes.map((n) => n.y + n.h)) - y + padding,
  };
}
export const themeFor = (source, page) => ({
  ...DEFAULT_THEME,
  ...source.theme,
  ...page?.overrides,
});

function wrapText(text, width, fontSize) {
  const max = Math.max(1, Math.floor(width / (fontSize * 0.57)));
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line.length >= max) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}
export function svgElement(node, theme) {
  const fill = color(
    node.fill,
    node.kind === "sticky"
      ? "#fff1a8"
      : node.kind === "button"
        ? theme.accent
        : node.kind === "text"
          ? "none"
          : "#eef1f6",
  );
  const textColor = color(
    node.color,
    node.kind === "button" ? "#ffffff" : theme.foreground,
  );
  const fontSize =
    (node.fontSize ?? (node.kind === "text" ? 24 : 18)) * theme.fontScale;
  const radius = node.radius ?? theme.radius;
  const shape =
    node.kind === "ellipse"
      ? `<ellipse cx="${node.x + node.w / 2}" cy="${node.y + node.h / 2}" rx="${node.w / 2}" ry="${node.h / 2}" fill="${fill}"/>`
      : node.kind !== "text"
        ? `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${radius}" fill="${fill}"/>`
        : "";
  const padding = node.kind === "text" ? 0 : 12 * theme.spacing;
  const lines = wrapText(node.text, node.w - padding * 2, fontSize);
  const text = `<text fill="${textColor}" font-family="${escapeHtml(theme.fontFamily)}" font-size="${fontSize}">${lines.map((line, i) => `<tspan x="${node.x + padding}" y="${node.y + padding + fontSize + i * fontSize * 1.35}">${escapeHtml(line)}</tspan>`).join("")}</text>`;
  const content = shape + text;
  return node.kind === "button" && node.action
    ? `<a href="${escapeHtml(node.action)}">${content}</a>`
    : content;
}
function svgHead(width, height, viewBox = `0 0 ${width} ${height}`) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img">`;
}
export function frameSvg(source, page) {
  const t = themeFor(source, page);
  return `${svgHead(page.width, page.height)}<title>${escapeHtml(page.title)}</title><rect width="100%" height="100%" fill="${t.background}"/>${page.elements.map((n) => svgElement(n, t)).join("")}</svg>`;
}
export function whiteboardSvg(source) {
  const b = bounds(source.nodes),
    theme = themeFor(source);
  return `${svgHead(b.width, b.height, `${b.x} ${b.y} ${b.width} ${b.height}`)}<title>${escapeHtml(source.title)}</title><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${theme.background}"/><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10" fill="${theme.muted}"/></marker></defs>${source.edges
    .map((edge) => {
      const a = source.nodes.find((n) => n.id === edge.from),
        z = source.nodes.find((n) => n.id === edge.to);
      if (!a || !z) return "";
      const x1 = a.x + a.w / 2,
        y1 = a.y + a.h / 2,
        x2 = z.x + z.w / 2,
        y2 = z.y + z.h / 2;
      return `<g data-connection="true"><path d="M${x1} ${y1}L${x2} ${y2}" stroke="${theme.muted}" stroke-width="2" marker-end="url(#arrow)"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" fill="${theme.muted}" font-size="14">${escapeHtml(edge.label)}</text></g>`;
    })
    .join("")}${source.nodes.map((n) => svgElement(n, theme)).join("")}</svg>`;
}
export function chartSvg(source) {
  const values = chartData(source);
  const width = 800,
    height = 450,
    left = 64,
    top = 48,
    plotW = 704,
    plotH = 330;
  const min = Math.min(0, ...values.map((d) => d.value)),
    max = Math.max(1, ...values.map((d) => d.value));
  const y = (value) => top + ((max - value) / (max - min)) * plotH;
  let drawing = `<line x1="${left}" y1="${y(0)}" x2="768" y2="${y(0)}" stroke="#cbd5e1"/>`;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    drawing += `<text x="52" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#64748b">${Number(v.toFixed(2))}</text>`;
  }
  if (source.chart.kind === "pie") {
    const total = values.reduce((sum, d) => sum + Math.max(0, d.value), 0);
    let angle = -Math.PI / 2;
    if (!total)
      drawing +=
        '<text x="400" y="200" text-anchor="middle">No positive values to show</text>';
    values.forEach((d, i) => {
      const fraction = total ? Math.max(0, d.value) / total : 0;
      const end = angle + fraction * Math.PI * 2;
      if (fraction === 1)
        drawing += `<circle cx="300" cy="210" r="150" fill="${source.chart.color}"/>`;
      else if (fraction > 0)
        drawing += `<path d="M300 210L${300 + Math.cos(angle) * 150} ${210 + Math.sin(angle) * 150}A150 150 0 ${fraction > 0.5 ? 1 : 0} 1 ${300 + Math.cos(end) * 150} ${210 + Math.sin(end) * 150}Z" fill="${source.chart.color}" opacity="${0.35 + (0.65 * (i + 1)) / values.length}" stroke="white"/>`;
      drawing += `<text x="500" y="${80 + i * 24}" font-size="14">${escapeHtml(d.label)}: ${d.value}</text>`;
      angle = end;
    });
  } else {
    const step = plotW / Math.max(values.length, 1);
    if (source.chart.kind === "line")
      drawing += `<polyline points="${values.map((d, i) => `${left + step * (i + 0.5)},${y(d.value)}`).join(" ")}" fill="none" stroke="${source.chart.color}" stroke-width="3"/>`;
    values.forEach((d, i) => {
      const x = left + step * (i + 0.5);
      drawing +=
        source.chart.kind === "bar"
          ? `<rect x="${x - step * 0.32}" y="${Math.min(y(0), y(d.value))}" width="${step * 0.64}" height="${Math.max(1, Math.abs(y(d.value) - y(0)))}" rx="3" fill="${source.chart.color}"/>`
          : `<circle cx="${x}" cy="${y(d.value)}" r="4" fill="${source.chart.color}"/>`;
      drawing += `<text x="${x}" y="${Math.max(22, y(d.value) - 8)}" text-anchor="middle" font-size="12">${d.value}</text><text x="${x}" y="410" text-anchor="middle" font-size="12" fill="#64748b">${escapeHtml(d.label)}</text>`;
    });
  }
  return `${svgHead(width, height)}<title>${escapeHtml(source.title)}</title><rect width="100%" height="100%" fill="white"/><g font-family="system-ui" fill="#172033"><text x="${left}" y="25" font-size="16">${escapeHtml(source.chart.aggregation)}(${escapeHtml(source.chart.y)}) by ${escapeHtml(source.chart.x)}</text>${drawing}</g></svg>`;
}
export function artifactSvg(source, pageIndex = 0) {
  if (source.type === "data") return chartSvg(source);
  if (source.type === "whiteboard") return whiteboardSvg(source);
  if (source.frames)
    return frameSvg(source, source.frames[pageIndex] ?? source.frames[0]);
  throw new Error("This artifact has no SVG export");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^\s)]*)\)/g,
      '<a href="$2">$1</a>',
    );
}
export function markdownHtml(markdown) {
  let code = false;
  let list = false;
  return (
    markdown
      .split("\n")
      .map((line) => {
        if (line.startsWith("```")) {
          code = !code;
          const end = list ? "</ul>" : "";
          list = false;
          return end + (code ? "<pre><code>" : "</code></pre>");
        }
        if (code) return escapeHtml(line) + "\n";
        const bullet = /^[-*] /.test(line),
          end = list && !bullet ? "</ul>" : "";
        if (bullet) {
          const begin = list ? "" : "<ul>";
          list = true;
          return begin + `<li>${inlineMarkdown(line.slice(2))}</li>`;
        }
        list = false;
        const heading = line.match(/^(#{1,6}) (.*)/);
        return (
          end +
          (heading
            ? `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`
            : line
              ? `<p>${inlineMarkdown(line)}</p>`
              : "")
        );
      })
      .join("\n") +
    (list ? "</ul>" : "") +
    (code ? "</code></pre>" : "")
  );
}

export function inlineHtmlAssets(source) {
  const assets = source.assets ?? {};
  const mime = {
    js: "text/javascript",
    mjs: "text/javascript",
    css: "text/css",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  const pathFor = (value, parent = "") => {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(value)) return null;
    try {
      return decodeURIComponent(
        new URL(value, `https://artifact.invalid/${parent}`).pathname.slice(1),
      );
    } catch {
      return null;
    }
  };
  const urlFor = (path, seen = new Set()) => {
    if (!path || !(path in assets) || seen.has(path)) return null;
    const extension = path.split(".").at(-1).toLowerCase();
    let data = assets[path];
    if (extension === "css") {
      const visited = new Set([...seen, path]);
      const text = new TextDecoder().decode(
        Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      );
      const css = text.replace(
        /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
        (match, quote, relative) => {
          const next = urlFor(pathFor(relative, path), visited);
          return next ? `url("${next}")` : match;
        },
      );
      data = btoa(
        Array.from(new TextEncoder().encode(css), (byte) =>
          String.fromCharCode(byte),
        ).join(""),
      );
    }
    return `data:${mime[extension] ?? "application/octet-stream"};base64,${data}`;
  };
  return source.html.replace(
    /\b(src|href)\s*=\s*(["'])(.*?)\2/gi,
    (match, key, quote, value) => {
      const url = urlFor(pathFor(value));
      return url ? `${key}=${quote}${url}${quote}` : match;
    },
  );
}

export function artifactHtml(source) {
  if (source.type === "html") return inlineHtmlAssets(source);
  let body;
  if (source.type === "docs")
    body = `<article>${markdownHtml(source.body)}</article>`;
  else if (source.frames)
    body = source.frames
      .map((page, i) => {
        const t = themeFor(source, page);
        // Content-only native elements keep links and buttons live in HTML exports.
        return `<section class="page" id="${escapeHtml(page.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `page-${i + 1}`)}" style="page:artifact-page-${i};width:${page.width}px;height:${page.height}px;background:${t.background};font-family:${t.fontFamily}">${page.elements
          .map((n) => {
            const tag = n.kind === "button" ? "a" : "div";
            const padding = n.kind === "text" ? 0 : 12 * t.spacing;
            return `<${tag} ${tag === "a" ? `href="${escapeHtml(n.action || "#")}"` : ""} style="position:absolute;box-sizing:border-box;left:${n.x}px;top:${n.y}px;width:${n.w}px;min-height:${n.h}px;padding:${padding}px;border-radius:${n.kind === "ellipse" ? "50%" : `${n.radius ?? t.radius}px`};background:${color(n.fill, n.kind === "text" ? "transparent" : n.kind === "button" ? t.accent : n.kind === "sticky" ? "#fff1a8" : "#eef1f6")};color:${color(n.color, n.kind === "button" ? "#ffffff" : t.foreground)};font-size:${(n.fontSize ?? (n.kind === "text" ? 24 : 18)) * t.fontScale}px;line-height:1.35;white-space:pre-wrap;text-decoration:none;box-shadow:${n.kind === "text" ? "none" : `0 6px 20px rgba(0,0,0,${t.shadow})`};transition:filter ${t.motion}ms">${escapeHtml(n.text)}</${tag}>`;
          })
          .join("")}</section>`;
      })
      .join("");
  else body = artifactSvg(source);
  const printPages = (source.frames ?? [])
    .map(
      (page, i) =>
        `@page artifact-page-${i}{size:${page.width}px ${page.height}px;margin:0}`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(source.title)}</title><style>body{margin:0;background:#f1f3f6;color:#172033;font:16px/1.65 system-ui}article{max-width:760px;margin:32px auto;padding:48px;background:white}pre{white-space:pre-wrap}svg{max-width:100%;height:auto;display:block;margin:auto}.page{position:relative;margin:24px auto;break-after:page;overflow:hidden}a:hover{filter:brightness(.95)}@media print{@page{margin:12mm}${printPages}body{background:white}article,.page{margin:0;padding:0;box-shadow:none}svg{max-height:95vh}.page{break-inside:avoid}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}</style></head><body>${body}</body></html>`;
}
