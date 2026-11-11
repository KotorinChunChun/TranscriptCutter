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
    let mut parts = Vec::new();
    let total: f64 = kept.iter().map(|r| r.end - r.start).sum();
    let mut done = 0.0;
    for (i, r) in kept.iter().enumerate() {
        let path = temp.path().join(format!("part{i}.mp4"));
        let mut cmd = command(&ffmpeg);
        cmd.args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &r.start.to_string(),
        ])
        .arg("-i")
        .arg(&media.path)
        .args([
            "-t",
            &(r.end - r.start).to_string(),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
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
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            "-n",
        ])
        .arg(&path);
        run(&mut cmd, cancel.clone())?;
        parts.push(path);
        done += r.end - r.start;
        progress((done / total * 90.0).min(90.0));
    }
    let list = temp.path().join("list.txt");
    // Generated ASCII basenames keep concat parsing independent of user path characters.
    std::fs::write(
        &list,
        (0..parts.len())
            .map(|i| format!("file 'part{i}.mp4'\n"))
            .collect::<String>(),
    )
    .map_err(|e| e.to_string())?;
    let joined = temp.path().join("joined.mp4");
    let mut cmd = command(&ffmpeg);
    cmd.args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
    ])
    .arg(&list)
    .args(["-c", "copy", "-movflags", "+faststart", "-n"])
    .arg(&joined);
    run(&mut cmd, cancel.clone())?;
    if cancel.load(Ordering::SeqCst) {
        return Err("書き出しを中止しました。".into());
    }
    let checked = probe(&joined)?;
    if (checked.duration - total).abs() > (kept.len() as f64 * 0.12 + 0.2)
        || (media.audio && !checked.audio)
    {
        return Err("書き出し動画の時間または音声を検証できません。".into());
    }
    let mut file =
        tempfile::NamedTempFile::new_in(output.parent().unwrap()).map_err(|e| e.to_string())?;
    std::io::copy(
        &mut std::fs::File::open(joined).map_err(|e| e.to_string())?,
        &mut file,
    )
    .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    if cancel.load(Ordering::SeqCst) {
        return Err("書き出しを中止しました。".into());
    }
    file.persist_noclobber(output)
        .map_err(|e| format!("保存できません（既存ファイルは保持）: {e}"))?;
    progress(100.0);
    Ok(())
}
fn run(cmd: &mut Command, cancel: Arc<AtomicBool>) -> Result<()> {
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
        assert!(cut(&m, &kept, &output, Arc::new(AtomicBool::new(false)), |_| {}).is_err());
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
    }
}
