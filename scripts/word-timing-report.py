"""Build an inspectable report from completed word-timing-trial outputs."""
import argparse
import json
from pathlib import Path
import statistics
import wave
import numpy as np

def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

def find_range(run, text, aligned, anchor=None):
    matches = []
    for s in run['segments']:
        source = s['text'].strip()
        if anchor and anchor not in source:
            continue
        if text not in source:
            continue
        begin = source.index(text)
        finish = begin + len(text)
        if not aligned:
            start = round(s['start'] * 1000) + round((round(s['end']*1000)-round(s['start']*1000)) * begin / len(source))
            end = round(s['start'] * 1000) + round((round(s['end']*1000)-round(s['start']*1000)) * finish / len(source))
            matches.append({'start': start/1000, 'end': end/1000, 'units': [], 'interpolated': True})
        else:
            # Match exact returned characters; do not invent correspondence after text edits.
            joined = ''.join(w['word'] for w in s['words'])
            if source not in joined:
                continue
            shift = joined.index(source)
            left, right = begin+shift, finish+shift
            pos, units, selected = 0, [], []
            for w in s['words']:
                endpos = pos + len(w['word'])
                content_start = pos + len(w['word']) - len(w['word'].lstrip())
                content_end = endpos - len(w['word']) + len(w['word'].rstrip())
                content_length = content_end - content_start
                if content_length and max(content_start, left) < min(content_end, right):
                    units.append(w)
                    start_fraction = max(0, left-content_start)/content_length
                    end_fraction = min(content_length, right-content_start)/content_length
                    selected.append((w['start']+(w['end']-w['start'])*start_fraction,
                                     w['start']+(w['end']-w['start'])*end_fraction,
                                     start_fraction != 0 or end_fraction != 1))
                pos = endpos
            if selected:
                matches.append({'start': selected[0][0], 'end': selected[-1][1], 'units': units,
                                'interpolated': any(x[2] for x in selected)})
    return matches[0] if len(matches) == 1 else None

