import { useState } from "react";
import { Upload, Loader2 } from "lucide-react";

interface Props {
  loading: boolean;
  progress: { loaded: number; total: number };
  error: string | null;
  onFile: (f: File) => void;
  /** Compact variant for the Library shelf (vs. the full landing hero). */
  compact?: boolean;
}

export function DropZone({ loading, progress, error, onFile, compact = false }: Props) {
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
      className={`block mx-auto cursor-pointer rounded-lg border-2 border-dashed transition-all ${
        compact ? "max-w-full p-6" : "max-w-xl p-10"
      } ${drag ? "border-ember bg-ember/5 ember-glow" : "border-border/60 hover:border-ember/60 bg-card/30"}`}
    >
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={loading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Allow re-selecting the same file after a removal.
          e.target.value = "";
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
          <Upload className={`text-ember ${compact ? "w-5 h-5" : "w-6 h-6"}`} />
          <p className="font-display uppercase tracking-[0.25em] text-sm text-center">
            {compact ? "Add another book" : "Drop a PDF or click to choose"}
          </p>
          {!compact && <p className="text-xs text-muted-foreground">Up to a few hundred pages</p>}
        </div>
      )}
      {error && <p className="mt-4 text-sm text-destructive text-center">{error}</p>}
    </label>
  );
}
