import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings,
  List,
  ChevronLeft,
  ChevronRight,
  X,
  Sun,
  Moon,
  MoonStar,
  BookOpen,
  ArrowLeft,
  Search,
} from "lucide-react";
import type { CachedDoc, FontFamily, ReaderTheme } from "@/lib/reader-store";
import { Mockingjay } from "./Mockingjay";
import {
  FONT_VARS,
  loadSettings,
  saveSettings,
  saveProgress,
  loadProgress,
  type ReaderSettings,
} from "@/lib/reader-store";
import { BookView, type BookApi, type ReadingPosition } from "./BookView";

interface Props {
  doc: CachedDoc;
  onExit: () => void;
}

const WORDS_PER_MINUTE = 230;

const FONT_OPTIONS: Array<{ id: FontFamily; label: string }> = [
  { id: "serif", label: "Garamond" },
  { id: "literata", label: "Literata" },
  { id: "sans", label: "Inter" },
  { id: "dyslexic", label: "Dyslexic" },
];

// Reading surfaces are tuned by hand for comfortable contrast rather than
// maximum contrast. Pure-white-on-black (the old default) glows and smears in
// low light ("halation"), so the dark surfaces lift the background off black
// and pull the text below pure white. Each entry is [lightness, chroma, hue]
// in the oklch space — the same space the rest of the app's palette uses.
const THEMES: Record<
  ReaderTheme,
  { label: string; icon: typeof Moon; bg: [number, number, number]; fg: [number, number, number] }
