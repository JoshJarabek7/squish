// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::{TitleBarStyle, WebviewWindowBuilder, WebviewUrl, Manager};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSWindow, NSWindowStyleMask, NSWindowCollectionBehavior},
    base::id,
};

mod fonts;
use fonts::{FontState, get_system_fonts, initialize_fonts};

pub fn create_window(app: &tauri::App) -> tauri::Result<()> {
    // Initialize font state
    let fonts = initialize_fonts();
    
    // Store fonts in app state
    println!("Storing {} fonts in app state", fonts.len());
    app.manage(FontState(std::sync::Mutex::new(fonts)));

    let window = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::default()
    )
    .title("Squish")
    .inner_size(1200.0, 800.0)
    .decorations(true)
    .title_bar_style(TitleBarStyle::Visible)
    .build()?;

    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window().unwrap() as id;
        unsafe {
            let mut style_mask = ns_window.styleMask();
            style_mask |= NSWindowStyleMask::NSTexturedBackgroundWindowMask;
            style_mask |= NSWindowStyleMask::NSTitledWindowMask;
            ns_window.setStyleMask_(style_mask);
            
            // Set window to appear in all spaces
            ns_window.setCollectionBehavior_(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
            );
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            create_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_system_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
