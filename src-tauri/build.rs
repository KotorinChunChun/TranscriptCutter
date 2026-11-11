fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "bootstrap",
            "browse",
            "open_media",
            "connect_server",
            "transcribe",
            "job_status",
            "get_segments",
            "edit_segments",
            "cancel_transcription",
            "save_project",
            "export_text",
            "start_cut",
            "cut_status",
            "cancel_cut",
        ]),
    ))
    .expect("Tauri build failed");
}
