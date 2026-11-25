// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PlatformInfo } from "../platform/info";
import { formatShortcut, isLetterKey, primaryModifierDown, type Chord } from "../platform/shortcuts";

// What the macOS shell hands the renderer, from the case its Rust test checks the boot script against.
const FILE = path.resolve(import.meta.dirname, "../../../shared/fixtures/platform/info.json");
const MACOS = (JSON.parse(fs.readFileSync(FILE, "utf8")) as { cases: { expected: PlatformInfo }[] }).cases[0].expected;

function onMac() {
  window.__DRAGGY_PLATFORM__ = Object.freeze({ ...MACOS });
}

afterEach(() => {
  delete window.__DRAGGY_PLATFORM__;
});

// Every chord the app shows: how Windows has always written it, and how a Mac writes it.
const INVENTORY: [Chord, string, string][] = [
  ["Mod+K", "Ctrl+K", "⌘K"],
  ["Mod+Shift+P", "Ctrl+Shift+P", "⇧⌘P"],
  ["Mod+/", "Ctrl+/", "⌘/"],
  ["Mod+,", "Ctrl+,", "⌘,"],
  ["Mod+B", "Ctrl+B", "⌘B"],
  ["Mod+N", "Ctrl+N", "⌘N"],
  ["Mod+O", "Ctrl+O", "⌘O"],
  ["Ctrl+Tab", "Ctrl+Tab", "⌃⇥"],
  ["Ctrl+Shift+Tab", "Ctrl+Shift+Tab", "⌃⇧⇥"],
  ["Mod+Shift+X", "Ctrl+Shift+X", "⇧⌘X"],
  ["Mod+Shift+F", "Ctrl+Shift+F", "⇧⌘F"],
  ["Mod+Shift+D", "Ctrl+Shift+D", "⇧⌘D"],
  ["Mod+Shift+B", "Ctrl+Shift+B", "⇧⌘B"],
  ["Mod+Shift+L", "Ctrl+Shift+L", "⇧⌘L"],
  ["Mod+Shift+T", "Ctrl+Shift+T", "⇧⌘T"],
  ["Mod+Alt+B", "Ctrl+Alt+B", "⌥⌘B"],
  ["Mod+\\", "Ctrl+\\", "⌘\\"],
  ["Mod+Shift+Space", "Ctrl+Shift+Space", "⇧⌘Space"],
  ["Mod+Shift+M", "Ctrl+Shift+M", "⇧⌘M"],
  ["Mod+Shift+I", "Ctrl+Shift+I", "⇧⌘I"],
  ["Mod+Shift+E", "Ctrl+Shift+E", "⇧⌘E"],
  ["Mod+Enter", "Ctrl+Enter", "⌘↩"],
  ["Mod+Shift+Enter", "Ctrl+Shift+Enter", "⇧⌘↩"],
  ["Mod+C", "Ctrl+C", "⌘C"],
  ["Mod+Z", "Ctrl+Z", "⌘Z"],
  ["Mod", "Ctrl", "⌘"],
  ["Shift", "Shift", "⇧"],
  ["Enter", "Enter", "↩"],
  ["Esc", "Esc", "Esc"],
  ["Del", "Del", "⌦"],
  ["F2", "F2", "F2"],
  ["@", "@", "@"],
];

describe("shortcut labels", () => {
  it.each(INVENTORY)("%s reads %s without platform info", (chord, windows) => {
    expect(formatShortcut(chord)).toBe(windows);
  });

  it.each(INVENTORY)("%s reads as on a Mac when the shell leads with Command", (chord, _windows, mac) => {
    onMac();
    expect(formatShortcut(chord)).toBe(mac);
  });
});

const keys = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey });

describe("the primary modifier", () => {
  it("is Ctrl or the Windows key without platform info, as the handlers have always tested", () => {
    expect(primaryModifierDown(keys(true, false))).toBe(true);
    expect(primaryModifierDown(keys(false, true))).toBe(true);
    expect(primaryModifierDown(keys(true, true))).toBe(true);
    expect(primaryModifierDown(keys(false, false))).toBe(false);
  });

  it("is Command alone on a Mac, leaving Control to text fields and Control-Command to the system", () => {
    onMac();
    expect(primaryModifierDown(keys(false, true))).toBe(true);
    expect(primaryModifierDown(keys(true, false))).toBe(false);
    expect(primaryModifierDown(keys(true, true))).toBe(false);
    expect(primaryModifierDown(keys(false, false))).toBe(false);
  });
});

const press = (key: string, code: string, altKey: boolean) => ({ key, code, altKey });

describe("the letter key of a shortcut", () => {
  it("is the character typed without platform info, as the handlers have always tested", () => {
    expect(isLetterKey(press("b", "KeyB", true), "b")).toBe(true);
    expect(isLetterKey(press("B", "KeyB", false), "b")).toBe(true);
    expect(isLetterKey(press("∫", "KeyB", true), "b")).toBe(false);
    expect(isLetterKey(press("b", "KeyN", false), "b")).toBe(true);
    expect(isLetterKey(press("n", "KeyB", true), "b")).toBe(false);
  });

  it("is the physical key on a Mac while Option composes another character", () => {
    onMac();
    expect(isLetterKey(press("∫", "KeyB", true), "b")).toBe(true);
    expect(isLetterKey(press("b", "KeyN", true), "b")).toBe(false);
  });

  it("follows the layout on a Mac without Option, as Command chords always have", () => {
    onMac();
    expect(isLetterKey(press("b", "KeyN", false), "b")).toBe(true);
    expect(isLetterKey(press("n", "KeyB", false), "b")).toBe(false);
  });
});

