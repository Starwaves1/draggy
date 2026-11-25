// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TerminalPane from "../terminal/TerminalPane";
import { createDefaultDockLayout, terminalIdOf } from "../app/dockLayout";
import { useShellTabs } from "../terminal/useShellTabs";
import { allSessions, closeSession, prefillSession, resetSessions, sessionLabels, shellName } from "../terminal/terminalSessions";
import { appendAgentBlock, finishAgentBlock, requestPrefill, resetTerminalBus, startAgentBlock, takePrefill } from "../terminal/terminalBus";
import { CodeBlock } from "../chat/CodeBlock";
import type { PlatformInfo } from "../platform/info";
import { translations } from "../translations";

/** Each shell is a dock tab. Opening one starts it in the project, a code block's command lands on a
 * prompt without running, and the agent's commands show read-only. */

const t = (key: string) => translations.en[key] || key;

const views: Array<{ write: ReturnType<typeof vi.fn> }> = [];

vi.mock("../terminal/xtermView", () => ({
  createTerminalView: vi.fn(async () => {
    const view = {
      write: vi.fn(),
      focus: vi.fn(),
      fit: () => ({ cols: 90, rows: 25 }),
      size: () => ({ cols: 90, rows: 25 }),
      selection: () => "",
      dispose: vi.fn(),
    };
    views.push(view);
    return view;
  }),
}));

let data: (event: { id: string; data: string }) => void = () => {};
let exit: (event: { id: string; exitCode: number }) => void = () => {};
let shell: Record<string, ReturnType<typeof vi.fn>>;
let counter = 0;

