import React from "react";
import { Dialog } from "./Dialog";
import { Kbd } from "./Kbd";
import { formatShortcut, type Chord } from "../platform/shortcuts";

export interface ShortcutsSheetProps {
  open: boolean;
  onClose: () => void;
  t: (key: string) => string;
}

interface ShortcutItem {
  label: string;
  keys: Chord[];
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** Shows the full keyboard map grouped by task, opened with Ctrl+/.
 * Uses standard modifier keys and platform conventions. */
export function ShortcutsSheet({ open, onClose, t }: ShortcutsSheetProps) {
  const groups: ShortcutGroup[] = [
    {
      title: t("shortcutsSectionGeneral"),
      items: [
        { label: t("commandPalette"), keys: ["Mod+K", "Mod+Shift+P"] },
        { label: t("keyboardShortcuts"), keys: ["Mod+/"] },
        { label: t("settings"), keys: ["Mod+,"] },
        { label: t("toggleSidebar"), keys: ["Mod+B"] },
        { label: t("stopGenerating"), keys: ["Esc"] },
      ],
    },
    {
      title: t("shortcutsSectionNavigation"),
      items: [
        { label: t("newDiscussion"), keys: ["Mod+N"] },
        { label: `${t("chatMode")} / ${t("codeMode")}`, keys: ["Mod+Shift+X"] },
        { label: t("nextSession"), keys: ["Ctrl+Tab"] },
        { label: t("previousSession"), keys: ["Ctrl+Shift+Tab"] },
        { label: t("viewMode"), keys: ["Mod+O"] },
      ],
    },
    {
      title: t("shortcutsSectionPanes"),
      items: [
        { label: t("projectFiles"), keys: ["Mod+Shift+F"] },
        { label: t("diffPane"), keys: ["Mod+Shift+D"] },
        { label: t("browser"), keys: ["Mod+Shift+B"] },
        { label: t("plan"), keys: ["Mod+Shift+L"] },
        { label: t("terminal"), keys: ["Mod+Shift+T"] },
        { label: t("sendToBackground"), keys: ["Mod+Alt+B"] },
        { label: t("closePane"), keys: ["Mod+\\"] },
        { label: t("talk"), keys: ["Mod+Shift+Space"] },
      ],
    },
    {
      title: t("shortcutsSectionComposer"),
      items: [
        { label: t("permissionMode"), keys: ["Mod+Shift+M"] },
        { label: t("model"), keys: ["Mod+Shift+I"] },
        { label: t("effort"), keys: ["Mod+Shift+E"] },
        { label: t("mentionFiles"), keys: ["@"] },
      ],
    },
  ];

  return (
    <Dialog open={open} onClose={onClose} title={t("keyboardShortcuts")} closeLabel={t("closeDialog")} width={560}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 max-h-[60vh] overflow-y-auto pe-1">
        {groups.map((group) => (
          <div key={group.title} className="space-y-2">
            <h3 className="text-[12px] font-medium text-text-tertiary">{group.title}</h3>
            <div className="divide-y divide-rule/60">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between py-1.5 text-[13px]">
                  <span className="text-text-secondary truncate pe-2">{item.label}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {item.keys.map((k) => (
                      <Kbd key={k}>{formatShortcut(k)}</Kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