// Source files that may name the Ctrl key: the module that writes it, and comments.
const SRC = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// Strings are matched first and kept, so a URL's // or a glob's /* hides nothing; comments are dropped.
// Not a parser: a regex literal with a quote or //, or a backtick nested in ${}, can still mislead it.
const STRING_OR_COMMENT = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function code(source: string): string {
  return source.replace(STRING_OR_COMMENT, (_match, literal?: string) => literal ?? "");
}

// Ctrl+Tab is the one chord that is Control on every platform, and the shortcuts sheet is its one label.
const CONTROL_EVERYWHERE = path.join("ui", "ShortcutsSheet.tsx");

function writesCtrl(source: string, file: string): boolean {
  const label = file.endsWith(CONTROL_EVERYWHERE) ? /Ctrl\s*\+(?!(Shift\+)?Tab\b)/ : /Ctrl\s*\+/;
  return label.test(code(source)) || /(["'`])Ctrl\1/.test(code(source));
}

// Both keys joined by ||, or both negated and joined by &&. A chain that adds altKey asks whether any modifier is down.
function pair(join: string, not: string): RegExp {
  const key = String.raw`${not}(?:[\w$.]+\.)?`;
  const alt = String.raw`${key}altKey`;
  return new RegExp(String.raw`(?<!${alt}\s*${join}\s*)(?<![\w$.])${key}(ctrlKey|metaKey)\s*${join}\s*${key}(?!\1)(?:ctrlKey|metaKey)\b(?!\s*${join}\s*${alt})`);
}

const PAIRS = [pair(String.raw`\|\|`, ""), pair("&&", String.raw`!\s*`)];

function testsCtrlAndMeta(source: string): boolean {
  return PAIRS.some((pattern) => pattern.test(code(source)));
}

describe("the guard's own matchers", () => {
  const ANYWHERE = path.join("app", "AppShell.tsx");

  it.each([
    ['label("Ctrl+B")', ANYWHERE],
    ["label('Ctrl + B')", ANYWHERE],
    ["<kbd>Ctrl+K</kbd>", ANYWHERE],
    ["const keys = `Ctrl+${letter}`;", ANYWHERE],
    ['const mod = "Ctrl";', ANYWHERE],
    ['keys: ["Ctrl+Tab"]', ANYWHERE],
    ['keys: ["Ctrl+B"]', CONTROL_EVERYWHERE],
    ['open("https://example.com"); label("Ctrl+B");', ANYWHERE],
    ['glob("src/**/*.ts"); label("Ctrl+B"); // */', ANYWHERE],
  ])("flags the label in %s", (source, file) => {
    expect(writesCtrl(source, file)).toBe(true);
  });

  it.each([
    ["foo(); // Ctrl+B does X", ANYWHERE],
    ["/* Ctrl+B */ foo();", ANYWHERE],
    ["/** Opened with Ctrl+/. */", ANYWHERE],
    ['keys: ["Ctrl+Tab"]', CONTROL_EVERYWHERE],
    ['keys: ["Ctrl+Shift+Tab"]', CONTROL_EVERYWHERE],
    ['formatShortcut("Mod+B")', ANYWHERE],
    ['e.key === "Control" && e.ctrlKey', ANYWHERE],
  ])("leaves %s alone", (source, file) => {
    expect(writesCtrl(source, file)).toBe(false);
  });

  it.each([
    "if (e.ctrlKey || e.metaKey) go();",
    "if (event.metaKey||event.ctrlKey) go();",
    "const { ctrlKey, metaKey } = e; if (ctrlKey || metaKey) go();",
    "if (!e.ctrlKey && !e.metaKey) return;",
    "if (!metaKey&&!ctrlKey) return;",
    "if (a && (e.ctrlKey || e.metaKey)) go();",
    'open("https://example.com"); if (e.ctrlKey || e.metaKey) go();',
  ])("flags the handler in %s", (source) => {
    expect(testsCtrlAndMeta(source)).toBe(true);
  });

  it.each([
    "if (event.ctrlKey || event.metaKey || event.altKey) return;",
    "if (e.altKey || e.ctrlKey || e.metaKey) return;",
    "if (!e.ctrlKey || e.altKey || e.metaKey || e.key !== \"Tab\") return;",
    "if (e.ctrlKey && !e.metaKey) go();",
    "if (primaryModifierDown(e)) go();",
    "foo(); // e.ctrlKey || e.metaKey",
  ])("leaves %s alone", (source) => {
    expect(testsCtrlAndMeta(source)).toBe(false);
  });
});

describe("one way to write and read a shortcut", () => {
  const files = sourceFiles(SRC).filter((file) => !file.endsWith(path.join("platform", "shortcuts.ts")));
  const read = (file: string) => fs.readFileSync(file, "utf8");

  it("labels name the primary modifier as Mod, so a Mac can show Command", () => {
    const offenders = files.filter((file) => writesCtrl(read(file), file));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it("handlers ask for the primary modifier instead of testing Ctrl and the Windows key", () => {
    const offenders = files.filter((file) => testsCtrlAndMeta(read(file)));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});