beforeEach(() => {
  views.length = 0;
  counter = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  shell = {
    open: vi.fn(async (_workspace: string, options: { shell?: string }) => ({
      success: true,
      id: `pty-${++counter}`,
      shell: options.shell ?? "bash",
    })),
    write: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    close: vi.fn(async () => true),
    onData: vi.fn((cb) => {
      data = cb;
      return () => {};
    }),
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
  vi.unstubAllGlobals();
  delete window.__DRAGGY_PLATFORM__;
});

// What the macOS shell hands the renderer, from the case its Rust test checks the boot script against.
const FILE = path.resolve(import.meta.dirname, "../../../shared/fixtures/platform/info.json");
const MACOS = (JSON.parse(fs.readFileSync(FILE, "utf8")) as { cases: { expected: PlatformInfo }[] }).cases[0].expected;

/** A person's click: jsdom cannot make a trusted event, so the button's own handler gets one by hand. */
function personClicks(element: HTMLElement) {
  const button = element.closest("button") as HTMLButtonElement;
  const key = Object.keys(button).find((name) => name.startsWith("__reactProps$")) as keyof HTMLButtonElement;
  act(() => (button[key] as unknown as { onClick: (event: { isTrusted: boolean }) => void }).onClick({ isTrusted: true }));
}

/** Lets a prefill that slipped through open its shell and pass the 400 ms wait before it writes. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 500)));

let messages: string[] = [];

/** The app's side of the tabs: a layout that gains a tab per shell, and the pane each tab shows. */
function Harness() {
  const [layout, setLayout] = useState(createDefaultDockLayout());
  const tabs = useShellTabs({ workspaceId: "w1", defaultShell: "auto", layout, onLayoutChange: setLayout, onMessage: (text) => messages.push(text), t });
  return (
    <div>
      <button onClick={() => void tabs.openShell()}>new shell</button>
      <button onClick={tabs.showTerminal}>show terminal</button>
      <ul>
        {layout.panes.map((pane) => (
          <li key={pane} data-testid="tab">
            {sessionLabels("w1").get(terminalIdOf(pane) ?? "")}
            <TerminalPane sessionId={terminalIdOf(pane) ?? ""} t={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

describe("shell tabs", () => {
  beforeEach(() => {
    messages = [];
  });

  it("opens a shell in the workspace as one named tab and sends the fitted size", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("show terminal"));

    await waitFor(() => expect(shell.open).toHaveBeenCalledWith("w1", { shell: undefined, defaultShell: undefined }));
    await waitFor(() => expect(shell.resize).toHaveBeenCalledWith("pty-1", 90, 25));
    expect(screen.getAllByTestId("tab")).toHaveLength(1);
    expect(screen.getByText("Bash")).toBeTruthy();
  });

  it("brings the open shell forward instead of starting another", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("show terminal"));
    await waitFor(() => expect(screen.getAllByTestId("tab")).toHaveLength(1));

    fireEvent.click(screen.getByText("show terminal"));
    expect(shell.open).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("tab")).toHaveLength(1);
  });

  it("numbers a second shell of the same kind", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(screen.getAllByTestId("tab")).toHaveLength(1));
    fireEvent.click(screen.getByText("new shell"));

    expect(await screen.findByText("Bash 2")).toBeTruthy();
  });

  it("names PowerShell and pwsh the same", () => {
    expect(shellName("powershell")).toBe("Pwsh");
    expect(shellName("pwsh.exe")).toBe("Pwsh");
    expect(shellName("cmd")).toBe("CMD");
    expect(shellName("zsh")).toBe("Zsh");
  });

  it("names a Mac shell by the file its path ends in", async () => {
    expect(shellName("/bin/zsh")).toBe("Zsh");
    expect(shellName("/opt/homebrew/bin/fish")).toBe("Fish");
    shell.open.mockImplementation(async () => ({ success: true, id: `pty-${++counter}`, shell: "/bin/zsh" }));
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    expect(await screen.findByText("Zsh")).toBeTruthy();
    fireEvent.click(screen.getByText("new shell"));
    expect(await screen.findByText("Zsh 2")).toBeTruthy();
  });

  it("shows output and keeps the shell until it is closed", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => data({ id: "pty-1", data: "hello" }));
    expect(views[0].write).toHaveBeenCalledWith("hello");

    act(() => closeSession("pty-1"));
    expect(shell.close).toHaveBeenCalledWith("pty-1");
  });

  it("marks a shell that ended so its tab can say so", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => exit({ id: "pty-1", exitCode: 3 }));
    expect(allSessions()[0]).toMatchObject({ exited: true, exitCode: 3 });
  });

  it("says so when the terminal is not available", async () => {
    (window as unknown as { draggy: unknown }).draggy = {
      shell: { ...shell, open: vi.fn(async () => ({ success: false, unavailable: true })) },
    };
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));

    await waitFor(() => expect(messages).toContain(translations.en.terminalUnavailable));
    expect(screen.queryAllByTestId("tab")).toHaveLength(0);
  });

  it("puts a command on the prompt without pressing Enter", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => requestPrefill({ command: "npm test\n", shell: "bash" }));
    await waitFor(() => expect(shell.write).toHaveBeenCalledWith("pty-1", "npm test"));
    expect(shell.write.mock.calls.every(([, text]) => !String(text).includes("\r"))).toBe(true);
  });

  it("sends a multi-line command as a paste", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => requestPrefill({ command: "echo a\necho b", shell: "bash" }));
    await waitFor(() => expect(shell.write).toHaveBeenCalledWith("pty-1", "\u001b[200~echo a\necho b\u001b[201~"));
  });

  it("starts a shell of the right kind for a command when none matches", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));

    act(() => requestPrefill({ command: "Get-Date", shell: "pwsh" }));
    await waitFor(() => expect(shell.open).toHaveBeenCalledWith("w1", { shell: "pwsh", defaultShell: undefined }));
  });

  it("shows the agent's commands as read-only blocks", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));
    act(() => startAgentBlock({ id: "r1", command: "git status", shell: "bash" }));
    act(() => appendAgentBlock("r1", "clean"));
    act(() => finishAgentBlock("r1", { status: "done", exitCode: 0 }));

    expect(await screen.findByText("git status")).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
    expect(screen.getByText("exit 0")).toBeTruthy();
    expect(screen.getByText("git status").closest("[data-status]")?.querySelector("textarea,input")).toBeNull();
  });

  it("writes a clicked block's exact text to the open shell on Windows", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));

    render(<CodeBlock language="bash" value={"npm test\n"} />);
    personClicks(screen.getByText("Run in terminal"));
    await waitFor(() => expect(shell.write).toHaveBeenCalledWith("pty-1", "npm test"));
    cleanup();

    render(<Harness />);
    render(<CodeBlock language="sh" value={"echo a\necho b"} />);
    personClicks(screen.getByText("Run in terminal"));
    await waitFor(() => expect(shell.write).toHaveBeenCalledWith("pty-1", "\u001b[200~echo a\necho b\u001b[201~"));
    expect(shell.write).toHaveBeenCalledTimes(2);
  });
});

describe("shell tabs on macOS", () => {
  beforeEach(() => {
    window.__DRAGGY_PLATFORM__ = Object.freeze({ ...MACOS });
  });

  it("opens no shell and writes nothing for a request when none is open", async () => {
    render(<Harness />);
    for (const command of ["ls", "echo a\necho b"]) {
      act(() => requestPrefill({ command, shell: "bash" }));
      expect(takePrefill()).toBeNull();
    }
    await settle();

    expect(shell.open).not.toHaveBeenCalled();
    expect(shell.write).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("tab")).toHaveLength(0);
  });

  it("writes nothing to an open shell, by request or directly", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("new shell"));
    await waitFor(() => expect(views).toHaveLength(1));

    for (const command of ["ls", "echo a\necho b"]) {
      act(() => requestPrefill({ command, shell: "bash" }));
      act(() => requestPrefill({ command, shell: "pwsh" }));
      expect(prefillSession("pty-1", command)).toBe(false);
    }
    await settle();

    expect(shell.write).not.toHaveBeenCalled();
    expect(shell.open).toHaveBeenCalledTimes(1);
  });
});
