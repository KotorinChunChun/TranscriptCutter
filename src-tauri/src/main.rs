#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod media;
mod server;
use media::{Media, Range, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State};

#[derive(Clone, Default, Serialize)]
struct CutStatus {
    running: bool,
    progress: f64,
    output: Option<String>,
    error: Option<String>,
}
#[derive(Default)]
struct Inner {
    server: Option<server::Server>,
    media: Option<Media>,
    cut: CutStatus,
    cancel: Arc<AtomicBool>,
    upload: bool,
    pending_cancel: bool,
    active_job: Option<String>,
}
struct AppState {
    inner: Arc<Mutex<Inner>>,
    data: PathBuf,
    project_lock: Mutex<()>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Project {
    path: String,
    job: Option<String>,
    ranges: Vec<Range>,
    remove: bool,
    #[serde(default)]
    output_dir: String,
}
fn read_projects(state: &AppState) -> Vec<Project> {
    std::fs::read(state.data.join("projects.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn store_project(state: &AppState, project: Project) -> Result<()> {
    let _guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    let mut list = read_projects(state);
    list.retain(|p| p.path != project.path);
    list.insert(0, project);
    list.truncate(100);
    std::fs::create_dir_all(&state.data).map_err(|e| e.to_string())?;
    let path = state.data.join("projects.json");
    let mut tmp = tempfile::NamedTempFile::new_in(&state.data).map_err(|e| e.to_string())?;
    use std::io::Write;
    tmp.write_all(&serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn connected(state: &AppState) -> Result<server::Server> {
    state
        .inner
        .lock()
        .unwrap()
        .server
        .clone()
        .ok_or("先にサーバーへ接続してください。".into())
}
#[tauri::command]
fn bootstrap(state: State<AppState>) -> Value {
    json!({"projects":read_projects(&state),"home":std::env::var("USERPROFILE").unwrap_or("C:\\".into()),"ffmpeg":media::tool("ffmpeg").ok(),"ffprobe":media::tool("ffprobe").ok(),"data":state.data})
}
#[tauri::command]
async fn browse(path: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move|| {
        if path.is_empty() {let drives:Vec<Value>=(b'A'..=b'Z').map(|c|format!("{}:\\",c as char)).filter(|p|PathBuf::from(p).exists()).map(|p|json!({"name":p,"path":p,"directory":true})).collect();return Ok(json!({"path":"","parent":null,"entries":drives}));}
        let dir=media::local_path(&path)?;
        let mut entries=Vec::new();
        for e in std::fs::read_dir(&dir).map_err(|e|e.to_string())?.flatten() {
            let kind=match e.file_type(){Ok(k)=>k,Err(_)=>continue}; if kind.is_symlink(){continue;}
            let p=e.path(); let ext=p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
            if kind.is_dir() || ["mp4","mov","mkv","webm","avi","m4v","wmv","mts","m2ts"].contains(&ext.as_str()) {entries.push(json!({"name":e.file_name().to_string_lossy(),"path":p,"directory":kind.is_dir()}));}
            if entries.len()>=10000 {return Err("項目が多すぎます。下位フォルダーのパスを直接入力してください。".into());}
        }
        entries.sort_by_key(|v|(!v["directory"].as_bool().unwrap_or(false),v["name"].as_str().unwrap_or("").to_lowercase()));
        Ok(json!({"path":dir,"parent":dir.parent(),"entries":entries}))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn open_media(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Media> {
    {
        let i = state.inner.lock().unwrap();
        if i.upload || i.cut.running {
            return Err("現在の処理が終わってから動画を切り替えてください。".into());
        }
    }
    let media =
        tauri::async_runtime::spawn_blocking(move || media::probe(&media::local_path(&path)?))
            .await
            .map_err(|e| e.to_string())??;
    let mut inner = state.inner.lock().unwrap();
    // Only explicitly selected local files are allowed for this application session.
    app.asset_protocol_scope()
        .allow_file(&media.path)
        .map_err(|e| e.to_string())?;
    inner.media = Some(media.clone());
    Ok(media)
}
#[tauri::command]
async fn connect_server(state: State<'_, AppState>, url: String) -> Result<Value> {
    let (server, value) =
        tauri::async_runtime::spawn_blocking(move || server::Server::connect(&url))
            .await
            .map_err(|e| e.to_string())??;
    state.inner.lock().unwrap().server = Some(server);
    Ok(value)
}
#[tauri::command]
async fn transcribe(
    state: State<'_, AppState>,
    engine: String,
    model: String,
    device: String,
    diarize: bool,
) -> Result<Value> {
    let server = connected(&state)?;
    let inner = state.inner.clone();
    let path = {
        let mut i = inner.lock().unwrap();
        if i.upload {
            return Err("動画を送信中です。".into());
        }
        let path = i.media.clone().ok_or("動画を選択してください。")?.path;
        i.upload = true;
        i.pending_cancel = false;
        i.active_job = None;
        path
    };
    let path_for_save = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = server.upload(&PathBuf::from(path), &engine, &model, &device, diarize);
        let mut i = inner.lock().unwrap();
        i.upload = false;
        if let Ok(value) = &result {
            if let Some(id) = value["job"]["id"].as_str() {
                i.active_job = Some(id.into());
                if i.pending_cancel {
                    drop(i);
                    let _ = server.change(&format!("/api/jobs/{id}/cancel"), &json!({}), false);
                }
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Ok(v) = &result {
        let mut project = read_projects(&state)
            .into_iter()
            .find(|p| p.path == path_for_save)
            .unwrap_or(Project {
                path: path_for_save,
                job: None,
                ranges: vec![],
                remove: false,
                output_dir: String::new(),
            });
        project.job = v["job"]["id"].as_str().map(String::from);
        if let Err(e) = store_project(&state, project) {
            return Ok(
                json!({"job":v["job"],"warning":format!("受付済みですが履歴保存に失敗しました: {e}")}),
            );
        }
    }
    result
}
#[tauri::command]
async fn job_status(state: State<'_, AppState>, id: String) -> Result<Value> {
    let server = connected(&state)?;
    server::job_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || server.get(&format!("/api/jobs/{id}")))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_segments(state: State<'_, AppState>, id: String, after: u64) -> Result<Value> {
    let server = connected(&state)?;
    server::job_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        server.get(&format!("/api/jobs/{id}/segments?after={after}&limit=1000"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn edit_segments(state: State<'_, AppState>, id: String, edits: Value) -> Result<Value> {
    let server = connected(&state)?;
    server::job_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        server.change(
            &format!("/api/jobs/{id}/segments"),
            &json!({"edits":edits}),
            true,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn cancel_transcription(state: State<'_, AppState>, id: Option<String>) -> Result<Value> {
    let server = connected(&state)?;
    {
        let mut i = state.inner.lock().unwrap();
        if i.upload {
            i.pending_cancel = true;
            return Ok(json!({"pending":true}));
        }
    }
    let id = id
        .or_else(|| state.inner.lock().unwrap().active_job.clone())
        .ok_or("対象ジョブがありません。")?;
    server::job_id(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        server.change(&format!("/api/jobs/{id}/cancel"), &json!({}), false)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn save_project(state: State<AppState>, project: Project) -> Result<()> {
    store_project(&state, project)
}
#[tauri::command]
fn export_text(dir: String, name: String, extension: String, text: String) -> Result<String> {
    if !["txt", "srt", "vtt", "json"].contains(&extension.as_str()) {
        return Err("未対応の出力形式です。".into());
    }
    let path = media::output_path(&dir, &name, &extension)?;
    media::write_new(&path, text.as_bytes())?;
    Ok(path.to_string_lossy().into())
}
#[tauri::command]
fn start_cut(
    state: State<AppState>,
    ranges: Vec<Range>,
    remove: bool,
    dir: String,
    name: String,
) -> Result<()> {
    let mut i = state.inner.lock().unwrap();
    if i.cut.running {
        return Err("書き出し中です。".into());
    }
    let media = i.media.clone().ok_or("動画を選択してください。")?;
    let kept = media::ranges(&ranges, media.duration, remove)?;
    let output = media::output_path(&dir, &name, "mp4")?;
    i.cancel = Arc::new(AtomicBool::new(false));
    let cancel = i.cancel.clone();
    i.cut = CutStatus {
        running: true,
        ..Default::default()
    };
    let inner = state.inner.clone();
    drop(i);
    std::thread::spawn(move || {
        let result = media::cut(&media, &kept, &output, cancel, |p| {
            inner.lock().unwrap().cut.progress = p
        });
        let mut i = inner.lock().unwrap();
        i.cut.running = false;
        match result {
            Ok(()) => i.cut.output = Some(output.to_string_lossy().into()),
            Err(e) => i.cut.error = Some(e),
        }
    });
    Ok(())
}
#[tauri::command]
fn cut_status(state: State<AppState>) -> CutStatus {
    state.inner.lock().unwrap().cut.clone()
}
#[tauri::command]
fn cancel_cut(state: State<AppState>) {
    state
        .inner
        .lock()
        .unwrap()
        .cancel
        .store(true, Ordering::SeqCst);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data = if let Some(path) = std::env::var_os("TRANSCRIPT_CUTTER_DATA_DIR") {
                PathBuf::from(path)
            } else {
                app.path().app_local_data_dir()?
            };
            app.manage(AppState {
                inner: Arc::new(Mutex::new(Inner::default())),
                project_lock: Mutex::new(()),
                data,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let i = state.inner.lock().unwrap();
                if i.cut.running || i.upload {
                    api.prevent_close();
                    use tauri::Emitter;
                    let _ = window.emit(
                        "busy-close",
                        "送信または動画書き出しが進行中です。中止してから閉じてください。",
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            browse,
            open_media,
            connect_server,
            transcribe,
            job_status,
            get_segments,
            edit_segments,
            cancel_transcription,
            save_project,
            export_text,
            start_cut,
            cut_status,
            cancel_cut
        ])
        .run(tauri::generate_context!())
        .expect("TranscriptCutterを起動できません");
}
