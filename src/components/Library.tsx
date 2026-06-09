import { useMemo, useState } from "react";
import { Lock, BookOpen, Type, Pencil, Trash2, Check, X } from "lucide-react";
import { loadProgress, type CachedDoc } from "@/lib/reader-store";
import { DropZone } from "./DropZone";
import { Mockingjay } from "./Mockingjay";

interface Props {
  docs: CachedDoc[];
  loading: boolean;
  progress: { loaded: number; total: number };
  error: string | null;
  warning: string | null;
  onFile: (f: File) => void;
  onOpen: (doc: CachedDoc) => void;
  onRemove: (key: string) => void;
  onRename: (key: string, title: string) => void;
}

interface ShelfItem {
  doc: CachedDoc;
  pages: number;
  pct: number;
  finished: boolean;
  lastOpened: number;
}

export function Library({
  docs,
  loading,
  progress,
  error,
  warning,
  onFile,
  onOpen,
  onRemove,
  onRename,
}: Props) {
  // Build view models (progress + last-opened) and sort by most recent.
  const items = useMemo<ShelfItem[]>(() => {
    return docs
      .map((doc) => {
        const prog = loadProgress(doc.key);
        const pages = doc.pages.length;
        const pct = prog ? Math.round((prog.pageNumber / Math.max(1, prog.total)) * 100) : 0;
        return {
          doc,
          pages,
          pct,
          finished: pct >= 100,
          lastOpened: prog?.updatedAt ?? doc.savedAt,
        };
      })
      .sort((a, b) => b.lastOpened - a.lastOpened);
  }, [docs]);

  const continueItem = items.find((it) => it.pct > 0 && !it.finished) ?? null;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Ember atmospherics */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--ember) 0%, transparent 60%)" }}
        />
        <div
          className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 60%)" }}
        />
      </div>

      {/* Nav */}
      <nav className="px-6 sm:px-10 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <Mockingjay className="w-7 h-7 pin-glow" />
          <span className="font-display tracking-[0.3em] text-sm uppercase">WeReadPDF</span>
        </div>
        <span className="flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Lock className="w-3 h-3" /> District-local
        </span>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          loading={loading}
          progress={progress}
          error={error}
          warning={warning}
          onFile={onFile}
        />
      ) : (
        <Shelf
          items={items}
          continueItem={continueItem}
          loading={loading}
          progress={progress}
          error={error}
          warning={warning}
          onFile={onFile}
          onOpen={onOpen}
          onRemove={onRemove}
          onRename={onRename}
        />
      )}

      <footer className="px-6 sm:px-10 py-10 border-t border-border/40 text-center text-xs text-muted-foreground tracking-wider">
        <span className="font-display uppercase tracking-[0.3em]">WeReadPDF</span> — read in your
        own district. May the odds be ever in your favor.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Populated shelf
// ---------------------------------------------------------------------------

function Shelf({
  items,
  continueItem,
  loading,
  progress,
  error,
  warning,
  onFile,
  onOpen,
  onRemove,
  onRename,
}: {
  items: ShelfItem[];
  continueItem: ShelfItem | null;
  loading: boolean;
  progress: { loaded: number; total: number };
  error: string | null;
  warning: string | null;
  onFile: (f: File) => void;
  onOpen: (doc: CachedDoc) => void;
  onRemove: (key: string) => void;
  onRename: (key: string, title: string) => void;
}) {
  return (
    <section className="px-6 sm:px-10 pb-20 max-w-6xl mx-auto">
      <p className="text-xs uppercase tracking-[0.4em] text-ember mb-2">— Your tributes —</p>
      <h1 className="font-display font-black tracking-tight text-3xl sm:text-5xl mb-10">
        The Archive of Panem
      </h1>

      {continueItem && (
        <div className="mb-12">
          <ContinueHero item={continueItem} onResume={() => onOpen(continueItem.doc)} />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <BookCard
            key={item.doc.key}
            item={item}
            onOpen={() => onOpen(item.doc)}
            onRemove={() => onRemove(item.doc.key)}
            onRename={(title) => onRename(item.doc.key, title)}
          />
        ))}

        {/* Add-another tile lives in the grid flow. */}
        <div className="min-h-[150px]">
          <DropZone compact loading={loading} progress={progress} error={error} onFile={onFile} />
        </div>
      </div>

      {warning && <p className="mt-6 text-sm text-amber-400/80">{warning}</p>}
    </section>
  );
}

