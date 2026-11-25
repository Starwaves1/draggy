// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeBlock } from "../chat/CodeBlock";
import { onPrefill, resetTerminalBus, shellForLanguage } from "../terminal/terminalBus";

/** A shell code block offers Run in terminal; it fills a prompt and never runs anything. */

afterEach(() => {
  delete window.__DRAGGY_PLATFORM__;
  cleanup();
  resetTerminalBus();
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

  it("is offered on a Mac only for the shells every Mac has", () => {
    window.__DRAGGY_PLATFORM__ = { windowControls: "native", readyAt: "frameCommitted", shortcuts: "command", pasteMode: "reported" };
    for (const language of ["bash", "sh", "zsh", "shell"]) {
      render(<CodeBlock language={language} value="ls" />);
      expect(screen.getByText("Run in terminal")).toBeTruthy();
      cleanup();
    }
    for (const language of ["powershell", "pwsh", "ps1", "cmd", "bat"]) {
      render(<CodeBlock language={language} value="dir" />);
      expect(screen.queryByText("Run in terminal")).toBeNull();
      cleanup();
    }
  });

  it("maps languages to shells", () => {
    expect(shellForLanguage("sh")).toBe("bash");
    expect(shellForLanguage("bat")).toBe("cmd");
    expect(shellForLanguage("python")).toBeUndefined();
  });
});
