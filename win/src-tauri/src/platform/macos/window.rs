use objc2::msg_send;
use objc2::runtime::AnyObject;
use serde_json::json;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, Runtime, TitleBarStyle, WebviewWindow};

/// The system's traffic lights over the page's own 40px title bar, which runs under a hidden native one.
pub fn main_chrome<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .decorations(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .initialization_script(boot_script())
}

/// WKWebView paints nothing in an off-screen window, so the main window waits on screen, transparent and
/// click-through, until its first frame.
pub fn paint_unseen(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_ignore_cursor_events(true)?;
    on_ns_window(window, |ns| {
        // SAFETY: NSWindow messages, sent on the main thread while the window exists.
        unsafe {
            let _: () = msg_send![ns, setAlphaValue: 0.0_f64];
            let _: () = msg_send![ns, orderFrontRegardless];
        }
    })
}

/// Undoes `paint_unseen` once the window is shown for real.
pub fn reveal(window: &WebviewWindow) -> tauri::Result<()> {
    on_ns_window(window, |ns| {
        // SAFETY: as in paint_unseen.
        unsafe {
            let _: () = msg_send![ns, setAlphaValue: 1.0_f64];
        }
    })?;
    window.set_ignore_cursor_events(false)
}

fn on_ns_window(
    window: &WebviewWindow,
    action: impl FnOnce(&AnyObject) + Send + 'static,
) -> tauri::Result<()> {
    window.with_webview(move |webview| {
        // SAFETY: Tauri calls this on the main thread while the window lives; the pointer is its NSWindow.
        action(unsafe { &*webview.ns_window().cast::<AnyObject>() })
    })
}

/// Tells the renderer, before its first frame, that the system draws the window controls, that
/// `reveal` shows the window the instant the page is ready and that Command leads shortcuts.
fn boot_script() -> String {
    let info =
        json!({ "windowControls": "native", "readyAt": "frameCommitted", "shortcuts": "command" });
    format!("window.__DRAGGY_PLATFORM__ = Object.freeze({info});")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_script_hands_the_renderer_native_controls() {
        let script = boot_script();
        let json = script
            .strip_prefix("window.__DRAGGY_PLATFORM__ = Object.freeze(")
            .and_then(|rest| rest.strip_suffix(");"))
            .expect("a frozen assignment to window.__DRAGGY_PLATFORM__");
        let info: serde_json::Value = serde_json::from_str(json).unwrap();
        // The renderer's tests read the same case, so a rename on either side fails a suite.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../shared/fixtures/platform/info.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(info, fixture["cases"][0]["expected"]);
    }
}
