# Extension shell

## Surface 1 — Installed bundle

Read the installed profile before interpreting the UI. The extension is distributed as a local bundle in the `web` profile:

```text
~/.dsh/profiles/web/package.json
  dependencies["@local/dsh-artifacts"] = "link:<repo>"
  dsh.profile.bundles[] contains "@local/dsh-artifacts"

~/.dsh/profiles/web/node_modules/@local/dsh-artifacts -> <repo>
```

Checks:

```bash
dsh --profile web --dump-config | grep -A2 '@local/dsh-artifacts'
node --check <repo>/index.js
node --check <repo>/client.js
```

Expected:

- exactly one composed row `id: dsh-artifacts`, `name: '@local/dsh-artifacts'`;
- no duplicate bundle row;
- both JavaScript files parse;
- `package.json` declares `dsh.bundle.patch`, `dsh.client.platform === 'web'`, and exports `.`, `./client`, `./locale/*.json`, `./icon`.

The installed build runs from the profile's link. Editing the repository requires a page reload for client code and an HMR recomposition (or `dsh web` restart) for host code. Do not verify stale code: record the extension's `mtime` and the page's load time in the evidence.

## Surface 2 — Commands

The host half registers exactly three global commands. Use the harness in `scripts/verify.mjs --static-only`; it imports `index.js` with a fake context and asserts:

| Name | Input | Expected handler |
|---|---|---|
| `artifact-create` | required description | empty → `kind: 'error'` usage; non-empty → one frozen follow-up user message + `kind: 'success'` |
| `artifact-store` | optional subcommand | empty/`list`/`status` → store summary, no follow-up; `save/load/history/restore` → follow-up; unknown → `kind: 'error'` |
| `artifact-tweak` | required requirement | empty → `kind: 'error'` usage; non-empty → one follow-up user message + `kind: 'success'` |

Expected follow-up message shape (the same shape the Host's own commands produce):

```json
{ "id": "<uuid>", "role": "user", "content": [{ "type": "text", "text": "..." }], "source": { "kind": "user" } }
```

The message must be deeply frozen. The prompt must name the skill (`artifact-create`, `artifact-store`, or `artifact-tweaks`) and must not claim the command itself performs the work.

UI check: open `http://127.0.0.1:3080/`, focus the composer, type `/artifact`, and assert three rows under the **指令** group. The **技能** group may also show `artifact-tweaks`; that is the skill catalog, not a fourth command.

Adjacent probe: in a brand-new blank session, the first `/artifact-*` line may be submitted as a normal prompt because the client command directory waits for a retained session. Record which case was observed; this is DSH command behavior, not an extension failure. Re-run in an existing session to prove execution.

## Surface 3 — Routes

All routes are under `/dsh-artifacts` and require the browser cookie. Without it the exact route must answer `401`, not the SPA shell.

| Route | Expected |
|---|---|
| `GET /dsh-artifacts/list` | `200 application/json`; `{ configured, available, repo, artifacts[] }` |
| `GET /dsh-artifacts/preview/<slug>` | `200 image/png`; `404` for an unknown slug |
| `GET /dsh-artifacts/html/<slug>` | `200 text/html`; raw `index.html` |
| `GET /dsh-artifacts/view/<slug>` | `200 text/html`; contains `<base href="/dsh-artifacts/asset/<slug>/">` |
| `GET /dsh-artifacts/asset/<slug>/<path>` | file inside that artifact directory; traversal and symlink escape → `404` |

Probes:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/dsh-artifacts/list          # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: $DSH_VERIFY_COOKIE" \
  http://127.0.0.1:3080/dsh-artifacts/list                                                # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: $DSH_VERIFY_COOKIE" \
  'http://127.0.0.1:3080/dsh-artifacts/asset/dsh-home/../../../../.credentials.yaml'     # 404
```

`/dsh-artifacts/list` must report the same artifact count as `artifact-store list --json`.

## Surface 4 — Sidebar panel

The client registers `sidebar.panellist` with `id: artifacts`, `order: 5`, and `main` with `key: artifacts`.

Expected order of the three global rows:

```text
插件 (order 0)
工件 (order 5)
自动化任务 (order 10)
```

Panel checks:

- header `工件`, count matches the route;
- search filters slug/title/description/tags (e.g. `sleep` → the two Lull artifacts);
- tag chips filter and combine with search;
- opening a card shows breadcrumb, title, description, tags, date, size, slug, `复制路径`, `在新标签页打开`;
- the detail iframe has a non-empty `srcdoc` and the expected `sandbox` (scripts only, no same-origin);
- `复制路径` produces the `已复制` toast and copies `artifacts/<slug>/index.html`;
- `刷新` re-fetches and keeps the count;
- no horizontal overflow at 320/390/820/1024/1280;
- no console errors or unhandled rejections;
- dark theme keeps text and borders legible.

Drive it with `ui-verify.mjs`; see [`05-evidence.md`](05-evidence.md) for the report fields. Do not substitute a screenshot for the assertions.

## Failure map

| Observation | Likely owner |
|---|---|
| sidebar row missing | bundle not composed, client manifest invalid, or slot registration failed |
| row appears but panel blank | `main` key missing or React render error; check console |
| `401` with a fresh cookie | cookie belongs to another authority/port; re-open the startup URL |
| list `200` but 0 artifacts | cache missing; run `artifact-store status` |
| detail iframe blank | `/html/<slug>` failed or artifact scripts blocked by sandbox; open the view route |
| command row missing | host command not registered; check `dump-config` and HMR |
