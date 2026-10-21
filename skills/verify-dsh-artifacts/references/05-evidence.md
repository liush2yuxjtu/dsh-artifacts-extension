# Evidence and verdict

## Evidence directory

Every run writes under:

```text
verify-evidence/<YYYY-MM-DD-HHMMSS>/
  report.json
  report.md
  extension/          # HTTP JSON, route headers, host harness output
  artifact-create/    # verify-artifact.mjs output and screenshots
  store/              # status, list.json, load/, history.txt
  tweaks/             # audit.json, browser/
  ui/                 # panel screenshots and ui.json
```

Keep raw tool output. Summaries go in `report.md`; do not replace the raw files.

## `report.json`

```json
{
  "schemaVersion": 1,
  "startedAt": "2026-10-22T00:00:00.000Z",
  "finishedAt": "2026-10-22T00:02:00.000Z",
  "repo": "/absolute/path/to/dsh-artifacts-extension",
  "extension": {
    "verdict": "PASS",
    "bundleRow": "dsh-artifacts",
    "commands": ["artifact-create", "artifact-store", "artifact-tweak"],
    "routes": ["list", "preview", "html", "view", "asset"],
    "panel": { "order": ["插件", "工件", "自动化任务"], "cardCount": 13 },
    "checks": [{ "name": "no-cookie-401", "ok": true, "detail": "401" }]
  },
  "skills": {
    "artifact-create": { "verdict": "PASS", "fixture": "/abs/path.html", "sha256": "..." },
    "artifact-store": { "verdict": "PASS", "repo": "owner/name", "artifacts": 13 },
    "artifact-tweaks": { "verdict": "PASS", "fixture": "/abs/path.html", "checks": 11 }
  },
  "overall": "PASS",
  "limitations": []
}
```

Verdict values: `PASS`, `FAIL`, `BLOCKED`, `SKIP`.

## Redaction

Never write these into the evidence directory:

- browser cookie or `Set-Cookie` header;
- launch token, API key, OAuth token, credentials file;
- session contents or model prompts that contain user text;
- private artifact bodies beyond the file path, size, and hash.

`verify.mjs` redacts the cookie from every command and HTTP result. If a tool prints a secret, truncate the line and note the redaction.

## Verdict rules

| Surface | PASS | FAIL | BLOCKED | SKIP |
|---|---|---|---|---|
| Extension shell | bundle row, 3 commands, 5 routes, 401/200, panel order/cards/iframe | any required check false | `dsh web` down, no CDP page, no cookie | — |
| `artifact-create` | verifier exit 0 at 4 widths, no overflow/errors/external, 320 probe clean | verifier exit nonzero or a required visual check fails | no fixture/Chrome | skill not in scope |
| `artifact-store` | read-only commands pass, schema/hash/count agree, no secrets | schema/hash/count/probe false | repo/cache/network unreachable | — |
| `artifact-tweaks` | audit all pass, paired browser verifier pass, persistence persists | audit/browser/persistence false | no tweaked fixture/Chrome | — |

Overall:

- **PASS** — every in-scope surface PASS; SKIP only for an explicitly out-of-scope surface.
- **FAIL** — any surface FAIL.
- **BLOCKED** — a required surface BLOCKED and no substitute PASS was produced.

## `report.md` template

```markdown
# Verify report — <date>

Overall: **PASS|FAIL|BLOCKED**
Commit: <sha>
DSH: <version> · Node: <version> · Chrome: <version>

## Extension
- verdict:
- bundle row:
- commands:
- routes:
- panel order / cards / iframe:
- probes:
- evidence:

## artifact-create
- verdict:
- fixture / sha256:
- verifier command:
- widths:
- failures:
- evidence:

## artifact-store
- verdict:
- repo / artifacts:
- status/list/load/history:
- schema/hash/count:
- probes:
- evidence:

## artifact-tweaks
- verdict:
- fixture / sha256:
- audit results:
- paired browser verifier:
- persistence:
- evidence:

## Limitations
- real /artifact-create turn: yes/no
- real /artifact-tweak turn: yes/no
- store write path: not exercised / disposable repo
- browser: Chrome <version> / CDP
```

## Release gate

A release tag is allowed only when:

1. `report.json` has `overall: "PASS"`;
2. `git status` is clean and the evidence directory is ignored;
3. the three command rows are present in a fresh page after reload;
4. the panel renders after a cold `dsh web` restart (not only HMR);
5. no secret appears in `git diff` or the evidence directory.
