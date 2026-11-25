use serde_json::json;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, Runtime, TitleBarStyle};

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

/// Tells the renderer, before its first frame, that the system draws the window controls.
fn boot_script() -> String {
    let info = json!({ "windowControls": "native" });
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
