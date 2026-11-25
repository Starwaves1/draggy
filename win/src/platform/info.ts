/** What the shell can do where platforms differ. The renderer asks here about capabilities, never the OS name. */

/** Who draws minimize, maximize and close: the title bar ("drawn") or the system ("native"). */
export type WindowControls = "drawn" | "native";

/** When the page reports its first paint: as the frame starts, or once it is committed (the shell then
 * shows the window instantly). */
export type ReadyAt = "frameStarted" | "frameCommitted";

/** Which key leads the app's shortcuts. Command also means they are written with the Mac's symbols. */
export type Shortcuts = "ctrl" | "command";

export interface PlatformInfo {
  windowControls: WindowControls;
  readyAt: ReadyAt;
  shortcuts: Shortcuts;
}

declare global {
  interface Window {
    /** Set by the shell before any page script runs, so the first frame already has the right chrome. */
    __DRAGGY_PLATFORM__?: PlatformInfo;
  }
}

/** Windows sets no global, and neither do tests, a plain browser or Node, which has no window. */
const WINDOWS: PlatformInfo = { windowControls: "drawn", readyAt: "frameStarted", shortcuts: "ctrl" };

export function platformInfo(): PlatformInfo {
  return (typeof window === "undefined" ? undefined : window.__DRAGGY_PLATFORM__) ?? WINDOWS;
}
