import { useMemo } from "react";

/**
 * A drift of glowing embers rising through the dark — the "girl on fire"
 * atmosphere behind the landing. Purely decorative (aria-hidden, no pointer
 * events) and silenced for prefers-reduced-motion by the global CSS rule.
 *
 * Positions/timings are derived deterministically from the spark index (a
 * cheap sine hash) so the server and client render the same markup and React
 * doesn't complain about a hydration mismatch.
 */
function spark(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const COUNT = 32;

export function EmberField() {
  const sparks = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const size = 2 + spark(i, 1) * 5;
        return {
          left: spark(i, 2) * 100,
          size,
          delay: spark(i, 3) * 16,
          duration: 10 + spark(i, 4) * 12,
          drift: (spark(i, 5) - 0.5) * 90,
          travel: 80 + spark(i, 6) * 30,
          opacity: 0.5 + spark(i, 7) * 0.5,
        };
      }),
    [],
  );

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {sparks.map((s, i) => (
        <span
          key={i}
          className="ember-spark"
          style={{
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
            ["--spark-drift" as string]: `${s.drift}px`,
            ["--spark-travel" as string]: `${s.travel}vh`,
            ["--spark-opacity" as string]: s.opacity,
          }}
        />
      ))}
    </div>
  );
}
