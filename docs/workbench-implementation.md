# Artifacts workbench implementation

Source requirements: [Artifacts PRD](https://chatgpt.com/space/page_0b95cd408e248191b867845e35619187) and [NIGHT_RUN](https://chatgpt.com/space/page_0c365034e1488191ab4fa31c16f4a127), read on 2026-11-15.

Baseline: `9826d31d7838a468e54881d11e4f5f3970d29c29`. Only `main` was advertised by the public remote. The Mac mini connector returned HTTP 429 on both bash and directory probes; its uncommitted work and original task remain unknown. This isolated candidate does not modify that machine or the existing artifact-store cache. No release or deployment is implied.

## Implementation order

1. Local typed source, atomic revision history, optimistic concurrency, restore and reviewable Agent proposals. No external skill or repository configuration needed for native creation.
2. Docs Markdown editing and formatting; Slides pages and objects; Design artboards, Properties and staged global Tweaks; Data source/table/filter/chart; Whiteboard nodes, connections and groups. Preserve the existing HTML library and add editable HTML copies.
3. Content-only exports, editable OOXML documents, vector exports, raster downloads and browser print to PDF. Clearly label browser-dependent formats.
4. Integrate the existing DSH panel and command lifecycle. Agent changes use a pinned request snapshot and a proposal CLI, never direct replacement of current source. Preview, apply, cancel and conflict recovery remain in the workbench.
5. Run the unchanged legacy verifier, meaningful storage/export/security tests and real browser interaction tests. Try a disposable real DSH installation. Record real-model and original-machine checks independently of local harness results.

## Boundaries

- Native workspace is local, separate from the private Git artifact-store; no automatic Git writes, publishing or deployment.
- Existing five Host registrations and three commands stay compatible. The reserved, previously invalid legacy slug `_workbench` underneath `/dsh-artifacts/asset/` serves packaged native editor assets and its authenticated API. Legacy artifact routes remain read-only.
- The native source is authoritative. All editor changes, exports and proposals operate on it. Staged Tweaks are not saved or exported until applied.
- A PDF control opens the browser's print dialog; this is labeled explicitly. PNG is rendered by the browser. Markdown, JSON, CSV, SVG, HTML, ZIP, DOCX and PPTX are downloaded files.
- Natural-language style requests are sent to a real coding agent through the existing DSH command path. They are not mapped to a canned “Apple” preset.

## Acceptance ledger

Keep all nine PRD tasks open until their specific runtime evidence exists. Static checks or a host harness do not certify real DSH, live model execution, full export fidelity, or access to the original Mac worktree. The verification report records checks, exact source identity, limitations and failure items.
