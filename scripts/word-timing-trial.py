"""One-minute offline experiment; never connects to or changes a running server."""
import argparse
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import time
import wave

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def stamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'

def main():
    p = argparse.ArgumentParser()
    for key in ('source', 'model', 'ffmpeg', 'output'):
        p.add_argument('--' + key, required=True)
    a = p.parse_args()
    out = Path(a.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    source = Path(a.source).resolve()
    model_path = Path(a.model).resolve()
    audio = out / 'source-60s.wav'
    start = time.perf_counter()
    subprocess.run([a.ffmpeg, '-hide_banner', '-nostdin', '-v', 'error', '-ss', '0', '-i', str(source),
                    '-t', '60', '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(audio)], check=True)
    preparation = time.perf_counter() - start
    import numpy as np
    from faster_whisper import WhisperModel
    with wave.open(str(audio)) as wav:
        assert (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) == (1, 16000, 2)
        pcm = wav.readframes(wav.getnframes())
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    assert len(samples) == 60 * 16000, 'Input is not exactly one minute'
    windows = samples.reshape(-1, 320)
    waveform = {'step': .02, 'rms': np.sqrt(np.mean(windows ** 2, axis=1)).round(6).tolist(),
                'min': windows.min(axis=1).round(6).tolist(), 'max': windows.max(axis=1).round(6).tolist()}
    write_json(out / 'waveform.json', waveform)
    start = time.perf_counter()
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', local_files_only=True)
    load_seconds = time.perf_counter() - start
    options = dict(language='ja', task='transcribe', beam_size=5, vad_filter=True)
    start = time.perf_counter()
    warm, _ = model.transcribe(samples[:5*16000], **options)
    list(warm)
    warm_seconds = time.perf_counter() - start
    result = {'schemaVersion': 1, 'date': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
              'machine': {'name': platform.node(), 'platform': platform.platform(), 'logicalProcessors': os.cpu_count()},
              'source': {'path': str(source), 'sha256': hashlib.file_digest(source.open('rb'), 'sha256').hexdigest(),
                         'fromSeconds': 0, 'toSeconds': 60, 'audioSha256': hashlib.sha256(audio.read_bytes()).hexdigest(),
                         'pcmSha256': hashlib.sha256(pcm).hexdigest()},
              'engine': {'name': 'faster-whisper', 'version': importlib.metadata.version('faster-whisper'),
                         'ctranslate2': importlib.metadata.version('ctranslate2'), 'python': platform.python_version(),
                         'model': 'base', 'modelPath': str(model_path), 'revision': model_path.name,
                         'device': 'cpu', 'computeType': 'int8', 'cpuThreads': 'runtime default (cpu_threads=0)', 'options': options},
              'audioPreparationSeconds': preparation, 'modelLoadSeconds': load_seconds, 'warmupSeconds': warm_seconds,
              'runs': [], 'accuracyReference': 'No manually annotated word boundaries; timing differences are not ground-truth errors.'}
    for index, enabled in enumerate((False, True, True, False)):
        print(json.dumps({'event': 'start', 'run': index+1, 'wordTimestamps': enabled}), flush=True)
        start = time.perf_counter()
        stream, info = model.transcribe(str(audio), word_timestamps=enabled, **options)
        segments = [asdict(s) for s in stream]
        elapsed = time.perf_counter() - start
        mode = 'word-times' if enabled else 'proportional'
        basename = f'第2回AI勉強会-20261109_先頭1分__this-PC__faster-whisper-base-CPU__{mode}__run{index+1}'
        valid = [s for s in segments if s['end'] > s['start'] and s['text'].strip()]
        vtt = 'WEBVTT\n\n' + '\n\n'.join(f'{i+1}\n{stamp(s["start"])} --> {stamp(s["end"])}\n{s["text"].strip()}' for i,s in enumerate(valid)) + '\n'
        (out / (basename + '.vtt')).write_text(vtt, encoding='utf-8')
        record = {'index': index+1, 'wordTimestamps': enabled, 'recognitionSeconds': elapsed,
                  'realTimeFactor': elapsed/60, 'durationAfterVad': info.duration_after_vad,
                  'segments': segments, 'vttFile': basename + '.vtt', 'jsonFile': basename + '.json'}
        write_json(out / record['jsonFile'], record)
        result['runs'].append(record)
        write_json(out / 'results.json', result)
        print(json.dumps({'event': 'complete', 'run': index+1, 'seconds': elapsed, 'segments': len(segments),
                          'words': sum(len(s['words'] or []) for s in segments)}), flush=True)
    print(str(out), flush=True)

if __name__ == '__main__':
    main()
