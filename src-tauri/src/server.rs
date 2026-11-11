use crate::media::Result;
use reqwest::blocking::{Client, Response};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

#[derive(Clone)]
pub struct Server {
    client: Client,
    base: String,
    token: String,
}
impl Server {
    pub fn connect(base: &str) -> Result<(Self, Value)> {
        let url = reqwest::Url::parse(base).map_err(|_| "サーバーURLが不正です。")?;
        if url.scheme() != "http"
            || !matches!(
                url.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
            )
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(
                "同じPCのHTTPサーバーURLを指定してください（例 http://127.0.0.1:8769）。".into(),
            );
        }
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;
        let base = base.trim_end_matches('/').to_string();
        let health = decode(
            client
                .get(format!("{base}/api/health"))
                .timeout(Duration::from_secs(10))
                .send()
                .map_err(|_| {
                    "TranscriptionServerへ接続できません。起動状態とURLを確認してください。"
                })?,
        )?;
        if health["appId"] != "meeting-transcriber" {
            return Err("指定先はTranscriptionServerではありません。".into());
        }
        let token = health["token"]
            .as_str()
            .ok_or("サーバー認証情報がありません。")?
            .to_string();
        let server = Self {
            client,
            base,
            token,
        };
        let models = server.get("/v1/models")?;
        Ok((
            server,
            json!({"models":models["data"],"protocolVersion":health["protocolVersion"]}),
        ))
    }
    pub fn get(&self, path: &str) -> Result<Value> {
        decode(
            self.client
                .get(format!("{}{path}", self.base))
                .header("X-Local-Token", &self.token)
                .timeout(Duration::from_secs(30))
                .send()
                .map_err(|_| "サーバー応答を取得できません。再接続してください。")?,
        )
    }
    pub fn change(&self, path: &str, body: &Value, patch: bool) -> Result<Value> {
        let url = format!("{}{path}", self.base);
        let request = if patch {
            self.client.patch(url)
        } else {
            self.client.post(url)
        };
        decode(
            request
                .header("X-Local-Token", &self.token)
                .json(body)
                .timeout(Duration::from_secs(30))
                .send()
                .map_err(|_| "サーバー操作の結果が不明です。状態を再取得してください。")?,
        )
    }
    pub fn upload(
        &self,
        path: &Path,
        engine: &str,
        model: &str,
        device: &str,
        diarize: bool,
    ) -> Result<Value> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let length = file.metadata().map_err(|e| e.to_string())?.len();
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        decode(self.client.post(format!("{}/api/jobs",self.base))
            .query(&file_job_query(&name, engine, model, device, diarize))
            .header("X-Local-Token",&self.token).header("Content-Type","application/octet-stream").header("Content-Length",length)
            .body(file).timeout(Duration::from_secs(7200)).send().map_err(|_|"送信の受付結果が不明です。自動再送は行いません。サーバーの履歴を確認してください。")?)
    }
}
fn file_job_query<'a>(
    name: &'a str,
    engine: &'a str,
    model: &'a str,
    device: &'a str,
    diarize: bool,
) -> [(&'static str, &'a str); 7] {
    [
        ("name", name),
        ("engine", engine),
        ("model", model),
        ("device", device),
        ("diarize", if diarize { "true" } else { "false" }),
        ("clientId", "transcript-cutter"),
        ("workload", "file"),
    ]
}
fn decode(response: Response) -> Result<Value> {
    let status = response.status();
    let value: Value = response
        .json()
        .map_err(|_| "サーバー応答がJSONではありません。")?;
    if !status.is_success() {
        return Err(format!(
            "サーバーエラー {status}: {}",
            value
                .get("error")
                .or_else(|| value.get("detail"))
                .unwrap_or(&json!("操作できません"))
        ));
    }
    Ok(value)
}
pub fn job_id(id: &str) -> Result<&str> {
    if id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id)
    } else {
        Err("ジョブIDが不正です。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_classification_preserves_legacy_query() {
        let request = Client::new()
            .post("http://127.0.0.1:8769/api/jobs")
            .query(&file_job_query("合成.mp4", "whisper", "tiny", "cpu", true))
            .build()
            .unwrap();
        let query: std::collections::HashMap<_, _> =
            request.url().query_pairs().into_owned().collect();
        assert_eq!(query["clientId"], "transcript-cutter");
        assert_eq!(query["workload"], "file");
        assert_eq!(query["name"], "合成.mp4");
        assert_eq!(query["engine"], "whisper");
        assert_eq!(query["model"], "tiny");
        assert_eq!(query["device"], "cpu");
        assert_eq!(query["diarize"], "true");
    }
    #[test]
    fn old_server_shape_upload_status_cancel_and_segments() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            for index in 0..4 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut byte = [0u8; 1];
                while !bytes.ends_with(b"\r\n\r\n") {
                    socket.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                }
                let headers = String::from_utf8(bytes).unwrap();
                assert!(headers.to_lowercase().contains("x-local-token: fixture"));
                let length = headers
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|v| v.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                let mut body = vec![0; length];
                socket.read_exact(&mut body).unwrap();
                let payload=match index {
                    0=>{assert!(headers.contains("clientId=transcript-cutter"));assert!(headers.contains("workload=file"));assert_eq!(body,b"synthetic");json!({"job":{"id":"0123456789abcdef0123456789abcdef","status":"queued"}})},
                    1=>json!({"job":{"status":"complete"}}),
                    2=>json!({"job":{"status":"cancelled"}}),
                    _=>json!({"segments":[{"id":1,"start":1.25,"end":4.75,"text":"合成"}],"total":1}),
                }.to_string();
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
            }
        });
        let server = Server {
            client: Client::builder().no_proxy().build().unwrap(),
            base,
            token: "fixture".into(),
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synthetic.mp4");
        std::fs::write(&path, b"synthetic").unwrap();
        assert_eq!(
            server
                .upload(&path, "whisper", "tiny", "cpu", false)
                .unwrap()["job"]["status"],
            "queued"
        );
        assert_eq!(
            server
                .get("/api/jobs/0123456789abcdef0123456789abcdef")
                .unwrap()["job"]["status"],
            "complete"
        );
        assert_eq!(
            server
                .change(
                    "/api/jobs/0123456789abcdef0123456789abcdef/cancel",
                    &json!({}),
                    false
                )
                .unwrap()["job"]["status"],
            "cancelled"
        );
        let segments = server
            .get("/api/jobs/0123456789abcdef0123456789abcdef/segments")
            .unwrap();
        assert_eq!(segments["segments"][0]["start"], 1.25);
        assert_eq!(segments["segments"][0]["end"], 4.75);
        worker.join().unwrap();
    }
    #[test]
    fn rejects_remote() {
        assert!(Server::connect("https://example.com").is_err());
        assert!(Server::connect("http://127.0.0.1:8769/wrong").is_err());
        assert!(job_id("../foo").is_err());
    }
    #[test]
    fn real_service() {
        if std::env::var_os("TC_SERVER_TEST").is_none() {
            return;
        }
        let (_, v) = Server::connect("http://127.0.0.1:8769").unwrap();
        assert!(v["models"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == "whisper/tiny"));
    }
    #[test]
    fn synthetic_transcription_edit_cut_cancel() {
        let Some(audio) = std::env::var_os("TC_E2E_AUDIO") else {
            return;
        };
        let dir = std::path::PathBuf::from(std::env::var_os("TC_E2E_DIR").expect("TC_E2E_DIR"));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join(format!("synthetic-{}.mp4", uuid::Uuid::new_v4().simple()));
        let status = crate::media::command(&crate::media::tool("ffmpeg").unwrap())
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=25",
                "-i",
            ])
            .arg(audio)
            .args([
                "-shortest",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-pix_fmt",
                "yuv420p",
                "-n",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());
        let m = crate::media::probe(&source).unwrap();
        let (server, _) = Server::connect("http://127.0.0.1:8769").unwrap();
        let accepted = server
            .upload(&source, "whisper", "tiny", "cpu", false)
            .unwrap();
        let id = accepted["job"]["id"].as_str().unwrap();
        let mut complete = None;
        for _ in 0..360 {
            let value = server.get(&format!("/api/jobs/{id}")).unwrap();
            match value["job"]["status"].as_str().unwrap_or("") {
                "complete" => {
                    complete = Some(value["job"].clone());
                    break;
                }
                "error" | "cancelled" | "interrupted" => panic!("Recognition failed: {value}"),
                _ => std::thread::sleep(Duration::from_millis(500)),
            }
        }
        let job = complete.expect("recognition timeout");
        let segments = server
            .get(&format!("/api/jobs/{id}/segments?after=0&limit=1000"))
            .unwrap();
        assert!(segments["segments"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| !s["text"].as_str().unwrap_or("").trim().is_empty()));
        let first = &segments["segments"][0];
        let original = first["text"].as_str().unwrap();
        let text = format!("{original}［合成動画検証］");
        server
            .change(
                &format!("/api/jobs/{id}/segments"),
                &json!({"edits":[{"id":first["id"],"text":text,"speaker":"検証話者"}]}),
                true,
            )
            .unwrap();
        let edited = server
            .get(&format!("/api/jobs/{id}/segments?after=0&limit=1000"))
            .unwrap();
        assert_eq!(edited["segments"][0]["text"], text);
        assert_eq!(edited["segments"][0]["speaker"], "検証話者");
        let kept = crate::media::ranges(
            &[
                crate::media::Range {
                    start: 0.5,
                    end: 2.,
                },
                crate::media::Range { start: 3., end: 5. },
            ],
            m.duration,
            false,
        )
        .unwrap();
        let output = dir.join(format!("cut-{id}.mp4"));
        crate::media::cut(
            &m,
            &kept,
            &output,
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            |_| {},
        )
        .unwrap();
        let cut = crate::media::probe(&output).unwrap();
        assert!(cut.audio);
        assert!((cut.duration - 3.5).abs() < 0.4);
        let cancel = server
            .upload(&source, "whisper", "tiny", "cpu", false)
            .unwrap();
        let cancel_id = cancel["job"]["id"].as_str().unwrap();
        server
            .change(&format!("/api/jobs/{cancel_id}/cancel"), &json!({}), false)
            .unwrap();
        let mut cancellation = String::new();
        for _ in 0..40 {
            let v = server.get(&format!("/api/jobs/{cancel_id}")).unwrap();
            cancellation = v["job"]["status"].as_str().unwrap_or("").into();
            if cancellation == "cancelled" {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        assert_eq!(cancellation, "cancelled");
        let report = json!({"job":job,"segments":edited["segments"],"source":m,"cut":cut,"kept":kept,"cancelledJob":cancel_id,"cancellation":cancellation});
        std::fs::write(
            dir.join("e2e-result.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        println!(
            "synthetic E2E evidence: {}",
            dir.join("e2e-result.json").display()
        );
    }
}
