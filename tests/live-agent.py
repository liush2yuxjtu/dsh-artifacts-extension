#!/usr/bin/env python3
"""Real, metered DeepSeek -> DSH -> native proposal acceptance.

Uses an existing authorized credential from DEEPSEEK_API_KEY, DSH_API_KEY_FILE,
or a private --key-file. Never creates a key or prints credential values. Raw
DSH events stay in the ignored .runtime directory; only a summary is evidence.
The proposals remain pending for browser review and application.
"""
import argparse
import json
import os
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--dsh-bin', default=os.environ.get('DSH_BIN', 'dsh'))
parser.add_argument('--key-file', default=os.environ.get('DSH_API_KEY_FILE', '.runtime/deepseek-api-key'))
parser.add_argument('--workspace', default='.runtime/dsh-workspace')
parser.add_argument('--out', default='verify-evidence/native-candidate/live-agent')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
private = root / '.runtime' / 'live-agent'; private.mkdir(parents=True, exist_ok=True)
report = {'verdict':'BLOCKED','model_execution':'not started','credential_values_logged':False}

def finish(code):
    (out / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    raise SystemExit(code)

def require(condition, message):
    if not condition:
        report['verdict']='FAIL'; report['reason']=message; finish(1)

candidates = []
if os.environ.get('DEEPSEEK_API_KEY'): candidates.append(os.environ['DEEPSEEK_API_KEY'])
elif Path(args.key_file).is_file(): candidates.append(Path(args.key_file).read_text().strip())
elif (root / '.runtime/deepseek-candidates.json').is_file():
    # Optional private transfer from the user's authorized credential registry.
    candidates.extend(item['key'] for item in json.loads((root / '.runtime/deepseek-candidates.json').read_text()))
if not candidates:
    report['reason'] = 'No existing authorized credential is mounted. Supply a private key-file or environment binding.'
    finish(2)

valid = None
for key in dict.fromkeys(candidates):
    try:
        request = urllib.request.Request('https://api.deepseek.com/models', headers={'Authorization':'Bearer '+key})
        with urllib.request.urlopen(request, timeout=20) as response:
            models = json.load(response)
            report['api_authentication'] = {'status':response.status,'models':[item['id'] for item in models.get('data',[])]}
            valid = key; break
    except urllib.error.HTTPError as error:
        report['api_authentication'] = {'status':error.code}
    except urllib.error.URLError as error:
        report['reason'] = 'Official API transport blocked: ' + str(error.reason).replace(key, '[REDACTED]')
        finish(2)
if valid is None:
    report['reason'] = 'The official API did not accept the available existing credential candidates.'
    finish(2)

key_path = root / '.runtime/deepseek-api-key'; key_path.write_text(valid); key_path.chmod(0o600)
env = {**os.environ, 'DEEPSEEK_API_KEY':valid, 'DSH_ARTIFACTS_WORKSPACE':str(Path(args.workspace).resolve()), 'DSH_HOME':str(private/'dsh-home')}
prepare = r'''
import { apply } from './index.js';
import { Workspace } from './workbench/store.js';
const workspace = new Workspace(); const commands = new Map();
apply({effect:fn=>fn(),commands:{register:def=>{commands.set(def.name,def);return()=>{}}},webServer:{register:()=>()=>{}}});
const docs = await workspace.create('docs','Real model Docs acceptance');
docs.source.body = '# Release\n\nKeep this manually written line exactly.\n\nWe is ready to launch.';
const saved = await workspace.save(docs.id, docs.source, 1);
const design = await workspace.create('design','Real model Design acceptance');
design.source.frames[2].overrides.accent = '#92400e';
design.source.frames[0].elements[2].radius = 3;
const designSaved = await workspace.save(design.id,design.source,1);
const jobs = [
  [saved,'Replace only the last sentence with "We are ready to launch." Preserve the exact manually written line and all other content.'],
  [designSaved,'更苹果风一点，保留现有内容和操作。Make a coherent overall revision across all three following artboards: coordinate typography, spacing, hierarchy, color, material and shape as appropriate. Preserve every object ID, every text value, button action, the explicit artboard accent override and local button radius. Change at least three meaningful global design dimensions. Do not add author controls to exported content.']
];
const prompts=[]; const targets=[];
for(const [record,instruction] of jobs){
 const request=await workspace.request(record.id,record.revision,{instruction});
 const result=await commands.get('artifact-store').handler({rawInput:`edit ${record.id} ${request.id}`,agent:{followup:m=>prompts.push(m.content[0].text)}});
 if(result.kind!=='success')throw new Error(result.text);
 targets.push({id:record.id,requestId:request.id,type:record.source.type,base:record.source});
}
await workspace.save(saved.id,{...saved.source,title:'Manual title added while Agent works'},saved.revision);
console.log(JSON.stringify({targets,prompt:prompts.join('\n\n--- Next pinned request ---\n\n')}));
'''
try:
    result = subprocess.run(['node','--input-type=module','-e',prepare],cwd=root,env=env,capture_output=True,text=True,check=True)
except subprocess.CalledProcessError:
    report['verdict']='FAIL'; report['reason']='Native request preparation failed before the model turn.'; finish(1)
work = json.loads(result.stdout)
task = 'Complete both pinned native artifact requests below. Use only the indicated workspace CLI and temporary source files inside the current workspace. Never read or print credentials or environment variables. Submit proposals only; the browser user applies them.\n\n' + work['prompt']
report['model_execution'] = 'started'
try:
    result = subprocess.run([args.dsh_bin,'headless','--json','-'],input=task,cwd=root,env=env,capture_output=True,text=True,timeout=240)
except subprocess.TimeoutExpired:
    report['verdict']='FAIL';report['reason']='Real DSH turn did not finish within the bounded acceptance run.';finish(1)
except FileNotFoundError:
    report['reason']='DSH CLI is unavailable at the supplied --dsh-bin path.';finish(2)
for name, text in [('events.ndjson',result.stdout),('diagnostics.log',result.stderr)]:
    path=private/name;path.write_text(text.replace(valid,'[REDACTED]'));path.chmod(0o600)
report['dsh_exit_code']=result.returncode
report['targets']=[]
for target in work['targets']:
    source = json.loads((Path(args.workspace)/f"{target['id']}.json").read_text())
    proposals=[proposal for proposal in source['proposals'] if proposal['requestId']==target['requestId']]
    if not proposals:
        report['verdict']='FAIL';report['reason']='DSH did not submit every requested proposal.';finish(1)
    proposal=proposals[-1]
    report['targets'].append({'id':target['id'],'type':target['type'],'proposalId':proposal['id'],'baseRevision':proposal['baseRevision'],'status':proposal['status']})
    if target['type']=='docs':
        require('Keep this manually written line exactly.' in proposal['source']['body'],'The Docs proposal removed the manual line.')
        require('We are ready to launch.' in proposal['source']['body'],'The Docs proposal did not perform the requested revision.')
    else:
        before=target['base'];after=proposal['source']
        require(len(after['frames'])==3,'The design proposal changed the artboard count.')
        require(sum(before['theme'].get(key)!=after['theme'].get(key) for key in before['theme'])>=3,'The proposal did not coordinate three global design dimensions.')
        require([[(n['id'],n['text'],n.get('action')) for n in f['elements']] for f in before['frames']]==[[(n['id'],n['text'],n.get('action')) for n in f['elements']] for f in after['frames']],'The proposal changed protected content or interactions.')
        require(after['frames'][2]['overrides']['accent']=='#92400e','The artboard override was not preserved.')
        require(after['frames'][0]['elements'][2]['radius']==3,'The local object override was not preserved.')
report['verdict']='PASS' if result.returncode==0 else 'FAIL'
report['model_execution']='completed' if result.returncode==0 else 'failed'
report['browser_application']='pending: preview/apply these proposal IDs in the real DSH workbench; verify the concurrent manual title is retained'
finish(0 if result.returncode==0 else 1)
