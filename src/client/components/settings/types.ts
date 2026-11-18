export interface Prefs {
  theme: string;
  locale: string;
  timezone: string | null;
  density: string;
}

export interface NotifCategoryPref {
  inApp?: boolean;
  email?: boolean;
}

export interface NotifPrefs {
  categoryPrefs: Record<string, NotifCategoryPref>;
  dndStart: string | null;
  dndEnd: string | null;
  dndTimezone: string;
  digestFrequency?: string;
}

export interface SettingView {
  key: string;
  value: unknown;
  isSecret: boolean;
}

export const CATEGORIES: [string, string][] = [
  ["ASSIGN", "set.catAssign"],
  ["TRANSITION", "set.catTransition"],
  ["FIELD_CHANGE", "set.catFieldChange"],
  ["ANNOUNCEMENT", "set.catAnnouncement"],
  ["MENTION", "set.catMentionStrong"],
];

export type FeedbackHandlers = {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};
