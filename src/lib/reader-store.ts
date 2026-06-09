export type FontFamily = "serif" | "sans" | "literata" | "dyslexic";
export type ReaderTheme = "dark" | "night" | "sepia" | "light";

/** Maps a font choice to its CSS custom property (defined in styles.css). */
export const FONT_VARS: Record<FontFamily, string> = {
  serif: "var(--font-serif)",
  literata: "var(--font-literata)",
  sans: "var(--font-sans)",
  dyslexic: "var(--font-dyslexic)",
};
/**
 * How paragraphs are separated:
 * - "indented": first-line indent, snug leading between paragraphs — the
 *   classic novel look that reads as continuous, cozy prose.
 * - "spaced": a blank-line gap between paragraphs (article/web style).
 */
export type ParagraphStyle = "indented" | "spaced";

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  /** Optimal line length in characters ("measure"). Ties width to font size. */
  measure: number;
  /** Reading-surface brightness multiplier (0.85 = dimmer, 1.15 = brighter). */
  brightness: number;
  fontFamily: FontFamily;
  theme: ReaderTheme;
  /** Justify body text (off = left-aligned, which reads better on narrow columns). */
  justify: boolean;
  /** Auto-hyphenate body text. */
  hyphens: boolean;
  /** Horizontal padding (px) inside the text column — distinct from content width. */
  margin: number;
  /** Paragraph separation: indented (book) or spaced (article). */
  paragraphStyle: ParagraphStyle;
  /** Vertical gap between paragraphs, in em. Only used in "spaced" style. */
  paragraphSpacing: number;
  /** Letter tracking, in em. */
  letterSpacing: number;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 19,
  // Snug, book-like leading. The previous 1.7 left airy gaps on thin,
  // small-x-height serifs and read cold rather than cozy.
  lineHeight: 1.5,
  measure: 66,
  brightness: 1,
  fontFamily: "serif",
  // Kindle-white page by default — the reading surface is paper, even though
  // the surrounding app shell stays dark (Catching Fire at night).
  theme: "light",
  // Left-aligned, no hyphenation by default — the previous hard-coded
  // justify+hyphens produced ugly rivers on narrow mobile columns.
  justify: false,
  hyphens: false,
  margin: 0,
  // Spaced paragraphs by default — first-line indents are off unless the
  // reader opts into the classic novel look.
  paragraphStyle: "spaced",
  paragraphSpacing: 1,
  letterSpacing: 0,
};

const SETTINGS_KEY = "wereadpdf.settings";
const PROGRESS_KEY = "wereadpdf.progress";
// Lightweight pointer to the most recently opened doc. The doc bodies
// themselves live in IndexedDB (see below) — localStorage only holds the key.
const LAST_DOC_KEY = "wereadpdf.lastDocKey";

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

export function loadProgress(
  docKey: string,
): { pageNumber: number; total: number; updatedAt?: number } | null {
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
  author?: string;
  pages: Array<{ pageNumber: number; text: string }>;
  outline: Array<{ title: string; pageNumber: number }>;
  wordCount: number;
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Document storage (IndexedDB)
//
// A few-hundred-page PDF can be many megabytes of text, which overflows the
// ~5 MB synchronous localStorage quota. We store doc bodies in IndexedDB, which
// has a far larger quota and is async, and keep only a small "last opened"
// pointer in localStorage. The store is keyed by `doc.key`, so it naturally
// holds multiple books — groundwork for the Library.
// ---------------------------------------------------------------------------

const DB_NAME = "wereadpdf";
const DB_VERSION = 1;
const DOC_STORE = "docs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        db.createObjectStore(DOC_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: IDBObjectStore, req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    store.transaction.onabort = () => reject(store.transaction.error);
  });
}

/** Persist a document and mark it as the most recently opened. */
export async function saveDoc(doc: CachedDoc): Promise<void> {
  const db = await openDB();
  try {
    const store = db.transaction(DOC_STORE, "readwrite").objectStore(DOC_STORE);
    await tx(store, store.put(doc));
    try {
      localStorage.setItem(LAST_DOC_KEY, doc.key);
    } catch {
      /* pointer is best-effort */
    }
  } finally {
    db.close();
  }
}

/** Load a single document by its key. */
export async function loadDoc(key: string): Promise<CachedDoc | null> {
  const db = await openDB();
  try {
    const store = db.transaction(DOC_STORE, "readonly").objectStore(DOC_STORE);
    return (await tx(store, store.get(key))) ?? null;
  } finally {
    db.close();
  }
}

/** Load the most recently opened document, if any. */
export async function loadLastDoc(): Promise<CachedDoc | null> {
  let key: string | null = null;
  try {
    key = localStorage.getItem(LAST_DOC_KEY);
  } catch {
    /* ignore */
  }
  if (!key) return null;
  try {
    return await loadDoc(key);
  } catch {
    return null;
  }
}

/** List every stored document (most recently saved first). */
export async function listDocs(): Promise<CachedDoc[]> {
  const db = await openDB();
  try {
    const store = db.transaction(DOC_STORE, "readonly").objectStore(DOC_STORE);
    const all = (await tx(store, store.getAll())) as CachedDoc[];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}

/** Rename a stored document's title in place. */
export async function renameDoc(key: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const db = await openDB();
  try {
    const store = db.transaction(DOC_STORE, "readwrite").objectStore(DOC_STORE);
    const doc = (await tx(store, store.get(key))) as CachedDoc | undefined;
    if (!doc) return;
    doc.title = trimmed;
    await tx(store, store.put(doc));
  } finally {
    db.close();
  }
}

/** Permanently remove a document and its saved progress. */
export async function deleteDoc(key: string): Promise<void> {
  const db = await openDB();
  try {
    const store = db.transaction(DOC_STORE, "readwrite").objectStore(DOC_STORE);
    await tx(store, store.delete(key));
  } finally {
    db.close();
  }
  try {
    if (localStorage.getItem(LAST_DOC_KEY) === key) {
      localStorage.removeItem(LAST_DOC_KEY);
    }
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    delete all[key];
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
