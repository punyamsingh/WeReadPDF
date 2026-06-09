import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Block } from "@/lib/book-content";

/**
 * Read-aloud engine on the Web Speech API — free, on-device, no backend.
 *
 * The book is spoken one sentence per utterance rather than as one giant
 * utterance: that's what makes the current sentence trackable (for the visual
 * highlight and page-following), survives Chrome's habit of killing long
 * utterances, and gives natural pause/skip points. "Pause" is implemented as
 * cancel-and-remember — far more reliable across engines than
 * `speechSynthesis.pause()` — so resuming re-speaks the current sentence from
 * its start.
 */

export interface TtsSentence {
  srcPage: number;
  /** Paragraph index within the page block. */
  paraIdx: number;
  /** Character range of the sentence within its paragraph. */
  start: number;
  end: number;
  text: string;
}

export type TtsStatus = "idle" | "playing" | "paused";

/** Sentence splitter: runs of non-terminators ending in terminator(+closers). */
const SENTENCE_RE = /[^.!?…]+[.!?…]+[”’"')\]]*\s*|[^.!?…]+\s*$/g;

export function splitSentences(blocks: Block[]): TtsSentence[] {
  const out: TtsSentence[] = [];
  for (const b of blocks) {
    b.paras.forEach((para, paraIdx) => {
      const re = new RegExp(SENTENCE_RE);
      let m: RegExpExecArray | null;
      while ((m = re.exec(para))) {
        const text = m[0].trim();
        if (text) {
          out.push({
            srcPage: b.srcPage,
            paraIdx,
            start: m.index,
            end: m.index + m[0].length,
            text,
          });
        }
        if (m.index + m[0].length >= para.length) break;
      }
    });
  }
  return out;
}

const TTS_PREFS_KEY = "wereadpdf.tts";

function loadPrefs(): { rate: number; voiceURI: string | null } {
  try {
    const raw = localStorage.getItem(TTS_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        rate: typeof p.rate === "number" ? Math.min(2, Math.max(0.5, p.rate)) : 1,
        voiceURI: typeof p.voiceURI === "string" ? p.voiceURI : null,
      };
    }
  } catch {
    /* ignore */
  }
  return { rate: 1, voiceURI: null };
}

export function useTts(blocks: Block[]) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const sentences = useMemo(() => splitSentences(blocks), [blocks]);

  const [status, setStatus] = useState<TtsStatus>("idle");
  const [index, setIndex] = useState(-1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [prefs, setPrefs] = useState(loadPrefs);

  // Refs mirror the live values synchronously — utterance callbacks fire
  // between renders, and a stale "playing" there would double-advance.
  const statusRef = useRef<TtsStatus>("idle");
  const indexRef = useRef(-1);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const voicesRef = useRef(voices);
  voicesRef.current = voices;

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, [supported]);

  useEffect(() => {
    try {
      localStorage.setItem(TTS_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const setBoth = useCallback((s: TtsStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const speakAtRef = useRef<(i: number) => void>(() => {});
  const speakAt = useCallback(
    (i: number) => {
      if (!supported) return;
      const list = sentencesRef.current;
      if (i < 0 || i >= list.length) {
        // Ran off the end of the book.
        utterRef.current = null;
        indexRef.current = -1;
        setIndex(-1);
        setBoth("idle");
        window.speechSynthesis.cancel();
        return;
      }
      indexRef.current = i;
      setIndex(i);
      setBoth("playing");

      const u = new SpeechSynthesisUtterance(list[i].text);
      u.rate = prefsRef.current.rate;
      const v = voicesRef.current.find((vv) => vv.voiceURI === prefsRef.current.voiceURI);
      if (v) u.voice = v;
      // Identity guard: only the live utterance may advance the queue, so a
      // cancel (pause, jump, rate change) can never trigger a phantom skip.
      const advance = () => {
        if (utterRef.current !== u || statusRef.current !== "playing") return;
        speakAtRef.current(indexRef.current + 1);
      };
      u.onend = advance;
      u.onerror = advance;
      utterRef.current = u;
      window.speechSynthesis.cancel(); // clear any tail before queuing
      window.speechSynthesis.speak(u);
    },
    [supported, setBoth],
  );
  speakAtRef.current = speakAt;

  /** Start reading from the first sentence at/after the given source page. */
  const playFrom = useCallback(
    (srcPage: number) => {
      const list = sentencesRef.current;
      let i = list.findIndex((s) => s.srcPage >= srcPage);
      if (i === -1) i = 0;
      speakAt(i);
    },
    [speakAt],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== "playing") return;
    utterRef.current = null; // detach before cancel so onend can't advance
    setBoth("paused");
    window.speechSynthesis.cancel();
  }, [setBoth]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused" || indexRef.current < 0) return;
    speakAt(indexRef.current);
  }, [speakAt]);

  const stop = useCallback(() => {
    utterRef.current = null;
    indexRef.current = -1;
    setIndex(-1);
    setBoth("idle");
    if (supported) window.speechSynthesis.cancel();
  }, [setBoth, supported]);

  const skip = useCallback(
    (dir: 1 | -1) => {
      if (indexRef.current < 0) return;
      const next = Math.min(sentencesRef.current.length - 1, Math.max(0, indexRef.current + dir));
      speakAt(next);
    },
    [speakAt],
  );

  const setRate = useCallback(
    (rate: number) => {
      setPrefs((p) => ({ ...p, rate }));
      prefsRef.current = { ...prefsRef.current, rate };
      if (statusRef.current === "playing") speakAt(indexRef.current);
    },
    [speakAt],
  );

  const setVoiceURI = useCallback(
    (voiceURI: string | null) => {
      setPrefs((p) => ({ ...p, voiceURI }));
      prefsRef.current = { ...prefsRef.current, voiceURI };
      if (statusRef.current === "playing") speakAt(indexRef.current);
    },
    [speakAt],
  );

  // Never leave the synth talking after the reader unmounts.
  useEffect(() => {
    if (!supported) return;
    return () => {
      utterRef.current = null;
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const sentence = index >= 0 ? (sentences[index] ?? null) : null;

  return {
    supported,
    status,
    /** The sentence currently being spoken (null when idle). */
    sentence,
    rate: prefs.rate,
    voiceURI: prefs.voiceURI,
    voices,
    playFrom,
    pause,
    resume,
    stop,
    skip,
    setRate,
    setVoiceURI,
  };
}
