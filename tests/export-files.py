#!/usr/bin/env python3
"""Open real native export files and exercise print/PNG/import in Chromium.

Development-only dependencies: playwright, python-docx, python-pptx, Pillow,
pypdf. The plugin runtime does not depend on Python or these packages.
"""
import argparse
import csv
import io
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from docx import Document
from pptx import Presentation
from PIL import Image
from pypdf import PdfReader
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3100')
parser.add_argument('--storage-state', required=True)
parser.add_argument('--artifacts', required=True, help='A workbench-browser.py report')
parser.add_argument('--out', default='/tmp/artifacts-qa/exports')
args = parser.parse_args()
out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
ids = json.loads(Path(args.artifacts).read_text())['artifacts']
report = {'checks': [], 'files': [], 'imports': [], 'pdf_pages': {}, 'browser': 'Chromium', 'verdict': 'FAIL'}
formats = {'docs': ['md','docx','json','html','zip'], 'slides': ['pptx','json','svg','html','zip'], 'design': ['json','svg','html','zip'], 'data': ['csv','json','svg','html','zip'], 'whiteboard': ['json','svg','html','zip'], 'html': ['json','html','zip']}
api = args.url + '/dsh-artifacts/asset/_workbench/api/artifacts/'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(storage_state=args.storage_state, viewport={'width':1440,'height':1000}, accept_downloads=True)
    context.add_init_script("addEventListener('beforeprint',()=>window.__qaBeforePrint=true)")
    page = context.new_page()
    try:
        for kind, artifact_id in ids.items():
            record = context.request.get(api + artifact_id).json(); source = record['source']; revision = record['revision']
            for fmt in formats[kind]:
                response = context.request.get(api + artifact_id + f'/export/{revision}?format={fmt}'); assert response.ok, response.text()
                path = out / f'{kind}.{fmt}'; path.write_bytes(response.body()); report['files'].append(path.name)
                if fmt == 'json': assert json.loads(path.read_text()) == source
                elif fmt == 'svg': assert ET.parse(path).getroot().tag.endswith('svg')
                elif fmt == 'docx':
                    doc = Document(path); assert any('manually edited' in para.text for para in doc.paragraphs)
                elif fmt == 'pptx':
                    presentation = Presentation(path); assert len(presentation.slides) == len(source['frames'])
                    for slide, frame in zip(presentation.slides, source['frames']):
                        assert [shape.text for shape in slide.shapes if shape.has_text_frame] == [item['text'] for item in frame['elements']]
                elif fmt == 'zip':
                    with zipfile.ZipFile(path) as archive:
                        assert archive.testzip() is None; assert json.loads(archive.read('source.artifact.json')) == source
                        assert 'index.html' in archive.namelist()
                elif fmt == 'csv': assert len(list(csv.reader(io.StringIO(path.read_text(encoding='utf-8-sig'))))) == len(source['rows']) + 1

            page.goto(args.url + '/dsh-artifacts/asset/_workbench/#' + artifact_id)
            expect(page.locator('.work-title input')).to_have_value(source['title'])
            if kind in ['design','slides','data','whiteboard']:
                page.get_by_role('button', name='Export', exact=True).click()
                with page.expect_download() as event: page.get_by_role('button', name='Image · PNG', exact=True).click()
                path = out / f'{kind}.png'; event.value.save_as(str(path)); Image.open(path).verify(); report['files'].append(path.name)
                page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).click()

            page.get_by_role('button', name='Export', exact=True).click()
            page.get_by_role('button', name='PDF · browser print dialog', exact=True).click()
            page.frame_locator('iframe[title="Print artifact"]').last.locator('body').wait_for()
            print_frame = page.locator('iframe[title="Print artifact"]').last.element_handle().content_frame()
            # Chromium headless intentionally suppresses window.print / OS print
            # dialogs. Verify the actual passive print document, then produce a
            # PDF through Chromium's real print renderer. Keep that boundary in
            # the report instead of claiming the native dialog was observed.
            assert print_frame.locator('script').count() == 0
            printable = print_frame.content()
            pdf_page = context.new_page(); pdf_page.set_content(printable); pdf_page.emulate_media(media='print')
            path = out / f'{kind}.pdf'; pdf_page.pdf(path=str(path), print_background=True, prefer_css_page_size=True); pdf_page.close()
            pdf = PdfReader(path); assert len(pdf.pages) > 0
            if source.get('frames'): assert len(pdf.pages) == len(source['frames']), (kind, len(pdf.pages))
            report['pdf_pages'][kind] = len(pdf.pages); report['files'].append(path.name)
            page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).click()

            # Reimport the exported source through the actual file input, then
            # compare the Host's new source, not a transient preview DOM.
            page.locator('input[type=file]').set_input_files(str(out / f'{kind}.json'))
            expect(page.locator('.work-title input')).to_have_value(source['title'])
            for _ in range(30):
                new_id = page.url.split('#')[-1]
                if new_id != artifact_id: break
                page.wait_for_timeout(100)
            assert new_id != artifact_id
            assert context.request.get(api + new_id).json()['source'] == source
            report['imports'].append(kind); report['checks'].append({'type':kind,'ok':True}); print('PASS opened exports, print, and editable source reimport:', kind, flush=True)
        report['verdict'] = 'PASS'
        report['native_print_dialog'] = {'verdict':'BLOCKED','reason':'Headless Chromium suppresses the native print dialog; shared desktop startup is unavailable.'}
        report['pdf_method'] = 'Chromium printToPDF of the actual passive print-frame content'
    finally:
        (out / 'report.json').write_text(json.dumps(report, indent=2))
        browser.close()
