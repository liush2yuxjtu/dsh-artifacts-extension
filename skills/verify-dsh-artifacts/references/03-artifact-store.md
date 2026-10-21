# `artifact-store`

## Claim

The store skill must answer `status`, `list`, `load`, and `history` against the configured private GitHub repository without writes, and the store's `index.json` and per-artifact `meta.json` files must agree with what the extension panel serves.

## Configuration

Read order:

1. `--repo` (verifier flag / CLI)
2. `DSH_ARTIFACTS_REPO`
3. `~/.dsh/artifact-store.json`

Expected config:

```json
{
  "repo": "<owner>/<name>",
  "branch": "main",
  "basePath": "artifacts",
  "cacheDir": "~/.dsh/cache/artifact-store"
}
```

The cache is a managed clone at `<cacheDir>/<owner>__<name>`. The CLI pulls before operations; the panel reads the same checkout. Never edit the cache by hand to make a check pass.

## Read-only checks

```bash
S="$HOME/.agents/skills/artifact-store/scripts/artifact-store.mjs"

node "$S" status
node "$S" list --json
node "$S" load "<slug>" --out "$EVIDENCE/store/load" --force
node "$S" history "<slug>" --limit 5
```

Assertions:

| Check | Required |
|---|---|
| `status` | exits 0; names the repo, branch, cache, and artifact count |
| `list --json` | exits 0; valid JSON; `repo`, `branch`, `artifacts[]` |
| every artifact | `slug` matches `^[a-z0-9][a-z0-9-]{0,63}$`; `title` non-empty; `path`, `meta`, `updatedAt`, `bytes` present |
| `load` | exits 0; `index.html` exists; its SHA-256 equals `meta.json.sha256` when the field is present |
| `history` | exits 0; at least one commit; output names the slug path |
| count | `list --json` count equals `/dsh-artifacts/list` count and the panel header count |

`index.json` must be sorted by `updatedAt` descending and point at the same `artifacts/<slug>/index.html` path that `load` writes.

## Schema checks

Validate every `artifacts/<slug>/meta.json`:

```text
slug, title, description, tags[], source, path, sha256, bytes, createdAt, updatedAt
```

`preview` may be absent; if present it must be `artifacts/<slug>/preview.png` and the file must exist. Reject a `preview` path outside its own artifact directory.

## Adjacent probes

```bash
node "$S" load does-not-exist --out "$EVIDENCE/store/missing"        # nonzero, no partial output
node "$S" history does-not-exist                                     # nonzero
node "$S" list --query zzzzz-no-match --json                         # 0 artifacts, exit 0
```

Scan the store for obvious secrets before reporting success:

```bash
grep -RIlE 'ghp_|github_pat_|sk-[A-Za-z0-9]|AKIA|BEGIN [A-Z ]*PRIVATE KEY' \
  "$CACHE/artifacts" "$CACHE/index.json"
```

Any hit is a FAIL and must be reported without printing the secret.

## Writes

Do **not** run `save`, `import`, `init`, or `restore --commit` against the real repository during routine verification. If a write path must be proven, use a disposable private repo, pass `--repo owner/tmp-verify-<timestamp>`, then delete it and state that the disposable repo was used. Never force-push or rewrite history.

## PASS / FAIL / BLOCKED

- **PASS** — all read-only commands exit 0, schema and hashes agree, count matches the panel, probes behave, no secrets.
- **FAIL** — a schema field, hash, count, path, or read-only command is wrong, or a secret is present.
- **BLOCKED** — `gh` unauthenticated, repo/cache missing, or the network cannot pull; report the exact command and error, do not substitute a local fixture for the configured store.