function ContinueHero({ item, onResume }: { item: ShelfItem; onResume: () => void }) {
  return (
    <button
      onClick={onResume}
      className="group flex w-full items-center gap-5 rounded-lg border border-ember/30 bg-card/40 p-6 text-left backdrop-blur transition-all hover:border-ember/60 hover:bg-card/70 ember-glow"
    >
      <BookCover title={item.doc.title} large />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.3em] text-ember/70">Return to the arena</p>
        <p className="mt-1 truncate font-serif text-2xl text-foreground">{item.doc.title}</p>
        {item.doc.author && (
          <p className="truncate text-sm text-muted-foreground">by {item.doc.author}</p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <KindleBar pct={item.pct} />
          <span className="shrink-0 text-xs text-ember">{item.pct}% survived</span>
        </div>
      </div>
      <Mockingjay className="hidden h-8 w-8 shrink-0 pin-glow transition-transform group-hover:scale-110 sm:block" />
    </button>
  );
}

function BookCard({
  item,
  onOpen,
  onRemove,
  onRename,
}: {
  item: ShelfItem;
  onOpen: () => void;
  onRemove: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.doc.title);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function commitRename() {
    const next = draft.trim();
    if (next && next !== item.doc.title) onRename(next);
    setEditing(false);
  }

  return (
    <div className="group relative flex flex-col rounded-lg border border-border/60 bg-card/40 p-5 backdrop-blur transition-all hover:border-ember/40 hover:bg-card/70">
      <button
        onClick={onOpen}
        disabled={editing}
        className="flex flex-1 items-start gap-4 text-left"
        aria-label={`Open ${item.doc.title}`}
      >
        <BookCover title={item.doc.title} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditing(false);
              }}
              onClick={(e) => e.preventDefault()}
              className="w-full bg-input/50 border border-ember/40 rounded px-2 py-1 text-sm focus:outline-none focus:border-ember"
            />
          ) : (
            <p className="font-serif text-base leading-snug text-foreground line-clamp-2">
              {item.doc.title}
            </p>
          )}
          {item.doc.author && !editing && (
            <p className="mt-1 truncate text-xs text-muted-foreground">by {item.doc.author}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            {item.pages} {item.pages === 1 ? "page" : "pages"} · {relativeTime(item.lastOpened)}
          </p>
        </div>
      </button>

      <div className="mt-4 flex items-center gap-3">
        <KindleBar pct={item.pct} />
        <span className="shrink-0 text-[11px] text-ember">
          {item.finished ? "Victor" : `${item.pct}% survived`}
        </span>
      </div>

      {/* Per-book actions */}
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {editing ? (
          <>
            <IconButton label="Save name" onClick={commitRename}>
              <Check className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton label="Cancel" onClick={() => setEditing(false)}>
              <X className="w-3.5 h-3.5" />
            </IconButton>
          </>
        ) : confirmRemove ? (
          <>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Remove?
            </span>
            <IconButton label="Confirm remove" danger onClick={onRemove}>
              <Check className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton label="Keep book" onClick={() => setConfirmRemove(false)}>
              <X className="w-3.5 h-3.5" />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton
              label="Rename"
              onClick={() => {
                setDraft(item.doc.title);
                setEditing(true);
              }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton label="Remove" danger onClick={() => setConfirmRemove(true)}>
              <Trash2 className="w-3.5 h-3.5" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded-md bg-background/70 p-1.5 backdrop-blur transition-colors ${
        danger
          ? "text-muted-foreground hover:text-destructive"
          : "text-muted-foreground hover:text-ember"
      }`}
    >
      {children}
    </button>
  );
}

function BookCover({ title, large = false }: { title: string; large?: boolean }) {
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded border border-ember/20 ${
        large ? "h-24 w-16" : "h-16 w-11"
      }`}
      style={{ background: "linear-gradient(150deg, var(--card) 0%, rgba(0,0,0,0.4) 100%)" }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background: "radial-gradient(circle at 30% 20%, var(--ember) 0%, transparent 70%)",
        }}
      />
      <span className={`relative font-display text-ember ${large ? "text-2xl" : "text-lg"}`}>
        {initial}
      </span>
    </div>
  );
}

function KindleBar({ pct }: { pct: number }) {
  return (
    <div className="h-1 flex-1 overflow-hidden rounded bg-border/40">
      <div
        className="h-full bg-gradient-to-r from-ember to-accent transition-all"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          boxShadow: "0 0 10px var(--ember-glow)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — the landing hero, shown when the shelf is bare.
// ---------------------------------------------------------------------------

function EmptyState({
  loading,
  progress,
  error,
  warning,
  onFile,
}: {
  loading: boolean;
  progress: { loaded: number; total: number };
  error: string | null;
  warning: string | null;
  onFile: (f: File) => void;
}) {
  return (
    <>
      <section className="relative px-6 sm:px-10 pt-12 sm:pt-20 pb-20 max-w-4xl mx-auto text-center">
        {/* The Mockingjay, smouldering over the page */}
        <Mockingjay className="pointer-events-none absolute left-1/2 top-0 -z-10 w-[440px] -translate-x-1/2 -translate-y-16 opacity-[0.08]" />
        <p className="text-xs uppercase tracking-[0.4em] text-ember mb-6 animate-fade-up">
          — Welcome, tribute —
        </p>
        <h1
          className="font-display font-black tracking-tight text-5xl sm:text-7xl leading-[1.05] animate-fade-up"
          style={{ animationDelay: "0.1s" }}
        >
          May the words be
          <br />
          <span className="text-ember">ever in your favor.</span>
        </h1>
        <p
          className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto font-serif italic animate-fade-up"
          style={{ animationDelay: "0.2s" }}
        >
          PDFs were built for paper. WeReadPDF reaps them into clean, flowing text you can actually
          read on any screen — every tribute read in your own private arena.
        </p>

        <div className="mt-12 animate-fade-up" style={{ animationDelay: "0.3s" }}>
          <DropZone loading={loading} progress={progress} error={error} onFile={onFile} />
        </div>

        {warning && <p className="mt-4 text-sm text-amber-400/80 text-center">{warning}</p>}

        <p className="mt-6 text-xs text-muted-foreground/60 tracking-wide">
          Files never leave your device. No upload. No account. No trace.
        </p>
      </section>

      <section className="px-6 sm:px-10 py-20 max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="group p-8 rounded-lg border border-border/60 bg-card/40 backdrop-blur hover:border-ember/40 transition-all duration-500 hover:bg-card/80"
            >
              <f.icon className="w-5 h-5 text-ember mb-4 group-hover:animate-flicker" />
              <h3 className="font-display uppercase tracking-[0.2em] text-sm mb-3">{f.title}</h3>
              <p className="text-sm text-muted-foreground font-serif leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const FEATURES = [
  {
    icon: BookOpen,
    title: "The Arena",
    body: "Flowing text styled like a real book — screen-sized pages you turn with a tap. Font, width, spacing, and theme all bend to your will.",
  },
  {
    icon: Type,
    title: "Tribute Typography",
    body: "Garamond serif or Inter sans. Sizes from intimate to grand. Tune every letter like a weapon before the Games.",
  },
  {
    icon: Lock,
    title: "Sealed in Your District",
    body: "Every page is reaped in your browser. Nothing is uploaded. Nothing is tracked. No Capitol watching.",
  },
];

// Coarse "time ago" — good enough for a shelf, no dependency needed.
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
