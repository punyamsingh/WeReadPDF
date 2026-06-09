export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  fontFamily: "serif" | "sans";
  theme: "dark" | "sepia" | "light";
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 19,
  lineHeight: 1.7,
  contentWidth: 680,
  fontFamily: "serif",
  theme: "dark",
};

const SETTINGS_KEY = "wereadpdf.settings";
const PROGRESS_KEY = "wereadpdf.progress";
const LAST_DOC_KEY = "wereadpdf.lastDoc";

export function loadSettings(): ReaderSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ReaderSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function saveProgress(docKey: string, pageNumber: number, total: number) {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    all[docKey] = { pageNumber, total, updatedAt: Date.now() };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function loadProgress(docKey: string): { pageNumber: number; total: number } | null {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return all[docKey] || null;
  } catch {
    return null;
  }
}

export interface CachedDoc {
  key: string;
  title: string;
  pages: Array<{ pageNumber: number; text: string }>;
  outline: Array<{ title: string; pageNumber: number }>;
  wordCount: number;
  savedAt: number;
}

export function cacheDoc(doc: CachedDoc) {
  try {
    localStorage.setItem(LAST_DOC_KEY, JSON.stringify(doc));
  } catch {
    /* too big — skip */
  }
}

export function loadCachedDoc(): CachedDoc | null {
  try {
    const raw = localStorage.getItem(LAST_DOC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCachedDoc() {
  try {
    localStorage.removeItem(LAST_DOC_KEY);
  } catch {
    /* ignore */
  }
}
