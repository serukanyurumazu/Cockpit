//! Embedded browser pane: a native child webview inside the main window (Tauri `unstable`).
//! It loads external http(s) pages only, has its own data directory and no IPC capability
//! (the privileged capability is scoped to webview label "main").

use serde::Serialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::webview::{
    DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionResponse, Url, WebviewBuilder,
};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Webview, WebviewUrl};

const PREFIX: &str = "browser-";

fn allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

fn parse(url: &str) -> Result<Url, String> {
    let url = Url::parse(url).map_err(|e| e.to_string())?;
    if allowed(&url) {
        Ok(url)
    } else {
        Err(format!("blocked scheme: {}", url.scheme()))
    }
}

fn webview<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<Webview<R>, String> {
    if !label.starts_with(PREFIX) {
        return Err("not a browser webview".into());
    }
    app.get_webview(label).ok_or_else(|| format!("no webview {label}"))
}

#[derive(Clone, Serialize)]
struct PageEvent {
    label: String,
    url: String,
    loading: bool,
}

/// async: on Windows, creating a child webview from a sync command deadlocks (wry#583).
#[tauri::command]
async fn open<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if !label.starts_with(PREFIX) || label.len() > 64 {
        return Err("invalid browser label".into());
    }
    if app.get_webview(&label).is_some() {
        return Err(format!("webview {label} exists"));
    }
    let url = parse(&url)?;
    let window = app.get_window("main").ok_or("main window missing")?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("browser");

    let nav_app = app.clone();
    let nav_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .data_directory(data_dir)
        .on_navigation(allowed)
        // window.open / target=_blank: stay in this pane instead of spawning windows
        .on_new_window(move |url, _| {
            if allowed(&url) {
                if let Some(w) = nav_app.get_webview(&nav_label) {
                    let _ = w.navigate(url);
                }
            }
            NewWindowResponse::Deny
        })
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_download(|_, event| !matches!(event, DownloadEvent::Requested { .. }))
        .on_page_load(|wv, payload| {
            let _ = wv.app_handle().emit(
                "browser:page",
                PageEvent {
                    label: wv.label().to_string(),
                    url: payload.url().to_string(),
                    loading: matches!(payload.event(), PageLoadEvent::Started),
                },
            );
        });
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_bounds<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn navigate<R: Runtime>(app: AppHandle<R>, label: String, url: String) -> Result<(), String> {
    webview(&app, &label)?.navigate(parse(&url)?).map_err(|e| e.to_string())
}

/// action: back | forward | reload | devtools | show | hide | close
#[tauri::command]
async fn action<R: Runtime>(app: AppHandle<R>, label: String, action: String) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    let r = match action.as_str() {
        "back" => wv.eval("history.back()"),
        "forward" => wv.eval("history.forward()"),
        "reload" => wv.reload(),
        "show" => wv.show(),
        "hide" => wv.hide(),
        "close" => wv.close(),
        "devtools" => {
            #[cfg(debug_assertions)]
            wv.open_devtools();
            Ok(())
        }
        other => return Err(format!("unknown action {other}")),
    };
    r.map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("browser")
        .invoke_handler(tauri::generate_handler![open, set_bounds, navigate, action])
        .build()
}
