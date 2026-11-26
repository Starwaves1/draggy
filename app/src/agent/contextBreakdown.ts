import { CHARS_PER_TOKEN, COMPACT_RESERVE_MAX, COMPACT_RESERVE_SHARE, NO_COMPACT_WINDOW, UNKNOWN_WINDOW_SHARE } from "./compaction";

/** What the context window is spent on. The model reports one number; the parts are measured from
 * what Draggy sent and scaled to add up to it. */

export type ContextCategory =
  | "messages"
  | "system"
  | "tools"
  | "memory"
  | "skills"
  | "loadedSkills"
  | "summary";

export type ContextBreakdown = Record<ContextCategory, number>;

/** A skill whose instructions are in the prompt, with what they cost. */
export interface LoadedSkillPart {
  id: string;
  name: string;
  chars: number;
}

/** Characters of each fixed part of the prompt, as sent. */
export interface PromptParts {
  systemChars: number;
  toolChars: number;
  memoryChars: number;
  /** The list of skills on offer: names and descriptions only. */
  skillChars: number;
  summaryChars: number;
  /** The instructions of the skills loaded in this conversation. */
  loadedSkillChars?: number;
  loadedSkills?: LoadedSkillPart[];
  toolCount?: number;
  skillCount?: number;
}

export const CATEGORY_ORDER: ContextCategory[] = [
  "messages",
  "system",
  "tools",
  "skills",
  "loadedSkills",
  "memory",
  "summary",
];

const FIXED: Exclude<ContextCategory, "messages">[] = [
  "system",
  "tools",
  "memory",
  "skills",
  "loadedSkills",
  "summary",
];

export const tokensOf = (chars: number) => Math.max(0, Math.ceil(chars / CHARS_PER_TOKEN));

/** Splits a measured count: fixed parts estimated from length, the conversation gets the rest.
 * Overshooting estimates are scaled down together, never below zero. */
export function measureBreakdown(
  parts: PromptParts,
  measuredTokens: number,
  conversationChars = 0,
): ContextBreakdown {
  const fixed: Omit<ContextBreakdown, "messages"> = {
    system: tokensOf(parts.systemChars),
    tools: tokensOf(parts.toolChars),
    memory: tokensOf(parts.memoryChars),
    skills: tokensOf(parts.skillChars),
    loadedSkills: tokensOf(parts.loadedSkillChars ?? 0),
    summary: tokensOf(parts.summaryChars),
  };

  const total = (values: Omit<ContextBreakdown, "messages">) =>
    FIXED.reduce((sum, key) => sum + values[key], 0);
  const fixedTotal = total(fixed);

  // Nothing measured: an estimate of everything is the best there is.
  if (!(measuredTokens > 0)) {
    return { ...fixed, messages: tokensOf(conversationChars) };
  }

  if (fixedTotal <= measuredTokens) {
    return { ...fixed, messages: measuredTokens - fixedTotal };
  }

  const scale = measuredTokens / fixedTotal;
  const scaled = Object.fromEntries(
    FIXED.map((key) => [key, Math.floor(fixed[key] * scale)]),
  ) as Omit<ContextBreakdown, "messages">;

  return { ...scaled, messages: Math.max(0, measuredTokens - total(scaled)) };
}

/** What the popover lists beyond the parts: how many tools and skills are offered, and which skills
 * are loaded. Tokens are left out when nothing was measured to split. */
export interface ContextDetails {
  toolCount: number | null;
  skillCount: number | null;
  loadedSkills: { id: string; name: string; tokens: number | null }[];
}

export interface ContextRow {
  id: ContextCategory | "draft" | "free";
  tokens: number;
  /** Share of the whole window, 0 to 100. */
  percent: number;
}

export interface ContextWindowView {
  /** Whether anything has been measured yet. Before that there is nothing honest to show. */
  measured: boolean;
  /** False while a reply streams and the figure is an estimate between two counts. */
  exact: boolean;
  usedTokens: number;
  windowTokens: number;
  percent: number;
  /** Each part that has anything in it, then what is still free. */
  rows: ContextRow[];
  /** Where the conversation gets folded into notes, in tokens. */
  compactAtTokens: number;
  compactSource: CompactSource;
  details: ContextDetails;
}

export interface ContextWindowInput {
  /** Tool and skill counts, and the loaded skills. Left out, the popover shows none. */
  details?: ContextDetails;
  /** The parts, adding up to what the model counted. Null when nothing has been measured. */
  breakdown: ContextBreakdown | null;
  /** How much of the conversation part is the message not yet sent, when that was measured. */
  draftTokens: number;
  /** False for an estimate made while a reply streams. */
  exact: boolean;
  /** The most the model can take, which is also what automatic folding is measured against. */
  windowTokens: number;
  /** False when nothing reported the window and `windowTokens` is a guess. */
  windowKnown?: boolean;
  /** The user's own limit, when they set one. */
  limitTokens: number | null;
  /** A model a provider bills for, which folds at `PAID_COMPACT_CAP` unless the user set a limit. */
  paid?: boolean;
}

/** Who chose the fold point: the user, Draggy, a paid provider's cap, or nobody because the window is too small. */
export type CompactSource = "auto" | "limit" | "paid" | "none";

export interface CompactThreshold {
  tokens: number;
  source: CompactSource;
}

