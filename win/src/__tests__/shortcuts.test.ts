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

function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("one way to write and read a shortcut", () => {
  const files = sourceFiles(SRC).filter((file) => !file.endsWith(path.join("platform", "shortcuts.ts")));

  it("labels name the primary modifier as Mod, so a Mac can show Command", () => {
    // Ctrl+Tab is the one chord that is Control on every platform.
    const offenders = files.filter((file) => /Ctrl\+(?!(Shift\+)?Tab\b)/.test(code(file)));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it("handlers ask for the primary modifier instead of testing Ctrl and the Windows key", () => {
    const pair = /\w+\.ctrlKey \|\| \w+\.metaKey(?! \|\|)|!\w+\.ctrlKey && !\w+\.metaKey/;
    const offenders = files.filter((file) => pair.test(code(file)));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});
