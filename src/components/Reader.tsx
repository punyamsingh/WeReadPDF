import { useEffect, useMemo, useRef, useState } from "react";
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
  Flame,
} from "lucide-react";
import type { CachedDoc, ReaderTheme } from "@/lib/reader-store";
import {
  loadSettings,
  saveSettings,
  saveProgress,
  loadProgress,
  DEFAULT_SETTINGS,
  type ReaderSettings,
} from "@/lib/reader-store";

interface Props {
  doc: CachedDoc;
  onExit: () => void;
}

const WORDS_PER_MINUTE = 230;

// Reading surfaces are tuned by hand for comfortable contrast rather than
// maximum contrast. Pure-white-on-black (the old default) glows and smears in
// low light ("halation"), so the dark surfaces lift the background off black
// and pull the text below pure white. Each entry is [lightness, chroma, hue]
// in the oklch space — the same space the rest of the app's palette uses.
const THEMES: Record<
  ReaderTheme,
  { label: string; icon: typeof Moon; bg: [number, number, number]; fg: [number, number, number] }
> = {
  dark: { label: "Charcoal", icon: Moon, bg: [0.17, 0.012, 40], fg: [0.85, 0.018, 72] },
  night: { label: "Midnight", icon: MoonStar, bg: [0.12, 0.01, 35], fg: [0.73, 0.016, 65] },
  sepia: { label: "Sepia", icon: BookOpen, bg: [0.92, 0.04, 82], fg: [0.3, 0.035, 55] },
  light: { label: "Paper", icon: Sun, bg: [0.985, 0.004, 85], fg: [0.24, 0.02, 50] },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function oklch([l, c, h]: [number, number, number], alpha?: number) {
  const a = alpha === undefined ? "" : ` / ${alpha}`;
  return `oklch(${l.toFixed(3)} ${c} ${h}${a})`;
}

export function Reader({ doc, onExit }: Props) {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [page, setPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSettings(loadSettings());
    const prog = loadProgress(doc.key);
    if (prog) setPage(Math.min(prog.pageNumber, doc.pages.length));
  }, [doc.key, doc.pages.length]);

  useEffect(() => {
    saveProgress(doc.key, page, doc.pages.length);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [page, doc.key, doc.pages.length]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === " ")
        setPage((p) => Math.min(doc.pages.length, p + 1));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc.pages.length]);

  const current = doc.pages[page - 1];
  const wordsRemaining = useMemo(() => {
    return doc.pages.slice(page - 1).reduce((acc, p) => acc + p.text.split(/\s+/).length, 0);
  }, [doc.pages, page]);
  const minutesLeft = Math.max(1, Math.round(wordsRemaining / WORDS_PER_MINUTE));
  const progress = (page / doc.pages.length) * 100;

  const surface = useMemo(() => {
    const palette = THEMES[settings.theme] ?? THEMES.dark;
    const [bgL, bgC, bgH] = palette.bg;
    // Brightness dims/lifts the surface lightness. For dark themes lowering it
    // makes the page darker; for paper themes it softens a harsh white.
    const bg: [number, number, number] = [clamp(bgL * settings.brightness, 0.07, 0.99), bgC, bgH];
    const fg = palette.fg;
    return {
      // Inline styles for the reading root.
      root: { background: oklch(bg), color: oklch(fg) },
      // Header/footer float above the surface — tint them from the same color
      // so the chrome matches the page in every theme (the old translucent
      // near-black looked wrong on the light/sepia surfaces).
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
    <div className="min-h-screen flex flex-col" style={surface.root}>
      {/* Top bar */}
      <header className="sticky top-0 z-30 backdrop-blur-xl border-b" style={surface.chrome}>
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

      {/* Reader surface */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-12 sm:py-20">
        <article
          className="mx-auto animate-fade-up"
          style={{
            // Width follows the font size via the `ch` unit, so the line length
            // (the "measure") stays in the comfortable 45–90 character range no
            // matter how large the type is. `min(100%, …)` lets it shrink to fit
            // narrow screens instead of forcing a fixed pixel column.
            width: `min(100%, ${settings.measure}ch)`,
            fontFamily: settings.fontFamily === "serif" ? "var(--font-serif)" : "var(--font-sans)",
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
          }}
        >
          <div className="flex items-center gap-3 mb-10 opacity-60">
            <span className="font-display text-xs tracking-[0.4em] uppercase">
              Page {page} of {doc.pages.length}
            </span>
            <div className="h-px flex-1 bg-current opacity-30" />
            <span className="text-xs">{minutesLeft} min left</span>
          </div>

          {current?.text.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="mb-6" style={{ textAlign: "justify", hyphens: "auto" }}>
              {para}
            </p>
          ))}

          {!current?.text.trim() && (
            <p className="opacity-50 italic text-center">This page contains no extractable text.</p>
          )}
        </article>
      </main>

      {/* Footer nav */}
      <footer className="sticky bottom-0 z-30 backdrop-blur-xl border-t" style={surface.chrome}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 max-w-[1400px] mx-auto w-full">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-ember hover:bg-muted/30 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Flame className="w-3 h-3 text-ember animate-flicker" />
            <span>{Math.round(progress)}% kindled</span>
          </div>
          <button
            onClick={() => setPage((p) => Math.min(doc.pages.length, p + 1))}
            disabled={page >= doc.pages.length}
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
                {(["serif", "sans"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSettings({ ...settings, fontFamily: f })}
                    className={`py-3 rounded-md border text-sm transition-all ${
                      settings.fontFamily === f
                        ? "border-ember text-ember"
                        : "border-border text-muted-foreground hover:border-ember/40"
                    }`}
                    style={{ fontFamily: f === "serif" ? "var(--font-serif)" : "var(--font-sans)" }}
                  >
                    {f === "serif" ? "Garamond" : "Inter"}
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
                      setPage(item.pageNumber);
                      setShowToc(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between gap-3 transition-colors ${
                      page === item.pageNumber
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
