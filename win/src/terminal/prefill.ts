import type { PasteMode } from "../platform/info";
import type { ShellId } from "./shells";
import { promptText } from "./terminalBus";
import { shellName } from "./terminalSessions";

/** Where a command from a code block goes. Decided here and nowhere else, from plain data, so the rule
 * that model text never runs on a click is tested without a terminal. */

export interface PrefillTarget {
  id: string;
  shell: string;
  exited: boolean;
  /** The shell's line editor asked for bracketed paste and has not withdrawn it. */
  bracketedPaste: boolean;
}

export interface PrefillInput {
  pasteMode: PasteMode;
  command: string;
  shell?: ShellId;
  /** The workspace's shells in tab order. */
  sessions: PrefillTarget[];
  activeId: string | null;
  /** Shells this request opened, oldest first. */
  opened: string[];
}

export type PrefillStep =
  | { kind: "write"; id: string; data: string }
  /** No shell named means the default shell. */
  | { kind: "open"; shell?: string }
  | { kind: "stop" };

/** A first prompt behind a heavy profile (oh-my-zsh, nvm) takes one to three seconds; this leaves margin
 * and caps the one wait a bash 3.2 login shell costs before zsh opens. */
export const PASTE_WAIT_MS = 5000;

/** Every Mac has it, and zsh 5.9 takes bracketed paste. */
const FALLBACK_SHELL = "/bin/zsh";
const POSIX_SHELLS = new Set(["Sh", "Bash", "Zsh", "Ksh", "Dash"]);
const LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/;
const STOP: PrefillStep = { kind: "stop" };

/** A command's lines as a prompt takes them. Where the paste mode is reported, any line terminator splits,
 * so a hidden break cannot pass as one line. */
export function promptLines(command: string, pasteMode: PasteMode): string[] {
  return String(command)
    .split(pasteMode === "assumed" ? "\n" : LINE_BREAK)
    .map(promptText)
    .filter(Boolean);
}

const asPrompt = (lines: string[]) => (lines.length === 1 ? lines[0] : `\u001b[200~${lines.join("\n")}\u001b[201~`);

export function planPrefill(input: PrefillInput): PrefillStep {
  const lines = promptLines(input.command, input.pasteMode);
  if (!lines.length) return STOP;
  const write = (id: string): PrefillStep => ({ kind: "write", id, data: asPrompt(lines) });
  const live = input.sessions.filter((session) => !session.exited);

  if (input.pasteMode === "assumed") {
    const fresh = input.opened.at(-1);
    if (fresh) return live.some((session) => session.id === fresh) ? write(fresh) : STOP;
    const wanted = input.shell ? shellName(input.shell) : null;
    const match = live.find((session) => !wanted || shellName(session.shell) === wanted);
    return match ? write(match.id) : { kind: "open", shell: input.shell };
  }

  const posix = !input.shell || input.shell === "bash" || input.shell === "sh";
  const fits = (shell: string) => (posix ? POSIX_SHELLS.has(shellName(shell)) : shellName(shell) === shellName(input.shell ?? ""));
  // A shell without bracketed paste takes each newline as Enter.
  const ready = live.filter((session) => fits(session.shell) && (lines.length === 1 || session.bracketedPaste));
  const target = ready.find((session) => session.id === input.activeId) ?? ready[0];
  if (target) return write(target.id);
  if (!posix) return STOP;
  if (!input.opened.length) return { kind: "open" };
  const first = input.sessions.find((session) => session.id === input.opened[0]);
  if (input.opened.length === 1 && first?.shell !== FALLBACK_SHELL) return { kind: "open", shell: FALLBACK_SHELL };
  return STOP;
}
