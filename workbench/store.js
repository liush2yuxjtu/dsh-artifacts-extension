import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  clone,
  createSource,
  equal,
  mergeSources,
  validateSource,
} from "./model.js";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export class WorkspaceError extends Error {
  constructor(status, message, detail = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
export const workspaceRoot = () =>
  resolve(
    process.env.DSH_ARTIFACTS_WORKSPACE ||
      join(homedir(), ".dsh", "artifacts-workspace"),
  );
const checkId = (id) => {
  if (!ID.test(id ?? ""))
    throw new WorkspaceError(400, "Invalid artifact or request ID");
  return id;
};

// Every artifact, its revisions and its proposals commit together in one atomic
// rename. The on-disk lock coordinates the Host and a separate coding-agent CLI.
export class Workspace {
  constructor(root = workspaceRoot()) {
    this.root = resolve(root);
  }
  async folder() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return realpath(this.root);
  }
  async path(id) {
    return join(await this.folder(), `${checkId(id)}.json`);
  }
  async read(id) {
    const path = await this.path(id);
    try {
      if (!(await lstat(path)).isFile())
        throw new WorkspaceError(400, "Workspace files must be regular files");
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT")
        throw new WorkspaceError(404, "Artifact not found");
      throw error;
    }
  }
  async lock(id, fn) {
    const path = await this.path(id);
    const lockPath = `${path}.lock`;
    let handle;
    for (let i = 0; i < 50; i++) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(String(process.pid));
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // Recover a lock left by a terminated writer; never evict a live writer.
        const owner = Number(await readFile(lockPath, "utf8").catch(() => "0"));
        if (owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (cause) {
            if (cause.code === "ESRCH") {
              // Serialize recovery too: two rescuers must not unlink a new
              // live writer's lock after both observed the same dead PID.
              const recoveryPath = `${lockPath}.recovery`;
              let recovery;
              try {
                recovery = await open(recoveryPath, "wx", 0o600);
                const latestOwner = Number(
                  await readFile(lockPath, "utf8").catch(() => "0"),
                );
                if (latestOwner > 0)
                  try {
                    process.kill(latestOwner, 0);
                  } catch (latest) {
                    if (latest.code === "ESRCH")
                      await unlink(lockPath).catch(() => {});
                  }
              } catch (recoveryError) {
                if (recoveryError.code !== "EEXIST") throw recoveryError;
              } finally {
                if (recovery) {
                  await recovery.close();
                  await unlink(recoveryPath);
                }
              }
            }
          }
        }
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    if (!handle)
      throw new WorkspaceError(
        423,
        "Artifact is busy. Retry after the other save completes.",
      );
    try {
      return await fn(path);
    } finally {
      await handle.close();
      await unlink(lockPath);
    }
  }
  async write(path, record) {
    const temp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(record));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, path);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  public(record) {
    const current = record.versions.at(-1);
    return {
      id: record.id,
      revision: current.revision,
      source: current.source,
      createdAt: record.createdAt,
      updatedAt: current.at,
      recoveries: (record.recoveries ?? []).map(({ id, at, baseRevision }) => ({
        id,
        at,
        baseRevision,
      })),
      proposals: record.proposals.map(
        ({ id, status, summary, baseRevision, createdAt, conflicts }) => ({
          id,
          status,
          summary,
          baseRevision,
          createdAt,
          conflicts,
        }),
      ),
    };
  }
  async list() {
    const dir = await this.folder();
    const rows = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".json") || !ID.test(name.slice(0, -5))) continue;
      try {
        const record = await this.read(name.slice(0, -5));
        const value = this.public(record);
        rows.push({
          id: value.id,
          title: value.source.title,
          type: value.source.type,
          revision: value.revision,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
        });
      } catch (error) {
        rows.push({
          id: name.slice(0, -5),
          title: name.slice(0, -5),
          error: "Unable to read this source; file was preserved.",
        });
      }
    }
    return rows.sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
  }
  async get(id) {
    return this.public(await this.read(id));
  }
  async create(type, title, imported) {
    const source = validateSource(imported ?? createSource(type, title));
    const id = randomUUID();
    const at = new Date().toISOString();
    const record = {
      schemaVersion: 1,
      id,
      createdAt: at,
      versions: [{ revision: 1, at, reason: "Created", source: clone(source) }],
      requests: [],
      proposals: [],
    };
    await this.lock(id, async (path) => this.write(path, record));
    return this.public(record);
  }
  checkRevision(record, revision) {
    if (
      !Number.isInteger(revision) ||
      revision !== record.versions.at(-1).revision
    )
      throw new WorkspaceError(
        409,
        "This artifact changed in another editor. Both versions are preserved. Download your draft, then reload the saved version.",
        { current: this.public(record) },
      );
  }
  append(record, source, reason) {
    const current = record.versions.at(-1);
    record.versions.push({
      revision: current.revision + 1,
      at: new Date().toISOString(),
      reason: String(reason).slice(0, 300),
      source: clone(source),
    });
  }
  async save(id, source, baseRevision, reason = "Edited") {
    validateSource(source);
    return this.lock(id, async (path) => {
      const record = await this.read(id);
      if (source.type !== record.versions[0].source.type)
        throw new WorkspaceError(400, "Artifact type cannot change");
      if (
        !Number.isInteger(baseRevision) ||
        baseRevision !== record.versions.at(-1).revision
      ) {
        const recovery = {
          id: randomUUID(),
          at: new Date().toISOString(),
          baseRevision,
          source: clone(source),
        };
        (record.recoveries ??= []).push(recovery);
        await this.write(path, record);
        throw new WorkspaceError(
          409,
          "This artifact changed in another editor. Your incoming draft and the saved version are both preserved. Open Recovered drafts to keep working with either.",
          { current: this.public(record), recoveryId: recovery.id },
        );
      }
      if (!equal(source, record.versions.at(-1).source)) {
        this.append(record, source, reason);
        await this.write(path, record);
      }
      return this.public(record);
    });
  }
  async recovery(id, recoveryId) {
    const value = (await this.read(id)).recoveries?.find(
      (r) => r.id === checkId(recoveryId),
    );
    if (!value) throw new WorkspaceError(404, "Recovered draft not found");
    return value;
  }
  async history(id) {
    return (await this.read(id)).versions.map(
      ({ revision, at, reason, source }) => ({
        revision,
        at,
        reason,
        title: source.title,
      }),
    );
  }
  async version(id, revision) {
    const value = (await this.read(id)).versions.find(
      (v) => v.revision === revision,
    );
    if (!value) throw new WorkspaceError(404, "Version not found");
    return value;
  }
  async restore(id, targetRevision, baseRevision) {
    return this.lock(id, async (path) => {
      const record = await this.read(id);
      this.checkRevision(record, baseRevision);
      const target = record.versions.find((v) => v.revision === targetRevision);
      if (!target) throw new WorkspaceError(404, "Version not found");
      this.append(record, target.source, `Restored version ${targetRevision}`);
      await this.write(path, record);
      return this.public(record);
    });
  }
  async request(id, baseRevision, input) {
    if (
      typeof input.instruction !== "string" ||
      !input.instruction.trim() ||
      input.instruction.length > 12000
    )
      throw new WorkspaceError(
        400,
        "Write an instruction (maximum 12,000 characters)",
      );
    return this.lock(id, async (path) => {
      const record = await this.read(id);
      this.checkRevision(record, baseRevision);
      const request = {
        id: randomUUID(),
        baseRevision,
        source: clone(record.versions.at(-1).source),
        instruction: input.instruction,
        selection: String(input.selection ?? "").slice(0, 12000),
        errors: String(input.errors ?? "").slice(0, 12000),
        createdAt: new Date().toISOString(),
      };
      record.requests.push(request);
      await this.write(path, record);
      return {
        id: request.id,
        command: `/artifact-store edit ${id} ${request.id}`,
      };
    });
  }
  async getRequest(id, requestId) {
    checkId(requestId);
    const request = (await this.read(id)).requests.find(
      (r) => r.id === requestId,
    );
    if (!request) throw new WorkspaceError(404, "Agent request not found");
    return request;
  }
  async propose(id, requestId, source, summary = "Agent proposal") {
    validateSource(source);
    return this.lock(id, async (path) => {
      const record = await this.read(id);
      const request = record.requests.find((r) => r.id === checkId(requestId));
      if (!request) throw new WorkspaceError(404, "Agent request not found");
      if (source.type !== request.source.type)
        throw new WorkspaceError(400, "Agent cannot change artifact type");
      const proposal = {
        id: randomUUID(),
        requestId,
        baseRevision: request.baseRevision,
        source: clone(source),
        baseSource: request.source,
        summary: String(summary).slice(0, 2000),
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      record.proposals.push(proposal);
      await this.write(path, record);
      return { id: proposal.id, status: proposal.status };
    });
  }
  async proposal(id, proposalId) {
    const proposal = (await this.read(id)).proposals.find(
      (p) => p.id === checkId(proposalId),
    );
    if (!proposal) throw new WorkspaceError(404, "Proposal not found");
    return proposal;
  }
  async resolveProposal(id, proposalId, action, baseRevision) {
    return this.lock(id, async (path) => {
      const record = await this.read(id);
      this.checkRevision(record, baseRevision);
      const proposal = record.proposals.find(
        (p) => p.id === checkId(proposalId),
      );
      if (!proposal) throw new WorkspaceError(404, "Proposal not found");
      if (proposal.status !== "pending")
        throw new WorkspaceError(409, "This proposal was already resolved");
      if (action === "apply") {
        const merged = mergeSources(
          proposal.baseSource,
          record.versions.at(-1).source,
          proposal.source,
        );
        if (merged.conflicts.length)
          throw new WorkspaceError(
            409,
            "Agent proposal conflicts with newer edits. Your source and the proposal are preserved. Compare or save the proposal as a separate artifact.",
            { conflicts: merged.conflicts, proposalId },
          );
        validateSource(merged.value);
        this.append(record, merged.value, proposal.summary);
        proposal.status = "applied";
      } else if (action === "cancel") proposal.status = "cancelled";
      else throw new WorkspaceError(400, "Unknown proposal action");
      await this.write(path, record);
      return this.public(record);
    });
  }
}
