import { platformInfo } from "./info";

/** Mod is the key that leads app shortcuts: Ctrl, or Command on a Mac. Ctrl means Control everywhere. */
export type Modifier = "Mod" | "Ctrl" | "Alt" | "Shift";

/** A shortcut as the app writes it once, such as "Mod+Shift+F"; `formatShortcut` shows it per platform. */
export type Chord = Modifier | `${Modifier}+${string}` | "Esc" | "Enter" | "Del" | "F2" | "@";

// A Mac lists modifiers in this order, as symbols, before the key.
const MAC_MODIFIERS: Record<Modifier, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
const MAC_ORDER: Modifier[] = ["Ctrl", "Alt", "Shift", "Mod"];
const MAC_KEYS: Record<string, string> = { Enter: "↩", Tab: "⇥", Del: "⌦" };

function isModifier(token: string): token is Modifier {
  return token in MAC_MODIFIERS;
}

export function formatShortcut(chord: Chord): string {
  const tokens = chord.split("+");
  if (platformInfo().shortcuts !== "command") return tokens.map((token) => (token === "Mod" ? "Ctrl" : token)).join("+");
  const key = tokens[tokens.length - 1];
  const held = new Set(tokens.slice(0, -1));
  const modifiers = MAC_ORDER.filter((modifier) => held.has(modifier)).map((modifier) => MAC_MODIFIERS[modifier]);
  return modifiers.join("") + (isModifier(key) ? MAC_MODIFIERS[key] : (MAC_KEYS[key] ?? key));
}

/** Whether the key that leads app shortcuts is down. On a Mac Control stays free for text fields. */
export function primaryModifierDown(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  if (platformInfo().shortcuts !== "command") return event.ctrlKey || event.metaKey;
  return event.metaKey && !event.ctrlKey;
}

/** Whether Control is down on a Mac, where it belongs to text fields and the system rather than the app. */
export function controlBelongsToSystem(event: Pick<KeyboardEvent, "ctrlKey">): boolean {
  return platformInfo().shortcuts === "command" && event.ctrlKey;
}

/** Whether the event is the shortcut's letter key. Option turns ⌥B into ∫ on a Mac, so there the physical key decides. */
export function isLetterKey(event: Pick<KeyboardEvent, "key" | "code" | "altKey">, letter: string): boolean {
  if (platformInfo().shortcuts === "command" && event.altKey) return event.code === `Key${letter.toUpperCase()}`;
  return event.key.toLowerCase() === letter;
}
