#!/usr/bin/env node
// Local development harness, not a replacement for real DSH verification.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { apply } from "../index.js";

export async function startHarness({
  port = 0,
  root,
  cookie = randomUUID(),
} = {}) {
  if (root) process.env.DSH_ARTIFACTS_WORKSPACE = root;
  else if (!process.env.DSH_ARTIFACTS_WORKSPACE)
    process.env.DSH_ARTIFACTS_WORKSPACE = await mkdtemp(
      join(tmpdir(), "artifacts-dev-"),
    );
  const routes = [],
    commands = new Map();
  apply({
    effect: (fn) => fn(),
    commands: {
      register: (command) => {
        commands.set(command.name, command);
        return () => {};
      },
    },
    webServer: {
      register: (route) => {
        routes.push(route);
        return () => {};
      },
    },
    connection: {
      requestRejection: (req) => {
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`
        )
          return 403;
        return String(req.headers.cookie ?? "")
          .split(";")
          .some((item) => item.trim() === `artifacts-dev=${cookie}`)
          ? undefined
          : 401;
      },
    },
  });
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/") {
        res.setHeader(
          "set-cookie",
          `artifacts-dev=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
        );
        res.writeHead(302, { location: "/dsh-artifacts/asset/_workbench/" });
        res.end();
        return;
      }
      const route = routes.find((r) =>
        r.kind === "exact"
          ? path === r.path
          : path === r.path || path.startsWith(r.path + "/"),
      );
      if (!route) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      await route.handler(req, res);
    } catch (error) {
      if (!res.headersSent)
        res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    commands,
    cookie,
    workspace: process.env.DSH_ARTIFACTS_WORKSPACE,
  };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const harness = await startHarness({
    port: Number(process.env.PORT || 3099),
  });
  console.log(`Local fixture harness: ${harness.url}/ (not a DSH runtime)`);
  console.log(`Disposable workspace: ${harness.workspace}`);
}
