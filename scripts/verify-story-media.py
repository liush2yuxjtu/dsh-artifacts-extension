import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--report', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
base = root / 'docs/media/story-20261111'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)]))


bindings = read(base / 'verify/cold-viewer-bindings.json')
review_path = base / 'verify/cold-viewer-review.json'
assert digest(review_path) == bindings['review_sha256'], 'Independent response bytes changed'
reviews = {item['file']: item for item in read(review_path)['reviews']}
assert len(bindings['bindings']) == 4 and len(reviews) == 4
for item in bindings['bindings']:
    assert digest(base / item['media_file']) == item['sha256'], 'Reviewed sheet bytes changed'
    assert reviews[item['reviewed_file']]['verdict'] == 'PASS'

results = []
hash_count = 0
for locale, readme_name, cta in [('en', 'README.md', '#install-in-a-dsh-web-profile'), ('zh', 'README.zh-CN.md', '#安装')]:
    folder = base / locale
    manifest = read(folder / 'manifest.json')
    record = read(folder / 'recording.json')
    assert manifest['status'] == 'verified-local-story'
    assert manifest['source_environment'] == 'repository-build'
    assert manifest['locale'] == record['locale'] == locale
    assert manifest['model_calls'] == record['modelCalls'] == 0
    assert record['apiReceipts'] == []
    assert record['realProductUI'] is True and record['mockedRoutes'] is False
    assert record['pageErrors'] == []
    runtime_recheck = read(base / 'verify' / f'runtime-recheck-{locale}.json')
    assert runtime_recheck['status'] == 'PASS'
    assert runtime_recheck['pageErrors'] == [] and runtime_recheck['consoleErrors'] == []
    assert runtime_recheck['modelCalls'] == 0
    assert manifest['source'] == record['source']
    for relative, expected in manifest['hashes'].items():
        path = (folder / relative).resolve()
        assert path.is_relative_to(folder), 'Media path escapes its locale'
        assert digest(path) == expected, f'Hash changed: {locale}/{relative}'
        hash_count += 1
    for relative, expected in record['source']['pluginHashes'].items():
        assert digest(root / relative) == expected, f'Recorded plugin source changed: {relative}'
    assert digest(folder / 'raw/gt.mp4') == record['raw_sha256'] == manifest['raw_sha256']
    mp4, raw, gif = [probe(folder / name) for name in ['story.mp4', 'raw/gt.mp4', 'feature-8s.gif']]
    assert mp4['streams'][0]['codec_name'] == 'h264'
    assert mp4['streams'][0]['pix_fmt'] == 'yuv420p'
    assert abs(float(mp4['format']['duration']) - float(raw['format']['duration'])) < .1
    assert manifest['story']['editorial_cuts'] == [] and manifest['story']['playback_speed'] == 1
    assert gif['streams'][0]['codec_name'] == 'gif' and gif['streams'][0]['width'] == 960
    assert abs(float(gif['format']['duration']) - 8) < .15
    assert int(gif['streams'][0]['nb_frames']) >= 90
    excerpt = manifest['gif']
    assert excerpt['continuous'] is True and excerpt['start_s'] == .8 and excerpt['duration_s'] == 8
    start, end = excerpt['start_s'], excerpt['start_s'] + excerpt['duration_s']
    assert 0 <= start < end <= float(raw['format']['duration'])
    readable_hold = end - max(start, record['proof_interval_s'][0])
    assert readable_hold >= 3 and abs(readable_hold - manifest['result_readable_hold_s']) < .01
    crop = excerpt['crop_source_pixels']
    assert crop['x'] >= 0 and crop['y'] >= 0
    assert crop['x'] + crop['width'] <= raw['streams'][0]['width']
    assert crop['y'] + crop['height'] <= raw['streams'][0]['height']
    discovery = read(folder / 'discovery.json')
    if locale == 'en':
        assert 'Release checklist' in discovery['uiText'] and not re.search(r'[\u3400-\u9fff]', discovery['uiText'])
    else:
        assert '发布检查清单' in discovery['uiText'] and '工件' in discovery['uiText']
    assert manifest['cold_viewer']['status'] == 'PASS'
    readme = (root / readme_name).read_text()
    media_path = f'docs/media/story-20261111/{locale}/feature-8s.gif'
    video_path = f'docs/media/story-20261111/{locale}/story.mp4'
    lines = readme.splitlines()
    index = next(i for i, line in enumerate(lines) if f']({media_path})' in line)
    assert index < 25 and f']({video_path})' in lines[index]
    following = next(line for line in lines[index + 1:] if line.strip())
    assert f']({cta})' in following, 'Installation link must immediately follow preview'
    assert '960' in readme
    results.append({'locale': locale, 'status': 'PASS', 'duration_s': float(mp4['format']['duration']),
                    'gif_duration_s': float(gif['format']['duration']), 'gif_width': 960,
                    'gif_bytes': (folder / 'feature-8s.gif').stat().st_size, 'result_hold_s': readable_hold,
                    'raw_sha256': digest(folder / 'raw/gt.mp4'), 'manifest_sha256': digest(folder / 'manifest.json'),
                    'readme': readme_name, 'readme_sha256': digest(root / readme_name)})

report = {'status': 'PASS', 'at': datetime.now(timezone.utc).isoformat(), 'scope': 'Local story artifacts, independent-review hash bindings and README-to-install links',
          'locales': results, 'media_hashes_checked': hash_count, 'independent_reviews': 4, 'model_calls': 0,
          'public_delivery': 'PENDING: verify remote bytes and rendered README after publication',
          'conversion_lift': 'NOT_MEASURED'}
if args.report:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
