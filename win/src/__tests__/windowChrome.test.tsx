// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import TitleBar from "../app/TitleBar";
import { WindowBar } from "../app/WindowControls";
import { translations } from "../translations";

const win = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  isFullscreen: vi.fn(async () => false),
  onResized: vi.fn(async (_handler: () => void) => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
}));

const t = (key: string) => translations.en[key] || key;

const CAPTIONS = ["Minimize", "Maximize", "Close"];

function captionButtons() {
  return CAPTIONS.filter((name) => screen.queryByRole("button", { name }));
}

function nativeControls() {
  window.__DRAGGY_PLATFORM__ = Object.freeze({ windowControls: "native" as const });
}

beforeEach(() => {
  win.isFullscreen.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.__DRAGGY_PLATFORM__;
});

describe("window chrome without platform info", () => {
  it("draws the caption buttons in the title bar and leaves no traffic-light space", () => {
    render(<TitleBar t={t} sidebarOpen onToggleSidebar={() => {}} />);
    expect(captionButtons()).toEqual(CAPTIONS);
    expect(screen.queryByTestId("traffic-light-space")).toBeNull();
  });

  it("draws the caption buttons in the bar of screens without a title bar", () => {
    render(<WindowBar t={t} />);
    expect(captionButtons()).toEqual(CAPTIONS);
  });
});

describe("window chrome with native controls", () => {
  it("leaves the caption buttons to the system and keeps the traffic lights clear", () => {
    nativeControls();
    render(<TitleBar t={t} sidebarOpen onToggleSidebar={() => {}} />);
    expect(captionButtons()).toEqual([]);
    expect(screen.getByTestId("traffic-light-space")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hide sidebar/ })).toBeTruthy();
  });

  it("keeps a drag strip without buttons on screens without a title bar", () => {
    nativeControls();
    const { container } = render(<WindowBar t={t} />);
    expect(captionButtons()).toEqual([]);
    expect(container.querySelector("[data-tauri-drag-region]")).toBeTruthy();
  });

  it("gives the space back in fullscreen, where the traffic lights hide", async () => {
    nativeControls();
    win.isFullscreen.mockResolvedValue(true);
    render(<TitleBar t={t} sidebarOpen onToggleSidebar={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId("traffic-light-space")).toBeNull());
  });
});
