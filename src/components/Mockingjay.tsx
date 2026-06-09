import pinUrl from "@/assets/mockingjay.svg";

/** The Mockingjay pin (src/assets/mockingjay.svg) — decorative brand mark. */
export function Mockingjay({ className }: { className?: string }) {
  return <img src={pinUrl} alt="" aria-hidden="true" className={className} />;
}
