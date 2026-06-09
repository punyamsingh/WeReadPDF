// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Force-enable the Nitro deploy plugin and target Vercel. Without this, on a
  // non-Lovable host (i.e. Vercel's CI) `options.nitro` is undefined, so Nitro
  // is skipped and `vite build` emits no server — Vercel has nothing to serve
  // and every route 404s. The `vercel` preset produces a `.vercel/output` Build
  // Output that Vercel auto-detects. Inside the Lovable sandbox this preset is
  // overridden to cloudflare-module automatically, so the preview is unaffected.
  nitro: { preset: "vercel" },
});
