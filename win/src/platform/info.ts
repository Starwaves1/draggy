/** What the shell can do where platforms differ. The renderer asks here about capabilities, never the OS name. */

/** Who draws minimize, maximize and close: the title bar ("drawn") or the system ("native"). */
export type WindowControls = "drawn" | "native";

export interface PlatformInfo {
  windowControls: WindowControls;
}

declare global {
  interface Window {
    /** Set by the shell before any page script runs, so the first frame already has the right chrome. */
    __DRAGGY_PLATFORM__?: PlatformInfo;
  }
}

/** Windows sets no global, and neither do tests or a plain browser. */
const WINDOWS: PlatformInfo = { windowControls: "drawn" };

export function platformInfo(): PlatformInfo {
  return window.__DRAGGY_PLATFORM__ ?? WINDOWS;
}
