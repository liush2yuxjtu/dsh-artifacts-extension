# `artifact-tweaks`

## Claim

An artifact produced through the `artifact-tweaks` skill must expose the Claude Design–style Tweaks panel with an `EDITMODE` state block, live accent/display/radius/density/theme controls, `localStorage` persistence, keyboard access, and the host `activate` / `deactivate` / `available` / `set_keys` postMessage protocol — and the artifact must still pass `artifact-create`'s browser verifier.

## Inputs

- Skill directory: `~/.agents/skills/artifact-tweaks`.
- Required assets: `SKILL.md`, `scripts/audit-tweaks.mjs`, `references/implementation.md`, `references/claude-design-tweaks.md`.
- Fixture: an HTML file produced by the skill. A file without Tweaks is a negative control, not a fixture.

If no tweaked fixture exists, the surface is **BLOCKED**.

## Run

```bash
node "$HOME/.agents/skills/artifact-tweaks/scripts/audit-tweaks.mjs" "$FIXTURE" --json \
  > "$EVIDENCE/tweaks/audit.json"
```

The audit prints a `results[]` array. Every entry must have `level: "pass"`.

Expected checks:

| Check | Required detail |
|---|---|
| `EDITMODE block` | keys `accent`, `display`, `radius`, `density`, `theme` |
| `Panel` | panel element exists |
| `Panel default` | hidden on load |
| `Panel title` | Tweaks label present |
| `Controls` | Accent, Display, Radius, Density, Theme |
| `Selection state` | `aria-pressed` present |
| `Persistence` | `localStorage` write present |
| `Shift+T` | shift-key handler present |
| `Host protocol` | `activate` / `deactivate` / `available` / `set_keys` |
| `IDs` | unique |
| `External assets` | none |

## Paired browser check

The audit is static. Pair it with the `artifact-create` verifier on the same file:

```bash
node "$HOME/.agents/skills/artifact-create/scripts/verify-artifact.mjs" "$FIXTURE" \
  --out "$EVIDENCE/tweaks/browser" --quiet
```

Then drive the panel once in the browser: press Shift+T, change accent and theme, reload, and confirm the values persist. Do not claim persistence from the static `localStorage` substring alone.

## Command surface

`/artifact-tweak <requirement>` must build one follow-up user message naming `artifact-tweaks` and the Tweaks requirements, then return `kind: 'success'`. With empty input it returns `kind: 'error'` and the usage string. The handler must not claim to edit the file itself.

## Adjacent probes

- Audit an artifact **without** Tweaks; the audit must report failures, proving it is not a no-op.
- `audit-tweaks.mjs` on a missing file exits nonzero.
- Confirm the panel's theme control does not hard-code a light-only palette; check the dark theme by toggling the app theme.

## PASS / FAIL / BLOCKED

- **PASS** — audit exits 0 with every result `pass`, the paired browser verifier passes, the one live panel interaction persists, and the negative control fails.
- **FAIL** — any audit result is `fail`/`warn`, the browser verifier fails, persistence does not survive reload, or the protocol is incomplete.
- **BLOCKED** — no tweaked fixture, no Chrome, or the audit script cannot run.