def main():
    p = argparse.ArgumentParser()
    p.add_argument('root')
    a = p.parse_args()
    root = Path(a.root).resolve()
    r = json.loads((root/'results.json').read_text(encoding='utf-8'))
    assert len(r['runs']) == 4
    off, on = r['runs'][0], r['runs'][1]
    with wave.open(str(root/'source-60s.wav')) as f:
        pcm = f.readframes(f.getnframes())
    samples = np.frombuffer(pcm, dtype='<i2')
    clips = root/'clips'
    clips.mkdir(exist_ok=True)
    def output(name, sections):
        result = np.concatenate([samples[round(s*16000):round(e*16000)] for s,e in sections])
        with wave.open(str(clips/name), 'wb') as f:
            f.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            f.writeframes(result.tobytes())
        with wave.open(str(clips/name)) as f:
            assert f.getnframes() == len(result)
        return {'file':'clips/'+name, 'seconds':len(result)/16000}
    cases = []
    for index, text in enumerate(('コーディング', '情報資源', 'これで', 'んま', '行く', 'ありがとうございます', 'ちゃんと', '私は知っていない')):
        anchor = {'んま':'あんまり', 'ちゃんと':'僕はちゃんと'}.get(text)
        before, after = find_range(off,text,False,anchor), find_range(on,text,True,anchor)
        if not before or not after:
            continue
        context = (max(0, min(before['start'],after['start'])-1), min(60,max(before['end'],after['end'])+1))
        c = {'id':index, 'text':text, 'anchor':anchor, 'before':before, 'after':after, 'context':context}
        for key in ('before','after'):
            v = c[key]
            v['clip'] = output(f'{index}-{key}-selected.wav', [(v['start'],v['end'])])
            v['joined'] = output(f'{index}-{key}-after-cut.wav', [(max(0,v['start']-2),v['start']),(v['end'],min(60,v['end']+2))])
            selected = samples[round(v['start']*16000):round(v['end']*16000)].astype(np.float32)/32768
            blocks = selected[:len(selected)//320*320].reshape(-1,320)
            v['lowEnergyFraction'] = float(np.mean(np.sqrt(np.mean(blocks**2,axis=1)) < .01)) if len(blocks) else None
            v['duration'] = v['end']-v['start']
        c['boundaryShiftMs'] = {'start':round((after['start']-before['start'])*1000),'end':round((after['end']-before['end'])*1000)}
        cases.append(c)
    flat = lambda run: ''.join(s['text'].strip() for s in run['segments'])
    summaries = []
    for run in r['runs']:
        words = [w for s in run['segments'] for w in s['words'] or []]
        summaries.append({k:v for k,v in run.items() if k!='segments'} | {
            'segmentCount':len(run['segments']), 'unitCount':len(words),
            'temperatures':[s['temperature'] for s in run['segments']],
            'zeroLengthUnits':[w for w in words if w['end']<=w['start']],
            'overTwoSeconds':[w for w in words if w['end']-w['start']>2], 'text':flat(run)})
    means = {key:statistics.mean(run['recognitionSeconds'] for run in r['runs'] if run['wordTimestamps']==mode)
             for key, mode in [('off',False),('on',True)]}
    report = {'means':means, 'ratio':means['on']/means['off'], 'runs':summaries, 'cases':cases,
              'baselineRepeatSame':flat(r['runs'][0])==flat(r['runs'][3]),
              'alignedRepeatSame':flat(r['runs'][1])==flat(r['runs'][2]),
              'optionsChangeText':flat(off)!=flat(on), 'source':r['source'], 'engine':r['engine'],
              'modelLoadSeconds':r['modelLoadSeconds'], 'audioPreparationSeconds':r['audioPreparationSeconds'],
              'warmupSeconds':r['warmupSeconds'],
              'accuracyLimit':'人手による正解境界は未注釈。時刻差は誤差・改善率ではありません。切り出しと前後接続の音声を同じ原音で比較します。'}
    save(root/'report.json', report)
    text = ['# Whisper Base単語時刻の限定比較（2026-11-14）', '',
            '対象：指定動画の先頭0〜60秒。同PC / faster-whisper 1.2.1 / CPU int8 / 日本語 / beam=5 / VADあり。',
            '既存サーバーを更新・操作せず、導入済みエンジンとモデルを独立プロセスで使用。正式APIへの組込は未実施。', '',
            f'認識平均：単語時刻なし {means["off"]:.3f}秒、あり {means["on"]:.3f}秒、{report["ratio"]:.2f}倍。',
            f'音声準備 {r["audioPreparationSeconds"]:.3f}秒、モデルロード {r["modelLoadSeconds"]:.3f}秒、5秒ウォームアップ {r["warmupSeconds"]:.3f}秒を別計測。',
            '測定順はなし→あり→あり→なし。全4回であり、他のモデルや区間には一般化しない。', '',
            '| 回 | 単語時刻 | 認識秒 | 字幕数 | 時刻単位数 | ゼロ長 |', '|---|---|---:|---:|---:|---:|']
    for s in summaries:
        text.append(f'| {s["index"]} | {"あり" if s["wordTimestamps"] else "なし"} | {s["recognitionSeconds"]:.3f} | {s["segmentCount"]} | {s["unitCount"]} | {len(s["zeroLengthUnits"])} |')
    text += ['', '## カット境界', '', report['accuracyLimit'], '',
             '| 選択文字 | 文字数按分（秒） | 単語時刻（秒） | 単位内の按分 |', '|---|---|---|---|']
    for c in cases:
        text.append(f'| {c["text"]} | {c["before"]["start"]:.3f}–{c["before"]["end"]:.3f} | {c["after"]["start"]:.3f}–{c["after"]["end"]:.3f} | {"あり" if c["after"]["interpolated"] else "なし"} |')
    text += ['', '## 判明した限界と判断', '',
             '- 単語時刻なしの2回は本文一致。ありの2回は末尾に違いがあり、2回目には「今」の反復が出た。',
             '- 単語時刻の有無で認識本文・字幕分割も変化する。時刻のみの追加とみなして原文を上書きしてはいけない。',
             '- 単語時刻なしは全字幕temperature=0。ありでは末尾2字幕がtemperature=1へフォールバックしていた。ライブラリーでは0を超えるとサンプリングするため、再実行差の要因となる。単語時刻使用時は次の読取開始位置も変わる実装であり、認識結果の変化をクライアントのVTT変換によるものと混同しない。',
             '- 最初のあり実行では138単位中3単位がゼロ長。日本語は単語より細かい断片もあり、「ありがとうございます」は1単位なので文字の途中はなお按分。',
             '- 「これ」は6.970〜9.330秒に広がり、語の前後の空白を含み得る。返却値をそのまま確定カットへ使わない。',
             '- 音声切り出しとカット後の接続は実PCMから生成。波形の低音量率は無音・正解発話の判定ではない。正解境界への絶対誤差は未測定。',
             '- 「ちゃんと」の文字数按分39.240〜40.380秒は20ms窓すべてが-40dBFS未満。単語時刻40.900〜41.080秒は全窓が同閾値以上。「これで」は逆に単語時刻側の低音量率が約72%で、すべての箇所が改善するわけではない。語の正誤を判定する指標ではなく、範囲外れ・空白混入の手掛かりに限る。',
             '- 今回は既存VTTを維持したまま一致する文字列だけへ時刻候補を添える方法、無効・不一致部分は推定へ戻す方法を推奨。自動確定でなく試聴・境界調整を残す。',
             '- 初回試行はJSON保存時の型変換不備で中断。修正後のcompleteフォルダーに4回を測り直して保存し、中断回を集計から除外した。', '',
             '## 空白の映像変化点分割について', '',
             '現状は1秒ごとの縮小画像差分を区間全体の「変化あり／小」へ集約しており、変化点での区間分割は未実装。',
             '次のUIは全行の時刻に再生・映像確認をそろえ、空白には「映像変化で分割」を置く。連続する差分をまとめて分割候補にし、必要なら候補周辺を細かく再走査する。カットは分割と別に明示選択する。今回の単語時刻試行では製品画面は変更していない。', '',
             '## 再現用データ', '', 'results.json / report.json / waveform.json / 4回分のVTTとJSON / clips内の16比較音声と16接続音声。',
             f'元動画SHA-256: `{r["source"]["sha256"]}`', f'入力PCM SHA-256: `{r["source"]["pcmSha256"]}`']
    (root/'比較レポート.md').write_text('\n'.join(text)+'\n',encoding='utf-8')
    print(json.dumps({'cases':len(cases),'means':means,'ratio':report['ratio'],'baselineRepeatSame':report['baselineRepeatSame'],'alignedRepeatSame':report['alignedRepeatSame']}))

if __name__ == '__main__':
    main()
