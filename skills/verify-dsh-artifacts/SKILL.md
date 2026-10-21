---
name: verify-dsh-artifacts
description: Verify the DSH artifacts extension end to end and all three artifact skills it fronts — /artifact-create, /artifact-store, and /artifact-tweak. Checks the installed bundle, the three slash commands, the read-only 工件 sidebar panel, host routes, artifact-create's browser verifier, artifact-store's read-only store checks, and artifact-tweaks' protocol audit. Use when developing, reviewing, or releasing this extension, or when a command, panel, or skill result is suspect. Not a generic verifier for other DSH plugins.
---

# Verify the artifacts extension

Focused verifier for the `dsh-artifacts-extension` repository and its installed `web` profile. It proves four surfaces separately and leaves reproducible evidence: the extension shell (bundle, commands, routes, sidebar panel), `artifact-create`, `artifact-store`, and `artifact-tweaks`. It is developer-only and is not part of the installed bundle.

## Claim

The installed extension must expose exactly three slash commands and one read-only 工件 panel without disabling any shipped plugin, and each of the three artifact skills it fronts must pass its own verifier against the current store or a disposable fixture without mutating user data.

An overall **PASS** requires all four surfaces to pass in the same run. A green panel does not prove a skill, and a green skill verifier does not prove the command or panel wiring.

## Surface map

| Surface | Boundary | Guide |
|---|---|---|
| Extension shell | profile link, bundle row, three commands, five routes, sidebar panel | [`references/01-extension.md`](references/01-extension.md) |
| `artifact-create` | command prompt, skill assets, `verify-artifact.mjs`, generated HTML | [`references/02-artifact-create.md`](references/02-artifact-create.md) |
| `artifact-store` | command prompt, CLI status/list/load/history, index/meta schema | [`references/03-artifact-store.md`](references/03-artifact-store.md) |
| `artifact-tweaks` | command prompt, `audit-tweaks.mjs`, EDITMODE and host protocol | [`references/04-artifact-tweaks.md`](references/04-artifact-tweaks.md) |
| Evidence and verdict | report schema, redaction, PASS/FAIL/BLOCKED/SKIP | [`references/05-evidence.md`](references/05-evidence.md) |

Run the full installed surface first. Do not disable the extension, the panel, or any shipped bundle to make a check easier; a control may use a disposable profile or fixture, but the target run must be the configured one.

## Operating rules

- **Read-only by default.** Never run `artifact-store save`, `artifact-store restore --commit`, or any Git write against the real `liush2yuxjtu/dsh-artifacts` repository. Store writes require an explicit disposable repo and the user's approval.
- **Do not spend a model turn unless the command path is the thing under test.** `/artifact-create` and `/artifact-tweak` start real turns by design. For routine verification, test their handler with the host harness and test the *skill* with its own verifier. Only drive a real turn when the user asks for the end-to-end prompt surface, and say so in the report.
- **Never log credentials.** Do not write the browser cookie, launch token, API key, session contents, or private artifact bodies into evidence. Pass the cookie through `DSH_VERIFY_COOKIE` and let the script redact it.
- **Capture raw evidence before interpretation.** Keep verifier stdout, JSON, and screenshots under `verify-evidence/<timestamp>/`.
- **Probe one adjacent path per surface.** Examples: no-cookie `401`, unknown slug `404`/nonzero, `320px` width, an artifact without Tweaks, an empty command argument.
- **Wall time is context, never the verdict.** The panel may be slower on a cold cache; report it, but decide on assertions.
- **Separate verdicts.** The extension, `artifact-create`, `artifact-store`, and `artifact-tweaks` each get their own PASS/FAIL/BLOCKED/SKIP. Overall PASS only when every required surface passes.

## Verification order

1. **Static and host harness** — no server, no model:
   ```bash
   node skills/verify-dsh-artifacts/scripts/verify.mjs --static-only
   ```
   Asserts the manifest, bundle patch, bundle row, three command definitions, five routes, and the command handlers' result/followup shape.

2. **Live HTTP** — the configured `dsh web` process:
   ```bash
   DSH_VERIFY_COOKIE='<cookie>' \
     node skills/verify-dsh-artifacts/scripts/verify.mjs --http-only
   ```
   Asserts no-cookie `401`, authenticated `200`, list JSON, preview PNG, HTML, view with `<base>`, asset serving, and traversal `404`.

3. **Panel** — a CDP page:
   ```bash
   node skills/verify-dsh-artifacts/scripts/ui-verify.mjs \
     --cdp '<ws-url>' --cookie "$DSH_VERIFY_COOKIE" --out verify-evidence/<timestamp>/ui
   ```
   Asserts sidebar order `插件 → 工件 → 自动化任务`, cards, search, detail iframe, copy toast, responsive widths, and no console errors.

4. **`artifact-create`**:
   ```bash
   node skills/verify-dsh-artifacts/scripts/verify.mjs --skill create \
     --fixture /path/to/generated/artifact.html
   ```
   Runs the skill's own `verify-artifact.mjs` at 1440/1024/820/390 and writes the QA output.

5. **`artifact-store`**:
   ```bash
   node skills/verify-dsh-artifacts/scripts/verify.mjs --skill store --store-slug dsh-home
   ```
   Runs `status`, `list --json`, `load` to a temp dir, and `history`; validates `index.json` and every `meta.json`; never saves.

6. **`artifact-tweaks`**:
   ```bash
   node skills/verify-dsh-artifacts/scripts/verify.mjs --skill tweaks \
     --tweaks-file /path/to/tweaked/artifact.html
   ```
   Runs the skill's `audit-tweaks.mjs`; every result must be `pass`.

7. **Report** — `report.md` and `report.json` under the evidence directory, with one verdict per surface.

## Skill handoff

- **`verify-dsh-artifacts`** — measurement and proof only.
- **`artifact-create`** — fix artifact structure, responsive composition, and the browser-verifier result.
- **`artifact-store`** — fix slugs, manifests, commits, restore, and preview assets.
- **`artifact-tweaks`** — fix the Tweaks panel, persistence, and host protocol.
- **`cordis-plugin-development`** — fix the bundle, command registration, slot registration, or profile wiring.

Do not patch a skill's verifier to make a failing artifact pass. Fix the artifact or the extension.

## Cleanup

Delete only disposable QA output, temporary checkouts, and browser profiles created by this run. Keep `verify-evidence/<timestamp>/` unless the user asks to remove it. Do not delete sessions, caches, credentials, the artifact store, or unrelated working changes. After cleanup, read back the panel route, the store `status`, and the three command definitions.

## Cross-surface verdict

Use exactly one verdict per surface:

- **PASS** — every required assertion holds and the adjacent probe behaves as specified.
- **FAIL** — a required assertion is false, or the observed surface contradicts the claim.
- **BLOCKED** — the exact surface cannot be reached (no running `dsh web`, no CDP page, no generated fixture, no authenticated cookie).
- **SKIP** — no executable behavior is in scope for that surface; state why.

Overall:

| Extension | create | store | tweaks | Overall |
|---|---|---|---|---|
| PASS | PASS | PASS | PASS | **PASS** |
| PASS | PASS | PASS | SKIP | **PASS (three of four)** |
| any FAIL | | | | **FAIL** |
| any BLOCKED without a PASS substitute | | | | **BLOCKED** |

State separately whether the real `/artifact-create` and `/artifact-tweak` turns were driven. A host-harness PASS proves prompt construction, not model execution.
