if (typeof globalThis.DOMMatrix === "undefined") {
  // Stub DOMMatrix for server-side rendering (Node.js/Nitro), where the DOM
  // global is absent. pdfjs-dist references DOMMatrix at *import* time, which
  // crashes SSR before any code runs. This stub only needs to make that import
  // succeed — it is never exercised on the server (PDF parsing happens in the
  // browser), so the methods are intentionally absent. If pdfjs ever calls into
  // DOMMatrix server-side, replace this with a real polyfill rather than padding
  // out empty methods here.
  globalThis.DOMMatrix = class DOMMatrix {} as unknown as typeof DOMMatrix;
}
