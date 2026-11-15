#!/usr/bin/env python3
"""Interaction verifier. Requires Python Playwright and Chromium; uses synthetic data.

Can run against the local fixture harness or an authenticated, disposable DSH.
Never prints a cookie, launch URL, credential or real artifact body.
"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

args = argparse.ArgumentParser()
args.add_argument('--url', default='http://127.0.0.1:3099')
args.add_argument('--storage-state')
args.add_argument('--out', default='/tmp/artifacts-qa/browser')
args.add_argument('--chromium', default='/usr/bin/chromium')
args = args.parse_args()
out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
report = {'url': args.url, 'browser': 'Chromium via local Playwright', 'fallback': 'Browser plugin not available; ego-browser CLI not installed on Linux', 'checks': [], 'screenshots': [], 'artifacts': {}, 'errors': []}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, **({'storage_state': args.storage_state} if args.storage_state else {}))
    page = context.new_page(); page.set_default_timeout(10000)
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    api_path = '/dsh-artifacts/asset/_workbench/api/artifacts'

    def check(name, fn):
        fn(); report['checks'].append({'name': name, 'ok': True}); print('PASS', name, flush=True)

    def screenshot(name):
        path = out / (name + '.png'); page.screenshot(path=str(path)); report['screenshots'].append(str(path))

    def saved():
        page.get_by_role('button', name='Save', exact=True).click(); expect(page.locator('.save-state')).to_contain_text('Saved')

    def record():
        artifact_id = page.url.split('#')[-1]
        response = context.request.get(args.url + api_path + '/' + artifact_id); assert response.ok
        return response.json()

    def create(kind):
        page.get_by_role('button', name='+ New artifact', exact=True).click()
        d = page.get_by_role('dialog'); d.get_by_label('Artifact type', exact=True).select_option(kind)
        d.get_by_label('Artifact title', exact=True).fill('Browser QA ' + kind)
        d.get_by_role('button', name='Create artifact', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.locator('.work-title input')).to_have_value('Browser QA ' + kind)
        artifact_id = page.url.split('#')[-1]; report['artifacts'][kind] = artifact_id

    def change(label, value):
        el = page.get_by_label(label, exact=True); el.fill(str(value)); el.press('Tab')

    def export(label, filename):
        saved(); page.get_by_role('button', name='Export', exact=True).click()
        with page.expect_download() as event:
            page.get_by_role('dialog', name='Export artifact').get_by_role('button', name=label, exact=True).click()
        event.value.save_as(str(out / filename))
        page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).click()
        assert (out / filename).stat().st_size > 0

    try:
        if not args.storage_state: page.goto(args.url + '/')
        page.goto(args.url + '/dsh-artifacts/asset/_workbench/'); page.wait_for_load_state('networkidle')
        check('identity and meaningful first screen', lambda: (expect(page).to_have_title('Artifacts workbench'), expect(page.get_by_role('button', name='+ New artifact', exact=True)).to_be_visible()))
        assert page.evaluate('typeof globalThis.__PLUNO_WEBMCP_TOOLS__') == 'undefined'

        create('docs')
        content = '# Browser QA docs\n\nA manually edited paragraph.\n\n中文正文 stays editable.'
        page.get_by_label('Document Markdown', exact=True).fill(content); saved()
        check('Docs text and saved version', lambda: (expect(page.get_by_label('Document Markdown', exact=True)).to_have_value(content), expect(page.get_by_role('button', name='Undo', exact=True)).to_be_enabled()))
        page.get_by_role('button', name='Undo', exact=True).click()
        page.get_by_role('button', name='Redo', exact=True).click(); saved()
        page.reload(); page.wait_for_load_state('networkidle')
        check('Docs reload persistence', lambda: expect(page.get_by_label('Document Markdown', exact=True)).to_have_value(content))
        page.get_by_role('button', name='History', exact=True).click()
        rows = page.get_by_role('dialog').locator('.version-row')
        rows.last.get_by_role('button', name='Compare', exact=True).click(); expect(page.locator('.diff-columns')).to_be_visible()
        expect(page.locator('.source-diff')).to_contain_text('A manually edited paragraph.')
        rows.last.get_by_role('button', name='Restore', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        check('Docs historical restore appends a version', lambda: (expect(page.get_by_label('Document Markdown', exact=True)).not_to_have_value(content), expect(page.locator('.save-state')).to_contain_text('Saved')))
        page.get_by_label('Document Markdown', exact=True).fill(content); saved()
        export('Markdown', 'docs.md'); export('Editable Word · DOCX', 'docs.docx'); export('Editable source · JSON', 'docs.artifact.json')
        screenshot('docs-desktop')

        create('slides')
        page.locator('.object').first.click(); change('Object text', 'An editable first slide'); change('X', 120); saved()
        page.get_by_role('button', name='Page 2: The next chapter', exact=True).click()
        page.get_by_role('button', name='Move up', exact=True).click(); saved()
        r = record(); assert r['source']['frames'][0]['title'] == 'The next chapter'; assert r['source']['frames'][1]['elements'][0]['x'] == 120
        check('Slides text, geometry and reordering', lambda: expect(page.locator('.pages .page-row').first).to_contain_text('The next chapter'))
        export('Editable PowerPoint · PPTX', 'slides.pptx'); screenshot('slides-desktop')

        create('design')
        expect(page.locator('.artboard')).to_have_count(3)
        page.locator('.object').first.click(); change('Width', 760)
        page.get_by_role('button', name='Align left', exact=True).click()
        saved(); assert record()['source']['frames'][0]['elements'][0]['x'] == 32
        page.get_by_role('button', name='Undo', exact=True).click(); page.get_by_role('button', name='Redo', exact=True).click(); saved()
        check('Design local Properties and undo/redo', lambda: expect(page.get_by_label('X', exact=True)).to_have_value('32'))
        first = page.locator('.object').first; box = first.bounding_box(); page.mouse.move(box['x'] + 10, box['y'] + 10); page.mouse.down(); page.mouse.move(box['x'] + 60, box['y'] + 35, steps=6); page.mouse.up(); saved()
        assert record()['source']['frames'][0]['elements'][0]['x'] > 32
        page.get_by_role('button', name='Global Tweaks', exact=True).click()
        expect(page.get_by_label('Type scale', exact=True)).to_have_value('1')
        page.get_by_label('Type scale', exact=True).press('ArrowRight'); expect(page.get_by_role('button', name='Apply Tweaks', exact=True)).to_be_visible()
        screenshot('design-tweaks-preview')
        page.get_by_role('button', name='Cancel preview', exact=True).click(); assert record()['source']['theme']['fontScale'] == 1
        page.get_by_label('Type scale', exact=True).press('ArrowRight'); page.get_by_role('button', name='Apply Tweaks', exact=True).click(); expect(page.locator('.save-state')).to_contain_text('Saved')
        assert record()['source']['theme']['fontScale'] == 1.05
        page.get_by_role('button', name='Page 2: Details', exact=True).click()
        page.get_by_label('Tweaks scope', exact=True).select_option('page')
        page.get_by_label('Global typeface', exact=True).select_option('Georgia')
        page.get_by_role('button', name='Apply Tweaks', exact=True).click(); saved()
        assert record()['source']['frames'][1]['overrides']['fontFamily'] == 'Georgia'
        page.get_by_role('button', name='Restore artboard to global', exact=True).click(); saved()
        assert record()['source']['frames'][1]['overrides'] == {}
        check('Global Tweaks preview/cancel/apply and artboard follow', lambda: expect(page.locator('.artboard')).to_have_count(3))
        export('Vector · SVG', 'design.svg'); export('Image · PNG', 'design.png'); export('HTML + editable source · ZIP', 'design.zip'); export('Runnable HTML', 'design.html'); screenshot('design-desktop')

        create('data')
        change('Row 1 Revenue', 320); change('Filter value', 'Jan'); saved()
        r = record(); assert len(r['source']['rows']) == 4; expect(page.locator('tbody tr')).to_have_count(1)
        assert page.locator('.chart-container').inner_text().count('320') >= 1
        page.get_by_label('Chart type', exact=True).select_option('line'); saved()
        check('Data edit, chart configuration and non-destructive filter', lambda: expect(page.locator('.source-note')).to_contain_text('1 of 4 source rows'))
        export('Source data · CSV', 'data.csv'); export('Filtered view · CSV', 'data.filtered.csv'); export('Vector · SVG', 'data.svg'); screenshot('data-desktop')

        create('whiteboard')
        page.locator('.object').first.click(); page.locator('.object').nth(1).click(modifiers=['Shift'])
        page.get_by_role('button', name='Group', exact=True).click(); page.get_by_role('button', name='Connect', exact=True).click(); saved()
        r = record(); assert len(r['source']['edges']) == 2; assert r['source']['nodes'][0]['group'] == r['source']['nodes'][1]['group']
        first = page.locator('.object').first; box = first.bounding_box(); page.mouse.move(box['x'] + 12, box['y'] + 12); page.mouse.down(); page.mouse.move(box['x'] + 48, box['y'] + 34, steps=6); page.mouse.up(); saved()
        page.get_by_role('button', name='Ungroup', exact=True).click()
        page.locator('.artboard').click(position={'x':8,'y':8})
        page.locator('.object').first.click(); change('X', -400); saved()
        check('Whiteboard connections, grouping, movement and negative bounds', lambda: expect(page.get_by_label('X', exact=True)).to_have_value('-400'))
        export('Vector · SVG', 'whiteboard.svg'); export('Image · PNG', 'whiteboard.png'); export('Editable source · JSON', 'whiteboard.artifact.json'); screenshot('whiteboard-desktop')
        page.reload(); page.wait_for_load_state('networkidle'); assert record()['source']['nodes'][0]['x'] == -400

        create('html')
        source = '<!doctype html><html><body><h1>HTML still runs</h1><button onclick="this.textContent=\'Clicked\'">Try me</button><script>throw new Error("Synthetic preview failure")</script></body></html>'
        page.get_by_label('HTML source', exact=True).fill(source); saved()
        expect(page.locator('#preview-errors')).to_contain_text('Synthetic preview failure')
        frame = page.frame_locator('#text-preview'); frame.get_by_role('button', name='Try me', exact=True).click(); expect(frame.get_by_role('button', name='Clicked', exact=True)).to_be_visible()
        page.get_by_label('Agent instruction', exact=True).fill('Repair the synthetic error; keep the manual heading and button.')
        page.get_by_role('button', name='Ask Agent', exact=True).click(); expect(page.get_by_role('dialog')).to_contain_text('/artifact-store edit')
        page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).click()
        check('HTML interactions, error visibility and pinned Agent request UI', lambda: expect(page.locator('#preview-errors')).to_contain_text('Synthetic preview failure'))
        export('Runnable HTML', 'interactive.html')

        # Deliberately synthetic runtime failure belongs to the HTML preview;
        # native app errors are kept separate from this expected test signal.
        for kind, artifact_id in report['artifacts'].items():
            page.goto(args.url + '/dsh-artifacts/asset/_workbench/#' + artifact_id); page.wait_for_load_state('networkidle')
            expect(page.locator('.work-title input')).to_have_value('Browser QA ' + kind)
            for width in [390, 320]:
                page.set_viewport_size({'width': width, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{kind} overflow at {width}'
                expect(page.get_by_role('button', name='Export', exact=True)).to_be_visible()
            screenshot(kind + '-mobile')
            page.set_viewport_size({'width': 1440, 'height': 1000})
        check('all six editors fit 320px and 390px without body overflow', lambda: None)
        page.emulate_media(color_scheme='dark'); page.reload(); page.wait_for_load_state('networkidle'); screenshot('dark-mode'); check('dark-mode editor remains usable', lambda: expect(page.get_by_role('button', name='Export', exact=True)).to_be_visible())
        report['expected_preview_errors'] = report['errors'].count('Synthetic preview failure')
        report['errors'] = [e for e in report['errors'] if e != 'Synthetic preview failure']
        assert not report['errors'], report['errors']
        check('no native app runtime errors', lambda: None)
        report['verdict'] = 'PASS'
    except Exception as error:
        report['verdict'] = 'FAIL'; report['failure'] = str(error); screenshot('failure'); raise
    finally:
        (out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        browser.close()
