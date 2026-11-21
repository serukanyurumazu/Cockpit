mod browser;
mod hooks;
mod pty;

pub fn hook_forward(args: &[String]) -> i32 {
    hooks::forward(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(pty::init())
        .plugin(browser::init())
        .plugin(hooks::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
