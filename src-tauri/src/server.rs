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
            .query(&[("name",name.as_str()),("engine",engine),("model",model),("device",device),("diarize",if diarize {"true"} else {"false"})])
            .header("X-Local-Token",&self.token).header("Content-Type","application/octet-stream").header("Content-Length",length)
            .body(file).timeout(Duration::from_secs(7200)).send().map_err(|_|"送信の受付結果が不明です。自動再送は行いません。サーバーの履歴を確認してください。")?)
    }
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
}
