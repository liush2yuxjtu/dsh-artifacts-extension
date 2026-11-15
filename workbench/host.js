import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Workspace, WorkspaceError } from "./store.js";
import { exportArtifact, parseCsv } from "./exports.js";
import { createSource } from "./model.js";

export const WORKBENCH_PATH = "/dsh-artifacts/asset/_workbench/";
const ASSETS = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["app.js", "text/javascript; charset=utf-8"],
  ["model.js", "text/javascript; charset=utf-8"],
  ["workbench.css", "text/css; charset=utf-8"],
]);
const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  woff: "font/woff",
  woff2: "font/woff2",
};
const json = (res, status, value) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(value));
};
async function body(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new WorkspaceError(415, "Use application/json");
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new WorkspaceError(403, "Cross-site writes are not allowed");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 3_000_000) throw new WorkspaceError(413, "Request exceeds 3 MB");
    chunks.push(Buffer.from(chunk));
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
      throw new Error();
    return parsed;
  } catch {
    throw new WorkspaceError(400, "Invalid JSON body");
  }
}

export async function handleWorkbench(
  req,
  res,
  { workspace = new Workspace(), importLegacy } = {},
) {
  const url = new URL(req.url, "http://localhost");
  // Host may be mounted beneath a path; matching the reserved asset suffix keeps
  // packaged relative links and the API valid in either mounting arrangement.
  const marker = "/asset/_workbench/";
  const index = url.pathname.indexOf(marker);
  const path = index < 0 ? "" : url.pathname.slice(index + marker.length);
  try {
    if (ASSETS.has(path || "index.html")) {
      if (req.method !== "GET") {
        res.setHeader("allow", "GET");
        return json(res, 405, { error: "Method not allowed" });
      }
      const asset = path || "index.html";
      res.setHeader("content-type", ASSETS.get(asset));
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      // srcdoc inherits this policy. Inline scripts are necessary for interactive
      // artifacts and the error bridge; each preview has a unique sandbox origin
      // (allow-scripts only), never allow-same-origin.
      if (asset === "index.html")
        res.setHeader(
          "content-security-policy",
          "default-src 'self'; script-src 'self' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'",
        );
      res.end(await readFile(fileURLToPath(new URL(asset, import.meta.url))));
      return;
    }
    const parts = path.split("/").map((part) => decodeURIComponent(part));
    if (parts[0] !== "api" || parts[1] !== "artifacts")
      return json(res, 404, { error: "Not found" });
    const id = parts[2],
      action = parts[3],
      item = parts[4];
    if (req.method === "GET") {
      if (parts.length > 5 && action !== "resource")
        return json(res, 404, { error: "Not found" });
      if (!id) return json(res, 200, { artifacts: await workspace.list() });
      if (!action) return json(res, 200, await workspace.get(id));
      if (action === "history")
        return json(res, 200, {
          versions: item
            ? [await workspace.version(id, Number(item))]
            : await workspace.history(id),
        });
      if (action === "proposals" && item)
        return json(res, 200, await workspace.proposal(id, item));
      if (action === "requests" && item)
        return json(res, 200, await workspace.getRequest(id, item));
      if (action === "recoveries" && item)
        return json(res, 200, await workspace.recovery(id, item));
      if (action === "export") {
        const record = item
          ? await workspace.version(id, Number(item))
          : await workspace.get(id);
        const result = exportArtifact(
          record.source,
          url.searchParams.get("format") ?? "json",
          {
            page: Number(url.searchParams.get("page") ?? 0),
            filtered: url.searchParams.get("filtered") === "true",
          },
        );
        res.setHeader("content-type", result.mime);
        res.setHeader("cache-control", "no-store");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader(
          "content-disposition",
          `attachment; filename="artifact.${url.searchParams.get("format") ?? "json"}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        );
        res.end(result.bytes);
        return;
      }
      if (action === "resource") {
        const resource = (await workspace.get(id)).source.assets?.[
          parts.slice(4).join("/")
        ];
        if (typeof resource !== "string")
          return json(res, 404, { error: "Resource not found" });
        const extension = parts.at(-1).split(".").at(-1).toLowerCase();
        res.setHeader(
          "content-type",
          MIME[extension] ?? "application/octet-stream",
        );
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("cache-control", "no-store");
        res.end(Buffer.from(resource, "base64"));
        return;
      }
      return json(res, 404, { error: "Not found" });
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      return json(res, 405, { error: "Method not allowed" });
    }
    const input = await body(req);
    if (!id) {
      let imported = input.source;
      if (input.legacySlug) {
        if (!importLegacy)
          throw new WorkspaceError(400, "Legacy cache is unavailable");
        imported = await importLegacy(input.legacySlug);
      }
      if (input.csv !== undefined) {
        if (typeof input.csv !== "string")
          throw new WorkspaceError(400, "CSV must be text");
        const [columns, ...rows] = parseCsv(input.csv);
        imported = createSource("data", input.title || "Imported data");
        imported.columns = columns;
        imported.rows = rows;
        imported.chart.x = columns?.[0];
        imported.chart.y = columns?.[1] ?? columns?.[0];
        imported.filter.column = columns?.[0];
        imported.provenance = input.title || "Imported CSV";
      }
      return json(
        res,
        201,
        await workspace.create(input.type, input.title, imported),
      );
    }
    if (!action)
      return json(
        res,
        200,
        await workspace.save(
          id,
          input.source,
          input.baseRevision,
          input.reason,
        ),
      );
    if (action === "restore")
      return json(
        res,
        200,
        await workspace.restore(id, input.targetRevision, input.baseRevision),
      );
    if (action === "requests")
      return json(
        res,
        201,
        await workspace.request(id, input.baseRevision, input),
      );
    if (action === "proposals" && item)
      return json(
        res,
        200,
        await workspace.resolveProposal(
          id,
          item,
          input.action,
          input.baseRevision,
        ),
      );
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    const status = error.status ?? (error instanceof SyntaxError ? 400 : 400);
    return json(res, status, { error: error.message, ...error.detail });
  }
}