> = {
  // Kindle-white paper is the default reading surface — clean, barely-warm white
  // with near-black ink, just like an e-ink page.
  light: { label: "Paper", icon: Sun, bg: [0.99, 0.002, 95], fg: [0.22, 0.008, 60] },
  sepia: { label: "Sepia", icon: BookOpen, bg: [0.92, 0.04, 82], fg: [0.3, 0.035, 55] },
  dark: { label: "Charcoal", icon: Moon, bg: [0.16, 0.01, 55], fg: [0.86, 0.018, 80] },
  night: { label: "Midnight", icon: MoonStar, bg: [0.1, 0.008, 50], fg: [0.78, 0.016, 78] },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function oklch([l, c, h]: [number, number, number], alpha?: number) {
  const a = alpha === undefined ? "" : ` / ${alpha}`;
  return `oklch(${l.toFixed(3)} ${c} ${h}${a})`;
}

const HINT_KEY = "wereadpdf.tapHintSeen";

export function Reader({ doc, onExit }: Props) {
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());
  const [restorePage] = useState(() =>
    Math.min(loadProgress(doc.key)?.pageNumber ?? 1, doc.pages.length),
  );
  const [pos, setPos] = useState<ReadingPosition>({
    sourcePage: restorePage,
    fraction: 0,
    page: 1,
    total: 1,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [query, setQuery] = useState("");
  const [chrome, setChrome] = useState(true);
  const [showHint, setShowHint] = useState(() => {
    try {
      return !localStorage.getItem(HINT_KEY);
    } catch {
      return false;
    }
  });
  const bookRef = useRef<BookApi>(null);
  const lastPageRef = useRef(0);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (pos.sourcePage > 0) saveProgress(doc.key, pos.sourcePage, doc.pages.length);
  }, [pos.sourcePage, doc.key, doc.pages.length]);

  // Open with the chrome visible so controls are discoverable, then melt it
  // away for an immersive page after a moment.
  useEffect(() => {
    const id = setTimeout(() => setChrome(false), 2800);
    return () => clearTimeout(id);
  }, []);

  const dismissHint = useCallback(() => {
    setShowHint((seen) => {
      if (seen) {
        try {
          localStorage.setItem(HINT_KEY, "1");
        } catch {
          /* ignore */
        }
      }
      return false;
    });
  }, []);

  // Turning a page is proof the reader found the controls — retire the hint.
  useEffect(() => {
    if (lastPageRef.current && pos.page !== lastPageRef.current) dismissHint();
    lastPageRef.current = pos.page;
  }, [pos.page, dismissHint]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        bookRef.current?.next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        bookRef.current?.prev();
      } else if (e.key === "Escape") {
        setShowSettings(false);
        setShowToc(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleChange = useCallback((p: ReadingPosition) => setPos(p), []);
  const onCenterTap = useCallback(() => {
    dismissHint();
    setChrome((c) => !c);
  }, [dismissHint]);

  const progress = pos.fraction * 100;
  const minutesLeft = Math.max(
    1,
    Math.round((doc.wordCount * (1 - pos.fraction)) / WORDS_PER_MINUTE),
  );

  const surface = useMemo(() => {
    const palette = THEMES[settings.theme] ?? THEMES.dark;
    const [bgL, bgC, bgH] = palette.bg;
    // Brightness dims/lifts the surface lightness. For dark themes lowering it
    // makes the page darker; for paper themes it softens a harsh white.
    const bg: [number, number, number] = [clamp(bgL * settings.brightness, 0.07, 0.99), bgC, bgH];
    const fg = palette.fg;
    return {
      fg,
      root: { background: oklch(bg), color: oklch(fg) },
      // Header/footer float above the surface — tint them from the same color
      // so the chrome matches the page in every theme.
      chrome: {
        backgroundColor: oklch(bg, 0.72),
        borderColor: oklch(fg, 0.12),
        color: oklch(fg, 0.65),
      },
    };
  }, [settings.theme, settings.brightness]);

  const filteredOutline = doc.outline.filter((o) =>
    query ? o.title.toLowerCase().includes(query.toLowerCase()) : true,
  );

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden" style={surface.root}>
      {/* Top bar — auto-hides while reading */}
      <header
        className={`absolute inset-x-0 top-0 z-30 backdrop-blur-xl border-b transition-all duration-300 ${
          chrome ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
        }`}
        style={surface.chrome}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 max-w-[1400px] mx-auto w-full">
          <button
            onClick={onExit}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-ember transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Library</span>
          </button>
          <div className="flex-1 text-center min-w-0">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-ember/70 truncate">
              {doc.title}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowToc(true)}
              className="p-2 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-ember transition-colors"
              aria-label="Table of contents"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="p-2 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-ember transition-colors"
              aria-label="Reader settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Progress sliver */}
        <div className="h-[2px] bg-border/30">
          <div
            className="h-full bg-gradient-to-r from-ember to-accent transition-all duration-500"
            style={{ width: `${progress}%`, boxShadow: "0 0 12px var(--ember-glow)" }}
          />
        </div>
      </header>

      {/* The book */}
      <BookView
        ref={bookRef}
        doc={doc}
        settings={settings}
        initialSourcePage={restorePage}
        onChange={handleChange}
        onCenterTap={onCenterTap}
      />

      {/* First-run tap hint */}
      {showHint && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-between px-8 text-[11px] uppercase tracking-[0.25em]"
          style={{ color: oklch(surface.fg, 0.45) }}
        >
          <span>‹ prev</span>
          <span className="text-center leading-relaxed">
            tap edges to turn
            <br />
            center for menu
          </span>
          <span>next ›</span>
        </div>
      )}

      {/* Minimal always-on status when the chrome is hidden */}
      {!chrome && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-2.5 text-[11px] tracking-wide"
          style={{ color: oklch(surface.fg, 0.5) }}
        >
          <span>
            {pos.page} / {pos.total} · {Math.round(progress)}% · {minutesLeft} min left
          </span>
        </div>
      )}

      {/* Footer nav — auto-hides while reading */}
      <footer
        className={`absolute inset-x-0 bottom-0 z-30 backdrop-blur-xl border-t transition-all duration-300 ${
          chrome ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
        }`}
        style={surface.chrome}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 max-w-[1400px] mx-auto w-full">
          <button
            onClick={() => bookRef.current?.prev()}
            disabled={pos.page <= 1}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-ember hover:bg-muted/30 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mockingjay className="w-4 h-4 pin-glow" />
            <span>{Math.round(progress)}% survived</span>
          </div>
          <button
            onClick={() => bookRef.current?.next()}
            disabled={pos.page >= pos.total}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-ember hover:bg-muted/30 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* Settings panel */}
      {showSettings && (
        <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-full sm:w-96 bg-card border-l border-border p-6 overflow-y-auto ember-glow"
          >
            <div className="flex items-center justify-between mb-8">
              <h3 className="font-display text-lg uppercase tracking-[0.2em] text-ember">Reader</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <SettingGroup label="Theme">
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(THEMES) as ReaderTheme[]).map((t) => {
                  const { label, icon: Icon, bg, fg } = THEMES[t];
                  const active = settings.theme === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setSettings({ ...settings, theme: t })}
                      className={`flex items-center gap-2 py-2.5 px-3 rounded-md border text-xs uppercase tracking-wider transition-all ${
                        active
                          ? "border-ember text-ember ember-glow"
                          : "border-border text-muted-foreground hover:border-ember/40"
                      }`}
                    >
                      <span
                        className="grid place-items-center w-6 h-6 rounded-full shrink-0 border border-black/10"
                        style={{ background: oklch(bg), color: oklch(fg) }}
                      >
                        <Icon className="w-3 h-3" />
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </SettingGroup>

            <SettingGroup label="Font">
              <div className="grid grid-cols-2 gap-2">
                {FONT_OPTIONS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSettings({ ...settings, fontFamily: f.id })}
                    className={`py-3 rounded-md border text-sm transition-all ${
                      settings.fontFamily === f.id
                        ? "border-ember text-ember"
                        : "border-border text-muted-foreground hover:border-ember/40"
                    }`}
                    style={{ fontFamily: FONT_VARS[f.id] }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </SettingGroup>

            <SettingSlider
              label="Font size"
              value={settings.fontSize}
              min={14}
              max={28}
              step={1}
              suffix="px"
              onChange={(v) => setSettings({ ...settings, fontSize: v })}
            />
            <SettingSlider
              label="Line height"
              value={settings.lineHeight}
              min={1.3}
              max={2.2}
              step={0.05}
              onChange={(v) => setSettings({ ...settings, lineHeight: v })}
            />
            <SettingSlider
              label="Line width"
              value={settings.measure}
              min={45}
              max={90}
              step={1}
              suffix=" char"
              onChange={(v) => setSettings({ ...settings, measure: v })}
            />
            <SettingSlider
              label="Brightness"
              value={settings.brightness}
              min={0.85}
              max={1.15}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setSettings({ ...settings, brightness: v })}
            />
            <SettingSlider
              label="Side margin"
              value={settings.margin}
              min={0}
              max={80}
              step={4}
              suffix="px"
              onChange={(v) => setSettings({ ...settings, margin: v })}
            />
            {settings.paragraphStyle === "spaced" && (
              <SettingSlider
                label="Paragraph spacing"
                value={settings.paragraphSpacing}
                min={0.4}
                max={2.5}
                step={0.1}
                suffix="em"
                onChange={(v) => setSettings({ ...settings, paragraphSpacing: v })}
              />
            )}
            <SettingSlider
              label="Letter spacing"
              value={settings.letterSpacing}
              min={-0.02}
              max={0.12}
              step={0.01}
              suffix="em"
              onChange={(v) => setSettings({ ...settings, letterSpacing: v })}
            />

            <SettingGroup label="Text">
              <div className="space-y-2">
                <SettingToggle
                  label="Indent paragraphs"
                  checked={settings.paragraphStyle === "indented"}
                  onChange={(v) =>
                    setSettings({ ...settings, paragraphStyle: v ? "indented" : "spaced" })
                  }
                />
                <SettingToggle
                  label="Justify text"
                  checked={settings.justify}
                  onChange={(v) => setSettings({ ...settings, justify: v })}
                />
                <SettingToggle
                  label="Hyphenation"
                  checked={settings.hyphens}
                  onChange={(v) => setSettings({ ...settings, hyphens: v })}
                />
              </div>
            </SettingGroup>
          </div>
        </div>
      )}

      {/* TOC panel */}
      {showToc && (
        <div className="fixed inset-0 z-40" onClick={() => setShowToc(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-0 h-full w-full sm:w-96 bg-card border-r border-border p-6 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display text-lg uppercase tracking-[0.2em] text-ember">
                Contents
              </h3>
              <button
                onClick={() => setShowToc(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sections..."
                className="w-full bg-input/50 border border-border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-ember"
              />
            </div>
            <ul className="space-y-1">
              {filteredOutline.map((item, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      bookRef.current?.goToSourcePage(item.pageNumber);
                      setShowToc(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between gap-3 transition-colors ${
                      pos.sourcePage === item.pageNumber
                        ? "bg-ember/10 text-ember"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`}
                  >
                    <span
                      className="truncate"
                      style={{
                        paddingLeft: `${(item.title.match(/^\s*/)?.[0].length || 0) * 4}px`,
                      }}
                    >
                      {item.title.trim()}
                    </span>
                    <span className="text-xs opacity-50 shrink-0">{item.pageNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">{label}</p>
      {children}
    </div>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-ember/40"
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-ember" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function SettingSlider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
        <span className="text-xs text-ember font-mono">
          {format
            ? format(value)
            : `${!Number.isInteger(value) ? value.toFixed(2) : value}${suffix}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-ember"
      />
    </div>
  );
}
