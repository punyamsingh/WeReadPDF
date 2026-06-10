import { useEffect, useState } from "react";
import { extractPdf, type ExtractPhase } from "@/lib/pdf-extract";
import { saveDoc, listDocs, deleteDoc, renameDoc, type CachedDoc } from "@/lib/reader-store";
import { countAnnotationsByDoc } from "@/lib/annotations";
import { Library } from "./Library";
import { Reader } from "./Reader";

export interface ImportProgress {
  loaded: number;
  total: number;
  phase: ExtractPhase;
}

export function App() {
  const [docs, setDocs] = useState<CachedDoc[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>({
    loaded: 0,
    total: 0,
    phase: "extract",
  });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [annCounts, setAnnCounts] = useState<Map<string, number>>(new Map());

  // Hydrate the shelf from IndexedDB on first load.
  useEffect(() => {
    listDocs()
      .then(setDocs)
      .catch(() => {});
  }, []);

  // Annotation counts for the shelf badges — refreshed whenever the reader
  // closes, since marks are made while reading.
  useEffect(() => {
    if (openKey) return;
    countAnnotationsByDoc()
      .then(setAnnCounts)
      .catch(() => {});
  }, [openKey]);

  async function handleFile(file: File) {
    if (!file || file.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    setError(null);
    setWarning(null);
    setLoading(true);
    setProgress({ loaded: 0, total: 0, phase: "extract" });
    try {
      const extracted = await extractPdf(file, (loaded, total, phase) =>
        setProgress({ loaded, total, phase: phase ?? "extract" }),
      );
      const cached: CachedDoc = {
        key: `${file.name}-${file.size}`,
        title: extracted.title,
        author: extracted.author,
        pages: extracted.pages,
        outline: extracted.outline,
        wordCount: extracted.wordCount,
        savedAt: Date.now(),
      };
      try {
        await saveDoc(cached);
      } catch (saveErr) {
        // Reading still works this session; we just couldn't persist it.
        console.error(saveErr);
        setWarning("Couldn't save this book to your shelf — you can still read it now.");
      }
      // Upsert into the shelf (replace any existing record with the same key).
      setDocs((prev) => [cached, ...prev.filter((d) => d.key !== cached.key)]);
      setOpenKey(cached.key);
    } catch (e) {
      console.error(e);
      setError(
        "Could not pull any text out of this PDF. It may be encrypted, or a scan the OCR couldn't decipher.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(key: string) {
    try {
      await deleteDoc(key);
    } catch (e) {
      console.error(e);
    }
    setDocs((prev) => prev.filter((d) => d.key !== key));
    if (openKey === key) setOpenKey(null);
  }

  async function handleRename(key: string, title: string) {
    try {
      await renameDoc(key, title);
    } catch (e) {
      console.error(e);
    }
    setDocs((prev) => prev.map((d) => (d.key === key ? { ...d, title } : d)));
  }

  const openDoc = openKey ? (docs.find((d) => d.key === openKey) ?? null) : null;

  if (openDoc) {
    return <Reader doc={openDoc} onExit={() => setOpenKey(null)} />;
  }

  return (
    <Library
      docs={docs}
      annCounts={annCounts}
      loading={loading}
      progress={progress}
      error={error}
      warning={warning}
      onFile={handleFile}
      onOpen={(doc) => setOpenKey(doc.key)}
      onRemove={handleRemove}
      onRename={handleRename}
    />
  );
}