/** Where automatic folding happens, in tokens of the whole prompt. Measured against how far the window can
 * grow, not the smaller window loaded now, which only grows past a size the fold would already have cut back. */
export function compactThreshold(
  windowTokens: number,
  limitTokens: number | null,
  paid = false,
  windowKnown = true,
): CompactThreshold {
  if (limitTokens !== null && limitTokens > 0) {
    return { tokens: Math.min(limitTokens, maxLimitFor(windowTokens)), source: "limit" };
  }

  const auto = windowKnown
    ? windowTokens - Math.min(COMPACT_RESERVE_MAX, Math.floor(windowTokens * COMPACT_RESERVE_SHARE))
    : Math.floor(windowTokens * UNKNOWN_WINDOW_SHARE);
  if (paid && auto > PAID_COMPACT_CAP) return { tokens: PAID_COMPACT_CAP, source: "paid" };
  if (windowKnown && windowTokens <= NO_COMPACT_WINDOW) return { tokens: windowTokens, source: "none" };
  return { tokens: auto, source: "auto" };
}

/** Characters the conversation may reach before an automatic fold: the fold point less the fixed parts
 * of the prompt last measured, so they never eat the reserve. Zero when nothing folds on its own. */
export function foldBudgetChars(threshold: CompactThreshold, measured: ContextBreakdown | null | undefined): number {
  if (threshold.source === "none") return 0;
  // The summary is left out: the conversation's own count already includes it.
  const fixed = measured ? measured.system + measured.tools + measured.memory + measured.skills + measured.loadedSkills : 0;
  return Math.max(0, threshold.tokens - fixed) * CHARS_PER_TOKEN;
}

/** Every token sent is billed on every turn, so a paid provider's huge window is folded long before it fills. */
export const PAID_COMPACT_CAP = 64000;

/** The lowest limit accepted. Below it every turn would be folded away. */
export const MIN_COMPACT_LIMIT = 1000;

/** The highest limit worth honouring: a tenth of the window, at most 50k, stays for the reply. Never
 * below the automatic fold point, so a limit can always fold later than Draggy would. */
export function maxLimitFor(windowTokens: number): number {
  return windowTokens - Math.min(COMPACT_RESERVE_MAX, Math.floor(windowTokens * 0.1));
}

export function describeContextWindow(input: ContextWindowInput): ContextWindowView {
  const windowTokens = Math.max(1, input.windowTokens);
  const share = (tokens: number) => (tokens / windowTokens) * 100;

  const breakdown: ContextBreakdown = input.breakdown ?? {
    messages: 0,
    system: 0,
    tools: 0,
    memory: 0,
    skills: 0,
    loadedSkills: 0,
    summary: 0,
  };

  // The draft was counted as part of the conversation; it is shown on a row of its own.
  const draft = Math.max(0, Math.min(Math.round(input.draftTokens), breakdown.messages));

  const rows: ContextRow[] = [];

  for (const id of CATEGORY_ORDER) {
    const tokens = id === "messages" ? breakdown.messages - draft : breakdown[id];
    if (tokens > 0) rows.push({ id, tokens, percent: share(tokens) });
  }

  if (draft > 0) rows.push({ id: "draft", tokens: draft, percent: share(draft) });

  const usedTokens = rows.reduce((total, row) => total + row.tokens, 0);
  const free = Math.max(0, windowTokens - usedTokens);

  rows.push({ id: "free", tokens: free, percent: share(free) });

  const threshold = compactThreshold(windowTokens, input.limitTokens, input.paid, input.windowKnown ?? true);

  return {
    measured: input.breakdown !== null,
    exact: input.exact,
    usedTokens,
    windowTokens,
    percent: share(usedTokens),
    rows,
    compactAtTokens: threshold.tokens,
    compactSource: threshold.source,
    details: input.details ?? { toolCount: null, skillCount: null, loadedSkills: [] },
  };
}

/** The counts and loaded skills for the popover, from the parts of the prompt when a turn measured
 * them, and otherwise from the loaded skills the conversation shows, without their sizes. */
export function contextDetails(
  parts: PromptParts | null,
  loaded: { id: string; name: string }[],
): ContextDetails {
  if (parts?.loadedSkills) {
    return {
      toolCount: parts.toolCount ?? null,
      skillCount: parts.skillCount ?? null,
      loadedSkills: parts.loadedSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        tokens: tokensOf(skill.chars),
      })),
    };
  }

  return {
    toolCount: parts?.toolCount ?? null,
    skillCount: parts?.skillCount ?? null,
    loadedSkills: loaded.map((skill) => ({ ...skill, tokens: null })),
  };
}

/** Reads a typed token count ("20000", "20k", "1.5k", "2m"). "auto" and "off" return null; anything
 * else returns undefined. */
export function parseTokenCount(raw: string): number | null | undefined {
  const text = String(raw || "").trim().toLowerCase().replace(/[,_\s]/g, "");

  if (!text) return undefined;
  if (text === "auto" || text === "off" || text === "default") return null;

  const match = /^(\d+(?:\.\d+)?)(k|m)?(?:tokens?)?$/.exec(text);
  if (!match) return undefined;

  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const value = Math.round(Number(match[1]) * multiplier);

  return value > 0 ? value : undefined;
}

/** "27.6k", "203k", "950". The same shape everywhere a count is shown. */
export function formatTokenCount(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));

  if (value >= 999_500) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 100_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}
