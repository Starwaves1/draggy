// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeBlock } from "../chat/CodeBlock";
import type { PlatformInfo } from "../platform/info";
import { onPrefill, requestPrefill, resetTerminalBus, shellForLanguage, takePrefill } from "../terminal/terminalBus";

/** A shell code block offers Run in terminal; it fills a prompt and never runs anything. */

// What the macOS shell hands the renderer, from the case its Rust test checks the boot script against.
const FILE = path.resolve(import.meta.dirname, "../../../shared/fixtures/platform/info.json");
const MACOS = (JSON.parse(fs.readFileSync(FILE, "utf8")) as { cases: { expected: PlatformInfo }[] }).cases[0].expected;

const SHELL_LANGUAGES = ["bash", "shell", "sh", "zsh", "powershell", "pwsh", "ps1", "cmd", "batch", "bat"];

afterEach(() => {
  cleanup();
  resetTerminalBus();
  delete window.__DRAGGY_PLATFORM__;
});

describe("Run in terminal", () => {
  it("is offered for shell languages only", () => {
    render(<CodeBlock language="bash" value="ls" />);
    expect(screen.getByText("Run in terminal")).toBeTruthy();
    cleanup();
    render(<CodeBlock language="typescript" value="const a = 1" />);
    expect(screen.queryByText("Run in terminal")).toBeNull();
  });

  it("ignores a click a script made, since only a person's click may fill a prompt", () => {
    const seen = vi.fn();
    const dispose = onPrefill(seen);
    render(<CodeBlock language="powershell" value="Get-Date" />);

    fireEvent.click(screen.getByText("Run in terminal"));
    expect(seen).not.toHaveBeenCalled();
    dispose();
  });

  it("is offered on Windows for every shell language and no other", () => {
    for (const language of SHELL_LANGUAGES) {
      render(<CodeBlock language={language} value="ls" />);
      expect(screen.queryByText("Run in terminal"), language).not.toBeNull();
      cleanup();
    }
    render(<CodeBlock language="python" value="print(1)" />);
    expect(screen.queryByText("Run in terminal")).toBeNull();
  });

  it("maps languages to shells", () => {
    expect(shellForLanguage("sh")).toBe("bash");
    expect(shellForLanguage("bat")).toBe("cmd");
    expect(shellForLanguage("python")).toBeUndefined();
  });
});

describe("Run in terminal on macOS", () => {
  it("is withheld by name in the shell's info, not by a missing field", () => {
    expect(MACOS.codeToTerminal).toBe("withheld");
  });

  it("is not offered for any shell language, and copying still is", () => {
    window.__DRAGGY_PLATFORM__ = Object.freeze({ ...MACOS });
    for (const language of SHELL_LANGUAGES) {
      render(<CodeBlock language={language} value={"echo a\necho b"} />);
      expect(screen.queryByText("Run in terminal"), language).toBeNull();
      expect(screen.getByText("Copy"), language).toBeTruthy();
      cleanup();
    }
  });

  it("drops a request, so no pane hears it and none is left waiting", () => {
    window.__DRAGGY_PLATFORM__ = Object.freeze({ ...MACOS });
    const seen = vi.fn();
    const dispose = onPrefill(seen);
    for (const command of ["ls", "echo a\necho b"]) {
      requestPrefill({ command, shell: "bash" });
      expect(takePrefill(), command).toBeNull();
    }
    expect(seen).not.toHaveBeenCalled();
    dispose();
  });
});
