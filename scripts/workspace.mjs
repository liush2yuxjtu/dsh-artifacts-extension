#!/usr/bin/env node
// The coding agent writes a proposal; only the user/editor can apply it.
import { readFile } from "node:fs/promises";
import { Workspace } from "../workbench/store.js";

const [command, id, requestId, ...args] = process.argv.slice(2);
const workspace = new Workspace();
try {
  if (command === "request") {
    console.log(
      JSON.stringify(await workspace.getRequest(id, requestId), null, 2),
    );
  } else if (command === "propose") {
    const index = args.indexOf("--file");
    if (index < 0 || !args[index + 1])
      throw new Error(
        "Usage: workspace.mjs propose <artifact-id> <request-id> --file <source.json> [--summary <text>]",
      );
    const source = JSON.parse(await readFile(args[index + 1], "utf8"));
    const summary = args.indexOf("--summary");
    console.log(
      JSON.stringify(
        await workspace.propose(
          id,
          requestId,
          source,
          summary >= 0 ? args[summary + 1] : "Agent edit",
        ),
      ),
    );
  } else
    throw new Error(
      "Usage: workspace.mjs request <artifact-id> <request-id> | propose <artifact-id> <request-id> --file <source.json>",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
