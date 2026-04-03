#[cfg(feature = "desktop")]
use std::sync::Mutex;
#[cfg(feature = "desktop")]
use tauri::menu::{MenuBuilder, SubmenuBuilder};
#[cfg(feature = "desktop")]
use tauri::{Emitter, State};
#[cfg(feature = "desktop")]
use world_core::{
    ChunkCoord, ChunkData, LoadWorldResponse, PixelCell, PixelPatch, RegistrySnapshot,
    ValidatePixelResponse, WorldRuntime,
};

#[cfg(feature = "desktop")]
#[derive(Default)]
struct AppState {
    runtime: Mutex<WorldRuntime>,
}

#[cfg(feature = "desktop")]
const MENU_NEW_WORLD: &str = "world.new";
#[cfg(feature = "desktop")]
const MENU_OPEN_WORLD: &str = "world.open";
#[cfg(feature = "desktop")]
const MENU_SAVE_WORLD: &str = "world.save";

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_world(state: State<'_, AppState>, meta_path: String) -> Result<LoadWorldResponse, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime.load_world(meta_path).map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn create_world(
    state: State<'_, AppState>,
    meta_path: String,
) -> Result<LoadWorldResponse, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime
        .create_world(meta_path)
        .map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_chunks(
    state: State<'_, AppState>,
    chunk_coords: Vec<ChunkCoord>,
) -> Result<Vec<ChunkData>, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime
        .load_chunks(&chunk_coords)
        .map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn apply_pixel_patch(
    state: State<'_, AppState>,
    patches: Vec<PixelPatch>,
) -> Result<Vec<ChunkCoord>, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime
        .apply_pixel_patch(&patches)
        .map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_registry(state: State<'_, AppState>) -> Result<RegistrySnapshot, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime.load_registry().map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_registry(
    state: State<'_, AppState>,
    snapshot: RegistrySnapshot,
) -> Result<RegistrySnapshot, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime
        .save_registry(snapshot)
        .map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn validate_pixel_payload(
    state: State<'_, AppState>,
    payload: PixelCell,
) -> Result<ValidatePixelResponse, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime
        .validate_pixel_payload(payload)
        .map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_world(state: State<'_, AppState>) -> Result<(), String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "状态锁已损坏".to_string())?;
    runtime.save_world().map_err(|err| err.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn open_release_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("仅允许打开 http/https 链接".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前仅在 Windows 环境支持打开外部链接".to_string())
    }
}

#[cfg(feature = "desktop")]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(|app| {
            let world_submenu = SubmenuBuilder::new(app, "地图")
                .text(MENU_NEW_WORLD, "新建")
                .text(MENU_OPEN_WORLD, "打开")
                .text(MENU_SAVE_WORLD, "保存")
                .build()?;
            MenuBuilder::new(app).item(&world_submenu).build()
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_NEW_WORLD => {
                if let Err(err) = app.emit("menu:new-world", ()) {
                    eprintln!("failed to emit menu:new-world: {err}");
                }
            }
            MENU_OPEN_WORLD => {
                if let Err(err) = app.emit("menu:open-world", ()) {
                    eprintln!("failed to emit menu:open-world: {err}");
                }
            }
            MENU_SAVE_WORLD => {
                if let Err(err) = app.emit("menu:save-world", ()) {
                    eprintln!("failed to emit menu:save-world: {err}");
                }
            }
            _ => {}
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_world,
            create_world,
            load_chunks,
            apply_pixel_patch,
            load_registry,
            save_registry,
            validate_pixel_payload,
            save_world,
            open_release_url
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

#[cfg(not(feature = "desktop"))]
pub fn run() {
    panic!("desktop 功能已禁用；请启用 feature 'desktop' 后再运行");
}
