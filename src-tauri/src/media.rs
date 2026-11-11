use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct Range {
    pub start: f64,
    pub end: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Media {
    pub path: String,
    pub duration: f64,
    pub audio: bool,
    pub width: u64,
    pub height: u64,
}

pub fn local_path(value: &str) -> Result<PathBuf> {
    if value.starts_with("\\\\") || value.starts_with("//") {
        return Err("この版ではPC内のファイルを選択してください。".into());
    }
    let path = std::fs::canonicalize(value).map_err(|e| format!("パスを開けません: {e}"))?;
    Ok(path)
}
pub fn tool(name: &str) -> Result<PathBuf> {
    let exe = format!("{name}.exe");
    if let Ok(own) = std::env::current_exe() {
        if let Some(dir) = own.parent() {
            for path in [dir.join("bin").join(&exe), dir.join(&exe)] {
                if path.is_file() {
                    return Ok(path);
                }
            }
        }
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let path = dir.join(&exe);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let packages = PathBuf::from(local).join("Microsoft/WinGet/Packages");
        if let Ok(entries) = std::fs::read_dir(packages) {
            for entry in entries
                .flatten()
                .filter(|x| x.file_name().to_string_lossy().starts_with("Gyan.FFmpeg_"))
            {
                if let Ok(builds) = std::fs::read_dir(entry.path()) {
                    for build in builds.flatten() {
                        let path = build.path().join("bin").join(&exe);
                        if path.is_file() {
                            return Ok(path);
                        }
                    }
                }
            }
        }
    }
    Err(format!(
        "{exe}が見つかりません。FFmpegを導入するかEXE隣のbinへ配置してください。"
    ))
}
pub fn command(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}
pub fn probe(path: &Path) -> Result<Media> {
    let out = command(&tool("ffprobe")?)
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("動画情報を読み取れません。対応する動画を選択してください。".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let streams = value["streams"]
        .as_array()
        .ok_or("動画ストリームがありません。")?;
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or("動画ストリームがありません。")?;
    let duration: f64 = value["format"]["duration"]
        .as_str()
        .unwrap_or("")
        .parse()
        .map_err(|_| "動画の長さが不明です。")?;
    if !duration.is_finite() || duration <= 0.0 {
        return Err("動画の長さが不正です。".into());
    }
    Ok(Media {
        path: path.to_string_lossy().into(),
        duration,
        audio: streams.iter().any(|s| s["codec_type"] == "audio"),
        width: video["width"].as_u64().unwrap_or(0),
        height: video["height"].as_u64().unwrap_or(0),
    })
}
pub fn ranges(input: &[Range], duration: f64, remove: bool) -> Result<Vec<Range>> {
    if !duration.is_finite() || duration <= 0.0 || input.is_empty() || input.len() > 200 {
        return Err("1〜200個の範囲を指定してください。".into());
    }
    let mut list = input.to_vec();
    for r in &list {
        if !r.start.is_finite()
            || !r.end.is_finite()
            || r.start < 0.0
            || r.end > duration + 0.001
            || r.end - r.start < 0.02
        {
            return Err("範囲は動画内で、開始より終了を後にしてください（最小0.02秒）。".into());
        }
    }
    list.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut merged: Vec<Range> = Vec::new();
    for r in list {
        if let Some(last) = merged.last_mut() {
            if r.start <= last.end + 0.001 {
                last.end = last.end.max(r.end).min(duration);
                continue;
            }
        }
        merged.push(Range {
            start: r.start,
            end: r.end.min(duration),
        });
    }
    if !remove {
        return Ok(merged);
    }
    let mut kept = Vec::new();
    let mut cursor = 0.0;
    for r in merged {
        if r.start - cursor >= 0.02 {
            kept.push(Range {
                start: cursor,
                end: r.start,
            });
        }
        cursor = r.end;
    }
    if duration - cursor >= 0.02 {
        kept.push(Range {
            start: cursor,
            end: duration,
        });
    }
    if kept.is_empty() {
        return Err("動画がすべて削除される範囲です。".into());
    }
    Ok(kept)
}
pub fn output_path(dir: &str, name: &str, extension: &str) -> Result<PathBuf> {
    let dir = local_path(dir)?;
    if !dir.is_dir() {
        return Err("保存先フォルダーを選択してください。".into());
    }
    if name.is_empty()
        || name.len() > 180
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || name.ends_with([' ', '.'])
        || name.starts_with('.')
    {
        return Err("保存名を確認してください。".into());
    }
    let path = dir.join(format!("{name}.{extension}"));
    if path.exists() {
        return Err("同名ファイルがあります。別の保存名を指定してください。".into());
    }
    Ok(path)
}
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("保存先が不正です。")?)
        .map_err(|e| e.to_string())?;
    tmp.write_all(bytes).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist_noclobber(path)
        .map_err(|e| format!("保存できません（既存ファイルは保持）: {e}"))?;
    Ok(())
}
pub fn cut(
    media: &Media,
    kept: &[Range],
    output: &Path,
    cancel: Arc<AtomicBool>,
    progress: impl Fn(f64),
) -> Result<()> {
    let temp = tempfile::Builder::new()
        .prefix("transcriptcutter-")
        .tempdir_in(output.parent().ok_or("保存先が不正です。")?)
        .map_err(|e| e.to_string())?;
    let ffmpeg = tool("ffmpeg")?;
    let total: f64 = kept.iter().map(|r| r.end - r.start).sum();
    // Remap each original frame onto the kept timeline. Concatenating separately
    // rounded video clips accumulates a frame of drift at every short range.
    let select = kept
        .iter()
        .map(|r| format!("gte(t,{})*lt(t,{})", r.start, r.end))
        .collect::<Vec<_>>()
        .join("+");
    let mut previous = 0.0;
    let gaps = kept
        .iter()
        .map(|r| {
            let gap = r.start - previous;
            previous = r.end;
            format!("if(gte(PTS*TB,{}),{gap},0)", r.start)
        })
        .collect::<Vec<_>>()
        .join("+");
    let mut graph = format!("[0:v:0]select='{select}',setpts='PTS-({gaps})/TB',scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[v]");
    if media.audio {
        graph.push_str(";\n");
    }
    let mut pads = String::new();
    for (i, r) in kept.iter().enumerate() {
        let length = r.end - r.start;
        if media.audio {
            graph.push_str(&format!("[0:a:0]atrim=start={}:end={},asetpts=PTS-STARTPTS,apad=whole_dur={length},atrim=duration={length}[a{i}];\n",r.start,r.end));
            pads.push_str(&format!("[a{i}]"));
        }
    }
    if media.audio {
        graph.push_str(&format!("{pads}concat=n={}:v=0:a=1[a]", kept.len()));
    }
    let script = temp.path().join("cut-filter.txt");
    std::fs::write(&script, graph).map_err(|e| e.to_string())?;
    let progress_path = temp.path().join("progress.txt");
    let joined = temp.path().join("joined.mp4");
    let mut cmd = command(&ffmpeg);
    cmd.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(&media.path)
        .arg("-filter_complex_script")
        .arg(&script)
        .args(["-map", "[v]"]);
    if media.audio {
        cmd.args(["-map", "[a]"]);
    }
    cmd.args([
        "-sn",
        "-dn",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-fps_mode",
        "vfr",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-progress",
    ])
    .arg(&progress_path)
    .arg("-n")
    .arg(&joined);
    run_with_tick(&mut cmd, cancel.clone(), || {
        if let Ok(text) = std::fs::read_to_string(&progress_path) {
            if let Some(us) = text.lines().rev().find_map(|l| {
                l.strip_prefix("out_time_us=")
                    .and_then(|s| s.parse::<f64>().ok())
            }) {
                progress((us / 1_000_000.0 / total * 95.0).clamp(0.0, 95.0));
            }
        }
    })?;
    if cancel.load(Ordering::SeqCst) {
        return Err("書き出しを中止しました。".into());
    }
    let checked = probe(&joined)?;
    if (checked.duration - total).abs() > 0.2 || (media.audio && !checked.audio) {
        return Err("書き出し動画の時間または音声を検証できません。".into());
    }
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&joined)
        .map_err(|e| e.to_string())?
        .sync_all()
        .map_err(|e| e.to_string())?;
    if cancel.load(Ordering::SeqCst) {
        return Err("書き出しを中止しました。".into());
    }
    tempfile::TempPath::try_from_path(joined)
        .map_err(|e| e.to_string())?
        .persist_noclobber(output)
        .map_err(|e| format!("保存できません（既存ファイルは保持）: {e}"))?;
    progress(100.0);
    Ok(())
}
#[cfg(test)]
fn run(cmd: &mut Command, cancel: Arc<AtomicBool>) -> Result<()> {
    run_with_tick(cmd, cancel, || {})
}
fn run_with_tick(cmd: &mut Command, cancel: Arc<AtomicBool>, tick: impl Fn()) -> Result<()> {
    if cancel.load(Ordering::SeqCst) {
        return Err("書き出しを中止しました。".into());
    }
    let mut child = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stderr = child.stderr.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut tail = Vec::new();
        let mut buf = [0; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            tail.extend_from_slice(&buf[..n]);
            if tail.len() > 16384 {
                tail.drain(..tail.len() - 16384);
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    });
    loop {
        tick();
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("書き出しを中止しました。".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let error = reader.join().unwrap_or_default();
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!("FFmpegエラー: {error}"))
                };
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(e.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn running_process_cancellation() {
        if std::env::var_os("TC_MEDIA_TEST").is_none() {
            return;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        let timer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            c.store(true, Ordering::SeqCst);
        });
        let mut cmd = command(&tool("ffmpeg").unwrap());
        cmd.args([
            "-v",
            "error",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=25",
            "-t",
            "30",
            "-f",
            "null",
            "-",
        ]);
        let start = std::time::Instant::now();
        assert!(run(&mut cmd, cancel).unwrap_err().contains("中止"));
        timer.join().unwrap();
        assert!(start.elapsed() < Duration::from_secs(5));
    }
    #[test]
    fn merge_and_complement() {
        let r = [
            Range { start: 4., end: 6. },
            Range { start: 1., end: 3. },
            Range { start: 2., end: 5. },
        ];
        assert_eq!(
            ranges(&r, 10., false).unwrap(),
            vec![Range { start: 1., end: 6. }]
        );
        assert_eq!(
            ranges(&r, 10., true).unwrap(),
            vec![
                Range { start: 0., end: 1. },
                Range {
                    start: 6.,
                    end: 10.
                }
            ]
        );
    }
    #[test]
    fn invalid_ranges() {
        for r in [
            Range {
                start: f64::NAN,
                end: 3.,
            },
            Range {
                start: -1.,
                end: 2.,
            },
            Range { start: 3., end: 2. },
            Range {
                start: 0.,
                end: 11.,
            },
        ] {
            assert!(ranges(&[r], 10., false).is_err());
        }
        assert!(ranges(
            &[Range {
                start: 0.,
                end: 10.
            }],
            10.,
            true
        )
        .is_err());
    }
    #[test]
    fn preserve_existing() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("keep.txt");
        std::fs::write(&p, b"original").unwrap();
        assert!(write_new(&p, b"new").is_err());
        assert_eq!(std::fs::read(p).unwrap(), b"original");
    }
    #[test]
    fn actual_cut_and_cancel() {
        if std::env::var_os("TC_MEDIA_TEST").is_none() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let input = d.path().join("source.mp4");
        assert!(command(&tool("ffmpeg").unwrap())
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x240:rate=25:duration=6",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=6",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest"
            ])
            .arg(&input)
            .status()
            .unwrap()
            .success());
        let m = probe(&input).unwrap();
        let original = std::fs::read(&input).unwrap();
        let output = d.path().join("cut.mp4");
        let kept = ranges(
            &[
                Range {
                    start: 0.5,
                    end: 1.5,
                },
                Range { start: 3., end: 5. },
            ],
            m.duration,
            false,
        )
        .unwrap();
        cut(&m, &kept, &output, Arc::new(AtomicBool::new(false)), |_| {}).unwrap();
        let result = probe(&output).unwrap();
        assert!((result.duration - 3.).abs() < 0.35);
        assert!(result.audio);
        let existing_output = std::fs::read(&output).unwrap();
        assert!(cut(&m, &kept, &output, Arc::new(AtomicBool::new(false)), |_| {}).is_err());
        assert_eq!(std::fs::read(&output).unwrap(), existing_output);
        assert_eq!(std::fs::read(&input).unwrap(), original);
        let cancelled = d.path().join("cancel.mp4");
        assert!(cut(
            &m,
            &kept,
            &cancelled,
            Arc::new(AtomicBool::new(true)),
            |_| {}
        )
        .is_err());
        assert!(!cancelled.exists());
        let many: Vec<Range> = (0..20)
            .map(|i| Range {
                start: i as f64 * 0.25,
                end: i as f64 * 0.25 + 0.1,
            })
            .collect();
        let many_output = d.path().join("twenty.mp4");
        cut(
            &m,
            &many,
            &many_output,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .unwrap();
        let many_result = probe(&many_output).unwrap();
        assert!(
            (many_result.duration - 2.0).abs() < 0.12,
            "20 range duration: {}",
            many_result.duration
        );
        assert!(many_result.audio);
        let removed = d.path().join("removed.mp4");
        let remove = ranges(&[Range { start: 1., end: 2. }], m.duration, true).unwrap();
        cut(
            &m,
            &remove,
            &removed,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .unwrap();
        assert!((probe(&removed).unwrap().duration - (m.duration - 1.)).abs() < 0.12);
        let silent = d.path().join("silent.mp4");
        assert!(command(&tool("ffmpeg").unwrap())
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x240:rate=25:duration=2",
                "-c:v",
                "libx264",
                "-n"
            ])
            .arg(&silent)
            .status()
            .unwrap()
            .success());
        let silent_media = probe(&silent).unwrap();
        assert!(!silent_media.audio);
        let silent_cut = d.path().join("silent-cut.mp4");
        cut(
            &silent_media,
            &[Range {
                start: 0.3,
                end: 1.3,
            }],
            &silent_cut,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .unwrap();
        let silent_result = probe(&silent_cut).unwrap();
        assert!(!silent_result.audio);
        assert!((silent_result.duration - 1.).abs() < 0.12);
    }
}
