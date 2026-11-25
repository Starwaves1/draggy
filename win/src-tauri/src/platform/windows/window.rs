use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, Runtime, WebviewWindow};

/// WebView2 serves the app's pages from the asset scheme as http://tauri.localhost, which is their origin.
pub const PAGE_ORIGIN: &str = "http://tauri.localhost";

/// Undecorated: the renderer's TitleBar draws the caption buttons. Edge resize and snap stay on.
pub fn main_chrome<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder.decorations(false)
}

/// WebView2 paints a hidden window, so the main window stays hidden until its first frame.
pub fn paint_unseen(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// Nothing to undo: the window stayed hidden.
pub fn reveal(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
