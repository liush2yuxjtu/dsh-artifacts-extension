import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('recording_root', type=Path)
parser.add_argument('output_root', type=Path)
args = parser.parse_args()


def run(*command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


for locale in ['en', 'zh']:
    src = args.recording_root / locale
    dest = args.output_root / locale
    dest.mkdir(parents=True, exist_ok=False)
    (dest / 'raw').mkdir()
    (dest / 'frames').mkdir()
    record = json.loads((src / 'recording.json').read_text())
    assert record['modelCalls'] == 0 and record['realProductUI'] is True
    for name in ['recording.json', 'discovery.json', 'rehearsal.json', 'markers.json', 'result.png', 'preflight.png']:
        shutil.copyfile(src / name, dest / name)
    for name in ['gt.mp4', 'frames.json', 'capture.ffconcat']:
        shutil.copyfile(src / 'raw' / name, dest / 'raw' / name)
    raw = dest / 'raw/gt.mp4'
    assert digest(raw) == record['raw_sha256']
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-i', str(raw), '-vf', 'scale=1280:800,format=yuv420p', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(dest / 'story.mp4'))
    start = 0.8
    width = 960
    source_probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(raw)]))['streams'][0]
    pixel_scale = source_probe['width'] / 1280
    crop = {'x': round(280 * pixel_scale), 'y': 0, 'width': round(1000 * pixel_scale), 'height': source_probe['height']}
    video_filter = f'crop={crop["width"]}:{crop["height"]}:{crop["x"]}:{crop["y"]},fps=12,scale={width}:-1:flags=lanczos'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-ss', str(start), '-t', '8', '-i', str(raw), '-filter_complex', video_filter + ',split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0', str(dest / 'feature-8s.gif'))
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-ss', str(record['proof_interval_s'][0] + 1), '-i', str(dest / 'story.mp4'), '-frames:v', '1', str(dest / 'poster.png'))
    duration = float(json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(dest / 'story.mp4')]))['format']['duration'])
    for i in range(16):
        time = duration * i / 16
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-ss', str(time), '-i', str(dest / 'story.mp4'), '-frames:v', '1', str(dest / 'frames' / f'{i:02}.png'))
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-i', str(dest / 'frames/%02d.png'), '-vf', 'scale=640:400,tile=4x4', '-frames:v', '1', str(dest / 'contact-sheet.png'))
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-i', str(dest / 'feature-8s.gif'), '-vf', 'fps=2,scale=480:384,tile=4x4', '-frames:v', '1', str(dest / 'gif-contact-sheet.png'))
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(dest / 'story.mp4')]))
    gif_probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(dest / 'feature-8s.gif')]))
    assert probe['streams'][0]['codec_name'] == 'h264'
    assert probe['streams'][0]['pix_fmt'] == 'yuv420p'
    assert abs(float(gif_probe['format']['duration']) - 8) < .15
    proof_end = min(start + 8, record['captured']['duration_s'])
    proof_hold = proof_end - max(start, record['proof_interval_s'][0])
    assert proof_hold >= 3
    files = [p for p in dest.rglob('*') if p.is_file()]
    manifest = {'schemaVersion': 1, 'status': 'needs-independent-cold-viewer', 'locale': locale,
                'source': record['source'], 'source_environment': 'repository-build', 'sample_data_origin': 'Manually prepared saved HTML files in a temporary local demonstration store. The same files are served by the unchanged plugin routes.',
                'scope': record['scope'], 'model_calls': 0, 'new_api_calls': False, 'no_mocked_routes': True, 'no_generated_product_frames': True,
                'recording_host': record['runtime'], 'raw_sha256': digest(raw),
                'story': {'path': 'story.mp4', 'duration_s': duration, 'editorial_cuts': [], 'playback_speed': 1, 'audio': False},
                'gif': {'path': 'feature-8s.gif', 'start_s': start, 'duration_s': 8, 'width': width, 'crop_source_pixels': crop, 'fps': 12, 'continuous': True},
                'result_readable_hold_s': proof_hold,
                'hashes': {str(p.relative_to(dest)): digest(p) for p in files},
                'limitations': ['This demonstrates browsing and reusing saved files, not AI creation, store synchronization, or tweak generation.', 'The local source build is not a new production release.', 'Independent silent comprehension and public README delivery remain pending.']}
    (dest / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (dest / 'probe.json').write_text(json.dumps({'mp4': probe, 'gif': gif_probe}, indent=2) + '\n')
    print(locale, 'duration', duration, 'result_hold', proof_hold, 'gif_bytes', (dest / 'feature-8s.gif').stat().st_size)
