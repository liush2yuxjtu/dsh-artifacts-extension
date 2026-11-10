# Find and preview a saved artifact

The English and Chinese stories show a DSH user finding an existing release checklist among six saved HTML files, then opening its preview. Independent silent reviews passed for both full stories and both 8-second previews. The review covers finding and viewing the saved file.

## Watch and install

| Language | 8-second preview | Full story | Install |
| --- | --- | --- | --- |
| English | [GIF](en/feature-8s.gif) | [13-second MP4](en/story.mp4) | [English instructions](../../../README.md#install-in-a-dsh-web-profile) |
| 简体中文 | [GIF](zh/feature-8s.gif) | [12 秒 MP4](zh/story.mp4) | [中文安装步骤](../../../README.zh-CN.md#安装) |

The GIFs are 960×768. Use their full width when inspecting the controls and text. At narrow display widths, open the full video. The result is held for 3.841 seconds in the English GIF and 4.650 seconds in the Chinese GIF.

## Source and scope

The unchanged plugin runs inside an actual local DSH Web profile in Chromium. The store contains ordinary sample HTML files prepared before recording. The plugin reads those files through its normal authenticated routes and displays the actual HTML in its preview iframe. No product UI frames, model replies or route responses were synthesized.

| Item | Recorded value |
| --- | --- |
| Plugin version | `@local/dsh-artifacts` `0.1.3` |
| Plugin source commit | `45ac3f386554fc994b17a7c7f465faeb49cc390e` |
| DSH source commit | `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` |
| Environment | Local `repository-build` |
| Model turns | 0 |
| New DeepSeek API responses | 0 |
| Playback speed | 1×, no cuts |
| Audio, subtitles and decorative overlays | None; the normal pointer is visible |

This run does not validate AI artifact creation, store synchronization, tweak generation, cross-session persistence, or a production deployment. The 8-second previews end before the copy action. The full recordings also show the copy feedback, and the runtime independently reads the expected file path from the clipboard. That additional check is separate from the preview's claim.

## Evidence

| Surface | Result | Evidence |
| --- | --- | --- |
| Existing static and command handler verifier | 46/46 PASS | [Static report](verify/static-report.json) |
| Actual plugin UI, normal routes and sample files | PASS in both languages | [English run](en/recording.json), [Chinese run](zh/recording.json) |
| Search 6→1, HTML preview, copy and clipboard readback | PASS in both languages | [English rehearsal](en/rehearsal.json), [Chinese rehearsal](zh/rehearsal.json) |
| No-match search, no-cookie 401, unknown-slug 404 | PASS in both languages | Same rehearsal reports |
| Fresh runtime recheck, including page and console errors | PASS, zero errors in both languages | [English recheck](verify/runtime-recheck-en.json), [Chinese recheck](verify/runtime-recheck-zh.json) |
| Matching UI and sample-content language | PASS | [English frames](en/contact-sheet.png), [Chinese frames](zh/contact-sheet.png), independent review below |
| Independent silent story comprehension | 4/4 PASS | [Unedited reviewer response](verify/cold-viewer-review.json), [hash bindings](verify/cold-viewer-bindings.json) |
| Media format, source hashes and README links | PASS when `verify-story-media.py` succeeds | [Local verification](verify/local-verification.json) |
| Installation conversion change | Not measured | Media placement creates an install path; it does not establish a conversion lift |

The reviewer received only four anonymous 16-frame sheets. They did not receive the README, storyboard, source paths or feature description. The original response is preserved. The hash bindings prove that the reviewed sheets are the same bytes as the published English/Chinese story and preview sheets. The copy feedback needed zoom in the full-story sheets; it is not part of the preview acceptance claim.

The original capture collected page errors only. Its metadata incorrectly called that list `consoleErrors`; the corrected recording receipt now calls it `pageErrors` and records the correction. A separate fresh runtime recheck collected both error types. The GT recordings and reviewed images did not change.

### Original recordings

| Language | Immutable GT | SHA-256 |
| --- | --- | --- |
| English | [raw/gt.mp4](en/raw/gt.mp4) | `2a44581510ebe3e2fdba4d0643c5572d815163a53f72990bc8a5f5bbba809421` |
| 简体中文 | [raw/gt.mp4](zh/raw/gt.mp4) | `72f8ce8fc568fa0fcae3cdabf90b2edcf58cd72bf7cf3b6fdd7d28cdbd9936e9` |

Each [English manifest](en/manifest.json) and [Chinese manifest](zh/manifest.json) binds the plugin files, GT, MP4, GIF, posters and frame sheets to SHA-256. The GIF interval is the continuous range `[0.8s, 8.8s]` of its GT. The full MP4 preserves the complete take at its original speed. The only GIF crop removes the host navigation; it does not remove part of the active artifact panel.

## Repeat the checks

Run from the repository root. FFmpeg, ffprobe and Python 3 are required for media checks.

```bash
node skills/verify-dsh-artifacts/scripts/verify.mjs --static-only
python3 scripts/verify-story-media.py
```

The verifier checks every recorded byte hash, actual MP4/GIF metadata, result hold intervals, independent-review bindings, matching language, and README media-to-install links. It does not invent a new visual verdict or replace the human-readable independent response.

## Make a new recording

Use a built checkout of the pinned DSH revision, its existing Playwright dependencies, and a working Chromium binary. Configure `DSH_SOURCE_ROOT`, `DSH_CHROMIUM_PATH` and `DSH_STORY_OUTPUT`. Set `DSH_CHROMIUM_LIBRARY_PATH` only when the browser's shared libraries need it. The DSH scaffold's record mode requires an existing authorized credential through `DSH_API_KEY_FILE`; this read-only story makes no model call.

```bash
node scripts/record-story.mjs
python3 scripts/build-story-media.py "$DSH_STORY_OUTPUT" <new-media-directory>
```

Use a new output directory for every take. The recorder requires `~/.dsh/artifact-store.json` to be absent. It uses exclusive creation for a temporary config pointing only to the sample files, and removes it only after verifying that its content is unchanged. It never overwrites a configured user store.

Run `DSH_STORY_REHEARSE=1` for a separate preview-only rehearsal. `DSH_STORY_LANGS=en` or `DSH_STORY_LANGS=zh` selects one language. The default records both languages. Every new take needs a new independent silent review before replacing the README media.

## Retained failure record

The initial rehearsal exposed missing dependency links and a browser library path. The recorder now resolves dependencies from the specified DSH checkout and supports a browser-specific library path. An initial media export incorrectly assumed DPR 2 also doubled CDP video dimensions. FFmpeg rejected the out-of-bounds crop. The export now reads the source video's actual dimensions with ffprobe. The successful recordings, timestamps and GT files were retained unchanged.

The local failed runs are retained in `.runtime/`. Public evidence contains only non-sensitive demonstration content. No user store or production data was changed.
