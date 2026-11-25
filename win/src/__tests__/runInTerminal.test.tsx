// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createDefaultDockLayout } from "../app/dockLayout";
import { useShellTabs } from "../terminal/useShellTabs";
import { allSessions, resetSessions } from "../terminal/terminalSessions";
import { requestPrefill, resetTerminalBus } from "../terminal/terminalBus";
import type { ShellId } from "../terminal/shells";
import { translations } from "../translations";
import { platformInfo, type PlatformInfo } from "../platform/info";

/** "Run in terminal" puts a model's code block on a prompt. Nothing may run until a person presses Enter. */

const t = (key: string) => translations.en[key] || key;

vi.mock("../terminal/xtermView", () => ({
  createTerminalView: vi.fn(async () => ({
    write: vi.fn(),
    focus: vi.fn(),
    fit: () => ({ cols: 90, rows: 25 }),
    size: () => ({ cols: 90, rows: 25 }),
    selection: () => "",
    dispose: vi.fn(),
  })),
}));

let exit: (event: { id: string; exitCode: number }) => void = () => {};
let shell: Record<string, ReturnType<typeof vi.fn>>;
let counter = 0;
let opensAs: string[] = [];

beforeEach(() => {
  counter = 0;
  opensAs = [];
  shell = {
    open: vi.fn(async (_workspace: string, options: { shell?: string }) => ({
      success: true,
      id: `pty-${++counter}`,
      shell: opensAs.shift() ?? options.shell ?? "bash",
    })),
    write: vi.fn(),
    resize: vi.fn(async () => true),
    close: vi.fn(async () => true),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn((cb) => {
      exit = cb;
      return () => {};
    }),
  };
  (window as unknown as { draggy: unknown }).draggy = { shell };
});

afterEach(() => {
  cleanup();
  resetSessions();
  resetTerminalBus();
});

function Harness() {
  const [layout, setLayout] = useState(createDefaultDockLayout());
  const tabs = useShellTabs({ workspaceId: "w1", defaultShell: "auto", layout, onLayoutChange: setLayout, onMessage: () => {}, t });
  return <button onClick={() => void tabs.openShell()}>new shell</button>;
}

type Tabs = "none" | "bash" | "zsh" | "exited";

async function withTab(tabs: Tabs): Promise<void> {
  render(<Harness />);
  if (tabs === "none") return;
  if (tabs === "zsh") opensAs.push("/bin/zsh");
  fireEvent.click(screen.getByText("new shell"));
  await waitFor(() => expect(allSessions()).toHaveLength(1));
  if (tabs === "exited") act(() => exit({ id: "pty-1", exitCode: 0 }));
  shell.open.mockClear();
}

const TEXTS = {
  single: { command: "echo a", bytes: "echo a" },
  multi: { command: "echo a\necho b", bytes: "\u001b[200~echo a\necho b\u001b[201~" },
  crlf: { command: "echo a\r\necho b", bytes: "\u001b[200~echo a\necho b\u001b[201~" },
  cr: { command: "echo a\rrm x", bytes: "echo arm x" },
  separator: { command: "echo a rm x", bytes: "echo a rm x" },
};

// Today's code, pinned: which shell a click opens and which session gets which bytes.
const WINDOWS: Array<{ tabs: Tabs; shell: ShellId; opens: string | null; target: string }> = [
  { tabs: "none", shell: "bash", opens: "bash", target: "pty-1" },
  { tabs: "bash", shell: "bash", opens: null, target: "pty-1" },
  { tabs: "zsh", shell: "bash", opens: "bash", target: "pty-2" },
  { tabs: "exited", shell: "bash", opens: "bash", target: "pty-2" },
  { tabs: "bash", shell: "pwsh", opens: "pwsh", target: "pty-2" },
];

describe("the paste capability", () => {
  it("is reported by the macOS shell and assumed everywhere else", () => {
    const file = path.resolve(import.meta.dirname, "../../../shared/fixtures/platform/info.json");
    const macos = (JSON.parse(fs.readFileSync(file, "utf8")) as { cases: { expected: PlatformInfo }[] }).cases[0].expected;
    expect(macos.pasteMode).toBe("reported");
    expect(platformInfo().pasteMode).toBe("assumed");
  });
});

describe("Run in terminal on Windows keeps today's behaviour", () => {
  for (const row of WINDOWS) {
    for (const [name, text] of Object.entries(TEXTS)) {
      it(`${row.shell} block, ${row.tabs} tab, ${name} text`, async () => {
        await withTab(row.tabs);
        act(() => requestPrefill({ command: text.command, shell: row.shell }));

        await waitFor(() => expect(shell.write).toHaveBeenCalled());
        expect(shell.write.mock.calls).toEqual([[row.target, text.bytes]]);
        if (row.opens) expect(shell.open.mock.calls).toEqual([["w1", { shell: row.opens, defaultShell: undefined }]]);
        else expect(shell.open).not.toHaveBeenCalled();
      });
    }
  }

  it("waits 400 ms after opening a shell before writing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      render(<Harness />);
      act(() => requestPrefill({ command: "echo a\necho b", shell: "bash" }));
      await act(async () => await vi.advanceTimersByTimeAsync(399));
      expect(shell.write).not.toHaveBeenCalled();
      await act(async () => await vi.advanceTimersByTimeAsync(1));
      expect(shell.write).toHaveBeenCalledWith("pty-1", "\u001b[200~echo a\necho b\u001b[201~");
    } finally {
      vi.useRealTimers();
    }
  });
});
