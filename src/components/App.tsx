import { useEffect, useState } from "react";
import { extractPdf } from "@/lib/pdf-extract";
import { saveDoc, listDocs, deleteDoc, renameDoc, type CachedDoc } from "@/lib/reader-store";
import { Library } from "./Library";
import { Reader } from "./Reader";

export function App() {
  const [docs, setDocs] = useState<CachedDoc[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Hydrate the shelf from IndexedDB on first load.
  useEffect(() => {
    listDocs()
      .then(setDocs)
      .catch(() => {});
  }, []);

  async function handleFile(file: File) {
    if (!file || file.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    setError(null);
    setWarning(null);
    setLoading(true);
    setProgress({ loaded: 0, total: 0 });
    try {
      const extracted = await extractPdf(file, (loaded, total) => setProgress({ loaded, total }));
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
      setError("Could not read this PDF. It may be encrypted or scanned.");
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
