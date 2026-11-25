// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import Sidebar from "../app/Sidebar";
import TitleBar from "../app/TitleBar";
import { ComposerQueueContext, type ComposerQueue } from "../chat/Composer";
import type { PlatformInfo } from "../platform/info";
import { GREETINGS, pickGreeting } from "../greetings";
import { translations } from "../translations";
import { CommandPalette } from "../ui/CommandPalette";
import { Dock } from "../ui/dock/Dock";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";
import { ShortcutsSheet } from "../ui/ShortcutsSheet";

const t = (key: string) => translations.en[key] || key;

// What the macOS shell hands the renderer, from the case its Rust test checks the boot script against.
const FILE = path.resolve(import.meta.dirname, "../../../shared/fixtures/platform/info.json");
const MACOS = (JSON.parse(fs.readFileSync(FILE, "utf8")) as { cases: { expected: PlatformInfo }[] }).cases[0].expected;

function onMac() {
  window.__DRAGGY_PLATFORM__ = Object.freeze({ ...MACOS });
}

afterEach(() => {
  cleanup();
  delete window.__DRAGGY_PLATFORM__;
});

function renderSidebar() {
  return render(
    <Sidebar
      mode="chat"
      codeHome={false}
      activeWorkspaceId="w1"
      projects={[]}
      runningSessionIds={[]}
      sessions={[]}
      t={t}
      onSwitchMode={() => {}}
      onNewChat={() => {}}
      onNewProject={() => {}}
      onSelectChat={() => {}}
      onDeleteChat={() => {}}
      onOpenSettings={() => {}}
      onSelectWorkspace={() => {}}
      onRemoveWorkspace={() => {}}
      onOpenPalette={() => {}}
      open={true}
      onToggleOpen={() => {}}
    />,
  );
}

function shortcutsSheetKeys() {
  render(<ShortcutsSheet open onClose={() => {}} t={t} />);
  return Array.from(screen.getByRole("dialog").querySelectorAll("kbd"), (kbd) => kbd.textContent);
}

function renderTitleBarViews() {
  render(<TitleBar t={t} sidebarOpen onToggleSidebar={() => {}} onChangeViewMode={() => {}} viewMode="normal" onOpenFiles={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Views/ }));
}

describe("shortcut labels on Windows", () => {
  it("the sidebar writes Ctrl as it always has", () => {
    renderSidebar();
    expect(screen.getByText("Ctrl+N")).toBeTruthy();
    expect(screen.getByText("Ctrl+K")).toBeTruthy();
    expect(screen.getByText("Ctrl+,")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("settings") }).getAttribute("title")).toBe(`${t("settings")} (Ctrl+,)`);
  });

  it("the shortcuts sheet lists the same keys as before", () => {
    expect(shortcutsSheetKeys()).toEqual([
      "Ctrl+K", "Ctrl+Shift+P", "Ctrl+/", "Ctrl+,", "Ctrl+B", "Esc",
      "Ctrl+N", "Ctrl+Shift+X", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+O",
      "Ctrl+Shift+F", "Ctrl+Shift+D", "Ctrl+Shift+B", "Ctrl+Shift+L", "Ctrl+Shift+T", "Ctrl+Alt+B", "Ctrl+\\", "Ctrl+Shift+Space",
      "Ctrl+Shift+M", "Ctrl+Shift+I", "Ctrl+Shift+E", "@",
    ]);
  });

  it("the title bar's tooltip and Views menu keep Ctrl", () => {
    renderTitleBarViews();
    expect(screen.getByRole("button", { name: "Hide sidebar (Ctrl+B)" })).toBeTruthy();
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Ctrl+O")).toBeTruthy();
    expect(within(menu).getByText("Ctrl+Shift+F")).toBeTruthy();
  });
});

