import { useCallback, useRef } from "react";

// Text-size bounds for the pinch gesture — kept in lockstep with the font-size
// slider in the reader settings (Reader.tsx) so pinching and the slider can't
// disagree on the legal range.
export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 28;

// After the last finger of a pinch lifts we keep reporting "pinching" for this
// long, so the trailing pointerup isn't mistaken for a page-turn tap.
const PINCH_GRACE_MS = 350;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface PinchHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  /**
   * True while two fingers are actively pinching, and briefly afterwards — the
   * host reader checks this to suppress its tap/swipe page-turn handling so a
   * pinch never also flips the page.
   */
  isPinching: () => boolean;
}

/**
 * Kindle-style pinch-to-resize-text. Because the book is reflowable HTML rather
 * than a fixed PDF canvas, "zoom" maps to the body font size: spreading two
 * fingers enlarges the text (and reflows it), pinching them shrinks it. The new
 * size is reported through `onFontSize`, which the reader persists like any
 * other typography setting.
 *
 * Returns pointer handlers the host merges into the reading surface alongside
 * its existing single-finger tap/swipe handlers; multi-touch is tracked here.
 */
export function usePinchZoom(fontSize: number, onFontSize: (size: number) => void): PinchHandlers {
  // Live mirror of the current font size, so the move handler always scales from
  // the value at pinch start without re-binding on every size change.
  const fontRef = useRef(fontSize);
  fontRef.current = fontSize;

  // Active touch points by pointer id, the finger spread at pinch start, and the
  // font size we're scaling from.
  const points = useRef(new Map<number, { x: number; y: number }>());
  const startDist = useRef(0);
  const startFont = useRef(fontSize);
  const pinching = useRef(false);
  const endedAt = useRef(0);

  const spread = () => {
    const pts = Array.from(points.current.values());
    if (pts.length < 2) return 0;
    const [a, b] = pts;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.current.size === 2) {
      startDist.current = spread();
      startFont.current = fontRef.current;
      pinching.current = true;
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!points.current.has(e.pointerId)) return;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinching.current || points.current.size < 2 || startDist.current <= 0) return;
      const ratio = spread() / startDist.current;
      const next = Math.round(clamp(startFont.current * ratio, FONT_SIZE_MIN, FONT_SIZE_MAX));
      if (next !== fontRef.current) onFontSize(next);
    },
    [onFontSize],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!points.current.delete(e.pointerId)) return;
    if (pinching.current && points.current.size < 2) {
      pinching.current = false;
      endedAt.current = Date.now();
    }
  }, []);

  const isPinching = useCallback(
    () => pinching.current || Date.now() - endedAt.current < PINCH_GRACE_MS,
    [],
  );

  return { onPointerDown, onPointerMove, onPointerUp, isPinching };
}
