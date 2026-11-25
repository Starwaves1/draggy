import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { useTranslator } from "../i18n";
import { logSwallow, swallowed } from "../logger";
import { platformInfo } from "../platform/info";

/** The current window, or null outside Tauri (tests, plain browser preview). */
function currentWindow(): Window | null {
  try {
    return getCurrentWindow();
  } catch (error) {
    logSwallow("window-controls", error, "not running in Tauri");
    return null;
  }
}

function run(action: (win: Window) => Promise<void>) {
  const win = currentWindow();
  if (win) void action(win).catch(swallowed("window-controls", "window command failed"));
}

const READ = {
  maximized: (win: Window) => win.isMaximized(),
  fullscreen: (win: Window) => win.isFullscreen(),
} as const;

/** Whether the window is maximized or fullscreen, read again on every resize. */
function useWindowState(state: keyof typeof READ, enabled: boolean): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    const win = enabled ? currentWindow() : null;
    if (!win) return;
    let active = true;
    const sync = () => {
      void READ[state](win)
        .then((next) => {
          if (active) setValue(next);
        })
        .catch(swallowed("window-controls", `${state} state read failed`));
    };
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      active = false;
      void unlisten.then((stop) => stop()).catch(swallowed("window-controls", "unlisten failed"));
    };
  }, [state, enabled]);

  return value;
}

// Segoe Fluent Icons code points, as the Windows 11 caption buttons draw them.
const GLYPH = {
  minimize: "",
  maximize: "",
  restore: "",
  close: "",
} as const;

const BUTTON =
  "inline-flex h-10 w-[46px] shrink-0 items-center justify-center text-text-primary transition-colors duration-120 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary";

export interface WindowControlsProps {
  t: (key: string) => string;
}

// Minimize, maximize/restore and close for the undecorated main window, in the title bar's right end.
export function WindowControls({ t }: WindowControlsProps) {
  const restore = useWindowState("maximized", true);
  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        aria-label={t("windowMinimize")}
        title={t("windowMinimize")}
        className={`${BUTTON} hover:bg-surface-tint`}
        onClick={() => run((win) => win.minimize())}
      >
        <span aria-hidden="true" className="font-['Segoe_Fluent_Icons','Segoe_MDL2_Assets'] text-[10px]">
          {GLYPH.minimize}
        </span>
      </button>
      <button
        type="button"
        aria-label={restore ? t("windowRestore") : t("windowMaximize")}
        title={restore ? t("windowRestore") : t("windowMaximize")}
        className={`${BUTTON} hover:bg-surface-tint`}
        onClick={() => run((win) => win.toggleMaximize())}
      >
        <span aria-hidden="true" className="font-['Segoe_Fluent_Icons','Segoe_MDL2_Assets'] text-[10px]">
          {restore ? GLYPH.restore : GLYPH.maximize}
        </span>
      </button>
      <button
        type="button"
        aria-label={t("windowClose")}
        title={t("windowClose")}
        className={`${BUTTON} hover:bg-[#c42b1c] hover:text-white`}
        onClick={() => run((win) => win.close())}
      >
        <span aria-hidden="true" className="font-['Segoe_Fluent_Icons','Segoe_MDL2_Assets'] text-[10px]">
          {GLYPH.close}
        </span>
      </button>
    </div>
  );
}

/** Keeps title-bar content out from under the system's traffic lights. The lights hide in
 * fullscreen, so the space goes with them. */
export function TrafficLightSpace() {
  const native = platformInfo().windowControls === "native";
  const fullscreen = useWindowState("fullscreen", native);
  if (!native || fullscreen) return null;
  return <div data-tauri-drag-region data-testid="traffic-light-space" className="h-10 w-[var(--traffic-light-space)] shrink-0" />;
}

/** A 40px drag strip with the caption buttons, for screens that have no TitleBar. */
export function WindowBar({ t }: WindowControlsProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-10 w-full shrink-0 items-stretch justify-end border-b border-rule bg-surface-canvas"
    >
      {platformInfo().windowControls === "drawn" && <WindowControls t={t} />}
    </div>
  );
}

/** Gives a screen with no TitleBar a drag strip and caption buttons, so the undecorated window can move and close. */
export function WindowFrame({ language, children }: { language: string; children: ReactNode }) {
  const t = useTranslator(language);
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-canvas text-text-primary">
      <WindowBar t={t} />
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}