describe("shortcut labels on a Mac", () => {
  it("the sidebar writes Command with no plus sign", () => {
    onMac();
    renderSidebar();
    expect(screen.getByText("⌘N")).toBeTruthy();
    expect(screen.getByText("⌘K")).toBeTruthy();
    expect(screen.getByText("⌘,")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("settings") }).getAttribute("title")).toBe(`${t("settings")} (⌘,)`);
    expect(document.body.textContent).not.toContain("Ctrl");
  });

  it("the shortcuts sheet writes Mac keys, with Control kept for switching sessions", () => {
    onMac();
    expect(shortcutsSheetKeys()).toEqual([
      "⌘K", "⇧⌘P", "⌘/", "⌘,", "⌘B", "Esc",
      "⌘N", "⇧⌘X", "⌃⇥", "⌃⇧⇥", "⌘O",
      "⇧⌘F", "⇧⌘D", "⇧⌘B", "⇧⌘L", "⇧⌘T", "⌥⌘B", "⌘\\", "⇧⌘Space",
      "⇧⌘M", "⇧⌘I", "⇧⌘E", "@",
    ]);
  });

  it("the title bar's tooltip and Views menu write Command", () => {
    onMac();
    renderTitleBarViews();
    expect(screen.getByRole("button", { name: "Hide sidebar (⌘B)" })).toBeTruthy();
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("⌘O")).toBeTruthy();
    expect(within(menu).getByText("⇧⌘F")).toBeTruthy();
  });

  it("the greeting about undo names Command", () => {
    const undo = GREETINGS.en.indexOf("Mod+Z is a superpower");
    const seed = Array.from({ length: 8000 }, (_, i) => `chat-${i}`).find((id) => pickGreeting("en", id).includes("superpower"));
    expect(undo).toBeGreaterThanOrEqual(0);
    expect(pickGreeting("en", seed!)).toBe("Ctrl+Z is a superpower");
    onMac();
    expect(pickGreeting("en", seed!)).toBe("⌘Z is a superpower");
  });

  it("the command palette writes its items' keys the Mac way", () => {
    onMac();
    render(
      <CommandPalette open onClose={() => {}} t={t} items={[{ id: "n", label: "New", category: "Actions", shortcut: "Mod+N", onSelect: () => {} }]} />,
    );
    expect(screen.getByText("⌘N")).toBeTruthy();
  });
});

describe("shortcut keys on a Mac", () => {
  const layout = { panes: ["plan", "file"], active: "file", width: 450, file: "main.ts", split: null } as const;

  function renderDock(onClosePane: (pane: string) => void) {
    render(
      <Dock
        layout={{ ...layout, panes: [...layout.panes] }}
        width={450}
        t={t}
        paneTitles={{ plan: "Plan", file: "main.ts" }}
        renderPane={(pane) => <div>{pane}</div>}
        onSelectPane={() => {}}
        onClosePane={onClosePane}
        onMovePane={() => {}}
      />,
    );
  }

  it("Command-backslash closes the pane and Control-backslash does not", () => {
    onMac();
    const onClosePane = vi.fn();
    renderDock(onClosePane);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(onClosePane).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(onClosePane).toHaveBeenCalledWith("file");
  });

  it("Command-Return queues a message while a reply runs, and the hint says so", () => {
    onMac();
    const queue = {
      chatId: "preview",
      queue: [{ id: "a", content: "first note" }],
      enqueue: vi.fn(),
      steer: vi.fn(),
      sendNow: vi.fn(),
      editQueued: vi.fn(),
      removeQueued: vi.fn(),
      moveQueued: vi.fn(),
      sendQueuedNow: vi.fn(),
    } satisfies ComposerQueue;
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating attachedFiles={[]} />
      </ComposerQueueContext.Provider>,
    );
    const field = document.querySelector<HTMLTextAreaElement>("form textarea")!;
    fireEvent.change(field, { target: { value: "later thing" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    expect(queue.enqueue).toHaveBeenCalledWith("later thing", []);
    expect(screen.getByText("⌘↩")).toBeTruthy();
    expect(screen.getByText("⇧⌘↩")).toBeTruthy();
  });
});
