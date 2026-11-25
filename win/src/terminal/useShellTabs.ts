import { useCallback, useEffect, useRef } from "react";
import { openPane, terminalPane, type DockLayout } from "../app/dockLayout";
import { platformInfo } from "../platform/info";
import { onPrefill, onShowTasks, takePrefill, type PrefillRequest } from "./terminalBus";
import { PASTE_WAIT_MS, planPrefill } from "./prefill";
import { activeSessionId, focusSession, openSession, prefillSession, selectSession, sessionsFor, waitForPaste } from "./terminalSessions";

interface ShellTabsOptions {
  workspaceId: string;
  /** The Default shell setting; "auto" lets the main process choose. */
  defaultShell?: string;
  layout: DockLayout;
  onLayoutChange: (next: DockLayout) => void;
  /** Said to the person when a shell cannot start or starts as another shell. */
  onMessage: (text: string) => void;
  t: (key: string) => string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each shell is a tab in the dock. This opens them: from the + menu, from the Terminal item, and
 * for a command a code block sends (which lands on a prompt and is never run). */
export function useShellTabs({ workspaceId, defaultShell, layout, onLayoutChange, onMessage, t }: ShellTabsOptions) {
  const latest = useRef({ layout, defaultShell, onLayoutChange, onMessage, t });
  useEffect(() => {
    latest.current = { layout, defaultShell, onLayoutChange, onMessage, t };
  });

  const showTab = useCallback((id: string) => {
    const { layout: current, onLayoutChange: change } = latest.current;
    const next = openPane(current, terminalPane(id));
    latest.current.layout = next;
    change(next);
  }, []);

  const openShell = useCallback(
    async (shell?: string): Promise<string | null> => {
      const { defaultShell: preferred, onMessage: say, t: text } = latest.current;
      const outcome = await openSession(workspaceId, shell, preferred === "auto" ? undefined : preferred);
      if (!outcome.success || !outcome.id) {
        say(outcome.unavailable ? text("terminalUnavailable") : (outcome.error ?? text("terminalFailed")));
        return null;
      }
      if (outcome.notice) say(outcome.notice);
      showTab(outcome.id);
      return outcome.id;
    },
    [workspaceId, showTab],
  );

  /** The Terminal menu item: bring the shell already open forward, or start the first one. */
  const showTerminal = useCallback(() => {
    const id = activeSessionId(workspaceId);
    if (id && sessionsFor(workspaceId).some((session) => session.id === id)) {
      selectSession(workspaceId, id);
      showTab(id);
    } else {
      void openShell();
    }
  }, [workspaceId, openShell, showTab]);

  useEffect(() => onShowTasks(showTerminal), [showTerminal]);

  useEffect(() => {
    const handle = async (request: PrefillRequest) => {
      const { pasteMode } = platformInfo();
      const opened: string[] = [];
      const shown: string[] = [];
      for (;;) {
        const step = planPrefill({ ...request, pasteMode, sessions: sessionsFor(workspaceId), activeId: activeSessionId(workspaceId), opened });
        if (step.kind === "stop") {
          if (opened.length) focusSession(opened[opened.length - 1]);
          return;
        }
        if (step.kind === "open") {
          const id = await openShell(step.shell);
          if (!id) return;
          selectSession(workspaceId, id);
          opened.push(id);
          // Where the shell cannot report its paste mode, a fresh tab gets a fixed head start instead.
          await (pasteMode === "assumed" ? delay(400) : waitForPaste(id, PASTE_WAIT_MS));
          continue;
        }
        selectSession(workspaceId, step.id);
        if (!opened.includes(step.id) && !shown.includes(step.id)) {
          showTab(step.id);
          shown.push(step.id);
          // The tab renders before the text lands; the plan is made again in case the shell moved on.
          await delay(0);
          continue;
        }
        prefillSession(step.id, step.data);
        return;
      }
    };
    const waiting = takePrefill();
    if (waiting) void handle(waiting);
    return onPrefill((request) => {
      takePrefill();
      void handle(request);
    });
  }, [workspaceId, openShell, showTab]);

  return { openShell, showTerminal };
}
