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
import { PASTE_WAIT_MS, planPrefill, promptLines, type PrefillInput, type PrefillStep, type PrefillTarget } from "../terminal/prefill";

/** "Run in terminal" puts a model's code block on a prompt. Nothing may run until a person presses Enter. */

const t = (key: string) => translations.en[key] || key;

/** Each view's paste-mode callback, so a test can play the shell turning bracketed paste on. */
const views = vi.hoisted(() => [] as Array<{ pasteMode: (on: boolean) => void; focus: () => void }>);

vi.mock("../terminal/xtermView", () => ({
  createTerminalView: vi.fn(async (_host: HTMLElement, options: { onPasteMode?: (on: boolean) => void }) => {
    const view = {
      write: vi.fn(),
      focus: vi.fn(),
      fit: () => ({ cols: 90, rows: 25 }),
      size: () => ({ cols: 90, rows: 25 }),
      selection: () => "",
      dispose: vi.fn(),
    };
    views.push({ pasteMode: (on) => options.onPasteMode?.(on), focus: view.focus });
    return view;
  }),
}));

let exit: (event: { id: string; exitCode: number }) => void = () => {};
let shell: Record<string, ReturnType<typeof vi.fn>>;
let counter = 0;
let opensAs: string[] = [];

beforeEach(() => {
  views.length = 0;
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
  delete window.__DRAGGY_PLATFORM__;
  vi.useRealTimers();
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
  separator: { command: "echo a\u2028rm x", bytes: "echo a\u2028rm x" },
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

const ON = (id: string, shell: string): PrefillTarget => ({ id, shell, exited: false, bracketedPaste: true });
const OFF = (id: string, shell: string): PrefillTarget => ({ id, shell, exited: false, bracketedPaste: false });
const plan = (command: string, sessions: PrefillTarget[], extra: Partial<PrefillInput> = {}) =>
  planPrefill({ pasteMode: "reported", command, shell: "bash", sessions, activeId: null, opened: [], ...extra });

const MAC_TEXTS = {
  single: { command: "echo a", lines: 1, paste: "echo a" },
  multi: { command: "echo a\necho b", lines: 2, paste: "\u001b[200~echo a\necho b\u001b[201~" },
  cr: { command: "echo a\rrm x", lines: 2, paste: "\u001b[200~echo a\nrm x\u001b[201~" },
  separator: { command: "echo a\u2028rm x", lines: 2, paste: "\u001b[200~echo a\nrm x\u001b[201~" },
};

// The step for each text in each situation: a single line goes anywhere a POSIX shell is live; more
// lines only where the shell has bracketed paste on.
const MAC_SITUATIONS: Array<{ name: string; sessions: PrefillTarget[]; opened?: string[]; single: PrefillStep | "write z"; multi: PrefillStep }> = [
  { name: "no tabs", sessions: [], single: { kind: "open" }, multi: { kind: "open" } },
  { name: "a zsh tab with paste on", sessions: [ON("z", "/bin/zsh")], single: "write z", multi: "write z" as never },
  { name: "a bash tab with paste off", sessions: [OFF("b", "/bin/bash")], single: { kind: "write", id: "b", data: "echo a" }, multi: { kind: "open" } },
  { name: "an exited zsh tab", sessions: [{ ...ON("z", "/bin/zsh"), exited: true }], single: { kind: "open" }, multi: { kind: "open" } },
  {
    name: "a default shell that never turned paste on",
    sessions: [OFF("d", "/bin/bash")],
    opened: ["d"],
    single: { kind: "write", id: "d", data: "echo a" },
    multi: { kind: "open", shell: "/bin/zsh" },
  },
  {
    name: "zsh opened after the default and still without paste",
    sessions: [OFF("d", "/bin/bash"), OFF("z", "/bin/zsh")],
    opened: ["d", "z"],
    single: { kind: "write", id: "d", data: "echo a" },
    multi: { kind: "stop" },
  },
  { name: "a default zsh that never turned paste on", sessions: [OFF("z", "/bin/zsh")], opened: ["z"], single: { kind: "write", id: "z", data: "echo a" }, multi: { kind: "stop" } },
];

describe("planPrefill on macOS", () => {
  for (const situation of MAC_SITUATIONS) {
    for (const [name, text] of Object.entries(MAC_TEXTS)) {
      it(`${name} text, ${situation.name}`, () => {
        const wanted = text.lines === 1 ? situation.single : situation.multi;
        const expected = (wanted as unknown) === "write z" ? { kind: "write", id: "z", data: text.paste } : wanted;
        expect(plan(text.command, situation.sessions, { opened: situation.opened ?? [] })).toEqual(expected);
      });
    }
  }

  it("prefers the active tab among the ready ones and never picks a fish tab for a bash block", () => {
    const sessions = [ON("f", "/opt/homebrew/bin/fish"), ON("z1", "/bin/zsh"), ON("z2", "/bin/zsh")];
    expect(plan("a\nb", sessions, { activeId: "z2" })).toMatchObject({ kind: "write", id: "z2" });
    expect(plan("a\nb", sessions, { activeId: "f" })).toMatchObject({ kind: "write", id: "z1" });
  });

  it("splits on every line terminator and strips the rest of the control characters", () => {
    expect(promptLines("a\r\nb\rc\vd\fe\u0085f\u2028g\u2029h\ni", "reported")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    expect(promptLines("echo \u001b[2Ja\u0007", "reported")).toEqual(["echo [2Ja"]);
  });

  it("never writes text with a line break to a shell whose paste mode is off", () => {
    const texts = [...Object.values(MAC_TEXTS).map((text) => text.command), "a\r\nb", "a\vb", "a\fb", "a\u0085b", "a\u2029b", "x\n"];
    const tabs = [ON("z", "/bin/zsh"), OFF("b", "/bin/bash"), { ...ON("e", "/bin/zsh"), exited: true }, OFF("s", "/bin/sh"), ON("f", "/usr/local/bin/fish"), ON("p", "/usr/local/bin/pwsh")];
    const subsets = Array.from({ length: 1 << tabs.length }, (_, mask) => tabs.filter((_, bit) => mask & (1 << bit)));
    const shells: Array<ShellId | undefined> = [undefined, "bash", "sh", "pwsh", "powershell", "cmd"];
    let writes = 0;
    for (const command of texts) {
      for (const sessions of subsets) {
        for (const shell of shells) {
          for (const opened of [[], sessions.slice(0, 1).map((s) => s.id), sessions.slice(0, 2).map((s) => s.id)]) {
            for (const activeId of [null, ...sessions.map((s) => s.id)]) {
              const step = planPrefill({ pasteMode: "reported", command, shell, sessions, activeId, opened });
              if (step.kind !== "write") continue;
              writes += 1;
              const target = sessions.find((session) => session.id === step.id);
              expect(target?.exited).toBe(false);
              if (/[\n\r\v\f\u0085\u2028\u2029]/.test(step.data)) expect(target?.bracketedPaste).toBe(true);
            }
          }
        }
      }
    }
    expect(writes).toBeGreaterThan(1000);
  });

  it("never opens a shell for a PowerShell or cmd block", () => {
    for (const shell of ["pwsh", "powershell", "cmd"] as const) {
      expect(plan("Get-Date", [ON("z", "/bin/zsh")], { shell })).toEqual({ kind: "stop" });
      expect(plan("Get-Date", [], { shell })).toEqual({ kind: "stop" });
      expect(plan("Get-Date\nGet-Date", [ON("p", "/usr/local/bin/pwsh")], { shell })).toMatchObject(shell === "cmd" ? { kind: "stop" } : { kind: "write", id: "p" });
    }
  });
});

describe("Run in terminal on macOS", () => {
  beforeEach(() => {
    window.__DRAGGY_PLATFORM__ = { windowControls: "native", readyAt: "frameCommitted", shortcuts: "command", pasteMode: "reported" };
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  const advance = (ms: number) => act(async () => await vi.advanceTimersByTimeAsync(ms));

  // A click still waiting on a shell would carry into the next test.
  afterEach(() => advance(PASTE_WAIT_MS * 3));

  it("pastes into a fresh shell once it turns bracketed paste on, however long its prompt took", async () => {
    render(<Harness />);
    act(() => requestPrefill({ command: "touch one\ntouch two\nls", shell: "bash" }));
    await advance(3000);
    expect(shell.open.mock.calls).toEqual([["w1", { shell: undefined, defaultShell: undefined }]]);
    expect(shell.write).not.toHaveBeenCalled();

    act(() => views[0].pasteMode(true));
    await advance(0);
    expect(shell.write.mock.calls).toEqual([["pty-1", "\u001b[200~touch one\ntouch two\nls\u001b[201~"]]);
  });

  it("writes nothing to a shell that never turns paste on, and nothing to zsh after it either", async () => {
    opensAs.push("/bin/bash");
    render(<Harness />);
    act(() => requestPrefill({ command: "touch one\ntouch two\nls", shell: "bash" }));
    await advance(PASTE_WAIT_MS - 1);
    expect(shell.open).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(shell.open.mock.calls[1]).toEqual(["w1", { shell: "/bin/zsh", defaultShell: undefined }]);
    await advance(PASTE_WAIT_MS * 3);
    expect(shell.open).toHaveBeenCalledTimes(2);
    expect(shell.write).not.toHaveBeenCalled();
    expect(views[1].focus).toHaveBeenCalled();
  });

  it("pastes into zsh when the login shell is bash 3.2", async () => {
    opensAs.push("/bin/bash");
    render(<Harness />);
    act(() => requestPrefill({ command: "touch one\nls", shell: "bash" }));
    await advance(PASTE_WAIT_MS);
    await advance(800);
    act(() => views[1].pasteMode(true));
    await advance(0);
    expect(shell.write.mock.calls).toEqual([["pty-2", "\u001b[200~touch one\nls\u001b[201~"]]);
  });

  it("plans again after showing the tab, so a shell that has just left its prompt gets nothing", async () => {
    opensAs.push("/bin/zsh");
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await advance(0);
    act(() => views[0].pasteMode(true));
    act(() => requestPrefill({ command: "touch one\nls", shell: "bash" }));
    act(() => views[0].pasteMode(false));
    await advance(0);
    expect(shell.write).not.toHaveBeenCalled();
    expect(shell.open).toHaveBeenCalledTimes(2);
  });

  it("stops waiting when the fresh shell exits", async () => {
    render(<Harness />);
    act(() => requestPrefill({ command: "touch one\nls", shell: "bash" }));
    await advance(100);
    act(() => exit({ id: "pty-1", exitCode: 1 }));
    await advance(0);
    expect(shell.open).toHaveBeenCalledTimes(2);
  });
});

describe("Run in terminal on macOS reuses its tab", () => {
  beforeEach(() => {
    window.__DRAGGY_PLATFORM__ = { windowControls: "native", readyAt: "frameCommitted", shortcuts: "command", pasteMode: "reported" };
  });

  it("opens one shell for repeated clicks on bash, sh and zsh blocks", async () => {
    opensAs.push("/bin/zsh");
    render(<Harness />);
    act(() => requestPrefill({ command: "echo a\necho b", shell: "bash" }));
    await waitFor(() => expect(views).toHaveLength(1));
    act(() => views[0].pasteMode(true));
    await waitFor(() => expect(shell.write).toHaveBeenCalledTimes(1));

    for (const command of ["echo c\necho d", "echo e", "echo f\necho g"]) {
      act(() => requestPrefill({ command, shell: "bash" }));
    }
    await waitFor(() => expect(shell.write).toHaveBeenCalledTimes(4));
    expect(shell.open).toHaveBeenCalledTimes(1);
    expect(new Set(shell.write.mock.calls.map(([id]) => id))).toEqual(new Set(["pty-1"]));
  });

  it("opens nothing and writes nothing for a PowerShell block, however often it is clicked", async () => {
    opensAs.push("/bin/zsh");
    await withTab("zsh");
    act(() => views[0].pasteMode(true));
    for (let click = 0; click < 3; click += 1) act(() => requestPrefill({ command: "Get-Date", shell: "pwsh" }));
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 50)));
    expect(shell.open).not.toHaveBeenCalled();
    expect(shell.write).not.toHaveBeenCalled();
    expect(allSessions()).toHaveLength(1);
  });
});
