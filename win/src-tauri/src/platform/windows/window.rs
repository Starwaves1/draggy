use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, Runtime};

/// Undecorated: the renderer's TitleBar draws the caption buttons. Edge resize and snap stay on.
pub fn main_chrome<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder.decorations(false)
}
