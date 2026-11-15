# Local Artifacts workbench

This branch adds an **unreleased implementation candidate** alongside the existing HTML artifact-store library. Native editing requires neither the external artifact skills nor a configured Git repository.

Open **Artifacts → Open workbench → New artifact** and choose Docs, Slides, Design, Data, Whiteboard, or HTML. Sources are stored on this machine under `~/.dsh/artifacts-workspace/`. **Edit a local copy** imports legacy HTML and relative resources without changing the original cache.

## Editing

- **Docs:** edit Markdown with bold, italic, headings, lists, code and links; inspect the adjacent preview. Select text before asking the Agent for a focused revision.
- **Slides:** add, duplicate, delete and reorder pages. Select objects to edit text, geometry, colors and links. Drag objects, use resize handles, or align them in Properties. Present opens a content preview.
- **Design:** edit multiple artboards. Properties affects selected objects; Global Tweaks stages a coordinated theme preview across typography, spacing, colors, shape, elevation and motion. Apply creates a recoverable version; Cancel preserves the applied source. Artboards may override global values and restore following global. Object style overrides are preserved and can be reset independently.
- **Data:** edit source cells, add/delete rows, add columns, choose category, measure, sum/mean/count and bar/line/pie chart. Sum/mean ignore empty or non-numeric measures; count counts rows. Filtering changes the view without deleting source data. The grid shows the first 250 filtered rows; exports include all rows. Keep source and calculation notes with the data.
- **Whiteboard:** edit text, stickies, shapes and connection labels; Shift-select two nodes to connect them. Group, move, resize, align, zoom and scroll. Exports include negative and distant coordinates.
- **HTML:** edit and run interactive source in an isolated `allow-scripts` preview. Errors appear with a repair action. Imported local resources are retained in ZIP; remote resources remain external dependencies.

Edits autosave after a short pause. **Save** or Ctrl/⌘ S saves immediately. Undo/Redo covers local edits. History highlights source changes and restores old content by appending a new version. Source size, including embedded resources, is limited to 2 MB.

Concurrent editors cannot silently overwrite each other. A stale save retains the incoming draft on disk and returns a conflict. **Recovered drafts** downloads it or reopens it as an independent artifact, including after reload. Current source and saved history remain intact.

## Agent edits and natural-language Tweaks

1. Describe a change in **Ask Agent**. For an overall direction, describe the desired result, such as “more Apple-like, keep all content and actions.” This phrase is not a hard-coded preset.
2. Paste the generated `/artifact-store edit <artifact-id> <request-id>` into an existing DSH session. This step requires a working DSH model/account and workspace.
3. The command queues a coding-agent turn with the exact artifact, base revision, source snapshot, selection and errors. The packaged `scripts/workspace.mjs` CLI reads the request and submits a proposal; it does not overwrite current source or apply changes.
4. **Review Agent** previews the proposal. Compare, Apply, Cancel or save a separate copy. Independent object fields merge with newer manual edits; competing text/array edits produce a recoverable conflict.

Handler/CLI tests certify routing and concurrency, not real model execution. Check the candidate verification report for live-model status.

## Export

| Type | Direct file downloads | Browser operations |
| --- | --- | --- |
| Docs | Markdown, editable DOCX, JSON, HTML, ZIP | Print to PDF |
| Slides | Editable PPTX, selected-page SVG, JSON, HTML, ZIP with all page SVGs | Selected-page PNG; all-page PDF |
| Design | Selected-artboard SVG, JSON, runnable HTML, ZIP with all artboards | Selected-artboard PNG; PDF |
| Data | Source/filtered CSV, JSON with source and configuration, SVG, HTML, ZIP | Chart PNG; PDF |
| Whiteboard | SVG, editable JSON, HTML, ZIP | PNG; PDF |
| HTML | HTML, editable JSON, ZIP with imported resources | PDF |

**PDF opens the browser print dialog:** choose Save as PDF. It is not a server PDF API. PNG uses the browser image renderer. No deployment is required. Exports use the current saved revision; pending Tweaks must first be applied or cancelled. Workbench controls and selection outlines are excluded. JSON can be imported to resume editing. DOCX/PPTX contain editable text and shapes, using the editor's basic formatting subset. Substituted fonts and SVG text wrapping can differ from browser layout.

## Installation and verification

Use the README's profile installation steps with this checkout or a candidate tarball. Keep `@local/dsh-artifacts` in the profile bundles. All native assets and the proposal CLI are packaged. Node 22+ is required; there are no new production dependencies.

```sh
npm test
npm run verify:legacy
npm run dev
```

`npm run dev` starts a **disposable fixture harness**, not DSH, at `127.0.0.1:3099`. `DSH_ARTIFACTS_WORKSPACE` can select an isolated test directory. Verification must not write to the user's real artifact-store repository.

Browser checks require Python Playwright and Chromium:

```sh
python3 tests/workbench-browser.py --url http://127.0.0.1:3099
# For a disposable real DSH, supply a private authenticated browser state:
python3 tests/workbench-browser.py --url http://127.0.0.1:3100 \
  --storage-state /private/path/browser-state.json --out /tmp/artifacts-qa
```

Keep cookies, launch URLs, browser state and credentials outside committed evidence. The unchanged `verify-dsh-artifacts` skill still certifies the original five legacy surfaces separately. A native browser PASS does not certify external skills, real model calls, the inaccessible Mac mini, or a public release.
