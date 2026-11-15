#!/usr/bin/env python3
"""Real DSH UI, synthetic proposal producer; explicitly zero model calls.

Regression: a proposal arriving during a save must reveal Review Agent without
reloading or replacing the instruction input. Also verifies concurrent edits
survive apply and the parent waits for save before closing the workbench.
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:3100')
parser.add_argument('--storage-state',required=True)
parser.add_argument('--workspace',default='.runtime/dsh-workspace')
parser.add_argument('--out',default='verify-evidence/native-candidate/proposal-ui')
args=parser.parse_args()
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(storage_state=args.storage_state,viewport={'width':1440,'height':1000})
    page=context.new_page();page.goto(args.url+'/');page.wait_for_load_state('networkidle');page.keyboard.press('Escape')
    page.get_by_role('button',name='Artifacts',exact=True).click()
    page.get_by_role('button',name='Open workbench',exact=True).click()
    editor=page.frame_locator('iframe[title="Open workbench"]')
    editor.get_by_role('button',name='+ New artifact',exact=True).click()
    editor.get_by_role('dialog').get_by_label('Artifact type').select_option('docs')
    editor.get_by_role('dialog').get_by_label('Artifact title').fill('Synthetic proposal browser fixture')
    editor.get_by_role('button',name='Create artifact',exact=True).click()
    editor.get_by_label('Document Markdown').fill('# Fixture\n\nKeep this manually written line.')
    editor.get_by_role('button',name='Save',exact=True).click();expect(editor.locator('.save-state')).to_contain_text('Saved')
    editor.get_by_label('Agent instruction').fill('Add one paragraph; preserve the existing line.')
    editor.get_by_role('button',name='Ask Agent',exact=True).click()
    command=editor.get_by_role('dialog').locator('pre').inner_text();_,_,artifact,request=command.split()
    editor.get_by_role('dialog').get_by_role('button',name='Close',exact=True).click()
    api=args.url+'/dsh-artifacts/asset/_workbench/api/artifacts/'
    source=context.request.get(api+artifact).json()['source'];source['body']+='\n\nA synthetic proposal-only paragraph.'
    path=Path('.runtime/browser-proposal-source.json');path.write_text(json.dumps(source))
    env={**os.environ,'DSH_ARTIFACTS_WORKSPACE':str(Path(args.workspace).resolve())}
    subprocess.run(['node','scripts/workspace.mjs','propose',artifact,request,'--file',str(path),'--summary','Synthetic UI proposal fixture; no model call'],env=env,check=True,capture_output=True)
    editor.get_by_label('Artifact title',exact=True).fill('Manual title retained')
    editor.get_by_role('button',name='Save',exact=True).click();expect(editor.locator('.save-state')).to_contain_text('Saved')
    editor.get_by_role('button',name='Review Agent',exact=True).click(timeout=10000)
    expect(editor.get_by_role('dialog')).to_contain_text('Synthetic UI proposal fixture')
    editor.get_by_role('dialog').get_by_role('button',name='Apply proposal',exact=True).click()
    expect(editor.get_by_label('Document Markdown')).to_have_value(re.compile('proposal-only paragraph'))
    expect(editor.get_by_label('Artifact title',exact=True)).to_have_value('Manual title retained')
    page.screenshot(path=str(out/'applied.png'))
    editor.get_by_label('Document Markdown').fill('# Immediate close\n\nSave before the parent closes.')
    page.get_by_role('button',name='Back to artifacts',exact=True).click()
    expect(page.locator('iframe[title="Open workbench"]')).to_have_count(0)
    assert context.request.get(api+artifact).json()['source']['body']=='# Immediate close\n\nSave before the parent closes.'
    report={'verdict':'PASS','modelCalls':0,'producer':'synthetic fixture via packaged proposal protocol','checks':['review appears after concurrent save','real DSH proposal preview and apply','parallel manual title preserved','parent close awaits save']}
    (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
    browser.close()
