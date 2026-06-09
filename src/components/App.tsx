import { useEffect, useState } from "react";
import { Upload, Flame, BookOpen, Lock, Type, Loader2 } from "lucide-react";
import { extractPdf } from "@/lib/pdf-extract";
import { cacheDoc, loadCachedDoc, clearCachedDoc, type CachedDoc } from "@/lib/reader-store";
import { Reader } from "./Reader";

export function App() {
  const [doc, setDoc] = useState<CachedDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = loadCachedDoc();
    if (cached) setDoc(cached);
  }, []);

  async function handleFile(file: File) {
    if (!file || file.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    setError(null);
    setLoading(true);
    setProgress({ loaded: 0, total: 0 });
    try {
      const extracted = await extractPdf(file, (loaded, total) =>
        setProgress({ loaded, total }),
      );
      const cached: CachedDoc = {
        key: `${file.name}-${file.size}`,
        title: extracted.title,
        pages: extracted.pages,
        outline: extracted.outline,
        wordCount: extracted.wordCount,
        savedAt: Date.now(),
      };
      cacheDoc(cached);
      setDoc(cached);
    } catch (e) {
      console.error(e);
      setError("Could not read this PDF. It may be encrypted or scanned.");
    } finally {
      setLoading(false);
    }
  }

  if (doc) {
    return (
      <Reader
        doc={doc}
        onExit={() => {
          setDoc(null);
          clearCachedDoc();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Ember atmospherics */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle, var(--ember) 0%, transparent 60%)" }} />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 60%)" }} />
      </div>

      {/* Nav */}
      <nav className="px-6 sm:px-10 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-ember animate-flicker" />
          <span className="font-display tracking-[0.3em] text-sm uppercase">WeReadPDF</span>
        </div>
        <div className="hidden sm:flex items-center gap-8 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <a href="#features" className="hover:text-ember transition">Features</a>
          <a href="#how" className="hover:text-ember transition">How it works</a>
          <span className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> Local-only</span>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 sm:px-10 pt-12 sm:pt-24 pb-20 max-w-4xl mx-auto text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-ember mb-6 animate-fade-up">
          — A spark for the page —
        </p>
        <h1
          className="font-display font-black tracking-tight text-5xl sm:text-7xl leading-[1.05] animate-fade-up"
          style={{ animationDelay: "0.1s" }}
        >
          May the words be<br />
          <span className="text-ember">ever in your favor.</span>
        </h1>
        <p
          className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto font-serif italic animate-fade-up"
          style={{ animationDelay: "0.2s" }}
        >
          PDFs were built for paper. WeReadPDF strips them to their flame —
          clean, flowing text you can actually read on any screen.
        </p>

        <div className="mt-12 animate-fade-up" style={{ animationDelay: "0.3s" }}>
          <DropZone loading={loading} progress={progress} error={error} onFile={handleFile} />
        </div>

        <p className="mt-6 text-xs text-muted-foreground/60 tracking-wide">
          Files never leave your device. No upload. No account. No trace.
        </p>
      </section>

      {/* Features */}
      <section id="features" className="px-6 sm:px-10 py-20 max-w-6xl mx-auto">
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

      {/* How */}
      <section id="how" className="px-6 sm:px-10 py-20 max-w-3xl mx-auto text-center">
        <h2 className="font-display uppercase tracking-[0.3em] text-ember text-sm mb-6">The Reaping</h2>
        <p className="font-serif text-2xl sm:text-3xl italic leading-relaxed text-foreground/90">
          "Choose your tribute. We'll extract its text, light the page in ember,
          and remember exactly where you stopped reading — even if the world goes dark."
        </p>
        <div className="mt-12 flex items-center justify-center gap-4 text-xs uppercase tracking-[0.25em] text-muted-foreground">
          <span>1. Open</span>
          <span className="text-ember">·</span>
          <span>2. Extract</span>
          <span className="text-ember">·</span>
          <span>3. Read</span>
        </div>
      </section>

      <footer className="px-6 sm:px-10 py-10 border-t border-border/40 text-center text-xs text-muted-foreground tracking-wider">
        <span className="font-display uppercase tracking-[0.3em]">WeReadPDF</span> — kindled locally, in your browser.
      </footer>
    </div>
  );
}

const FEATURES = [
  { icon: BookOpen, title: "Reader Mode", body: "Flowing text styled like a real book. Adjustable font, width, spacing, and theme." },
  { icon: Type, title: "Typography Control", body: "Garamond serif or Inter sans. Sizes from intimate to grand. Tune it like an instrument." },
  { icon: Lock, title: "Privacy First", body: "Every page is processed in your browser. Nothing is uploaded. Nothing is tracked." },
];

function DropZone({
  loading,
  progress,
  error,
  onFile,
}: {
  loading: boolean;
  progress: { loaded: number; total: number };
  error: string | null;
  onFile: (f: File) => void;
}) {
  const [drag, setDrag] = useState(false);

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`block max-w-xl mx-auto cursor-pointer rounded-lg border-2 border-dashed p-10 transition-all ${
        drag ? "border-ember bg-ember/5 ember-glow" : "border-border/60 hover:border-ember/60 bg-card/30"
      }`}
    >
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={loading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {loading ? (
        <div className="flex flex-col items-center gap-3 text-ember">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-sm uppercase tracking-[0.25em]">
            Kindling page {progress.loaded} {progress.total ? `of ${progress.total}` : ""}
          </p>
          {progress.total > 0 && (
            <div className="w-full max-w-xs h-1 bg-border/40 rounded overflow-hidden">
              <div
                className="h-full bg-ember transition-all"
                style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Upload className="w-6 h-6 text-ember" />
          <p className="font-display uppercase tracking-[0.25em] text-sm">Drop a PDF or click to choose</p>
          <p className="text-xs text-muted-foreground">Up to a few hundred pages</p>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-destructive text-center">{error}</p>}
    </label>
  );
}
