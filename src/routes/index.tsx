import { createFileRoute } from "@tanstack/react-router";
import { App } from "@/components/App";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WeReadPDF — Read PDFs Like Ebooks" },
      { name: "description", content: "Transform any PDF into a clean, distraction-free reading experience. Local-first, private, beautifully typeset." },
      { property: "og:title", content: "WeReadPDF" },
      { property: "og:description", content: "May the words be ever in your favor." },
    ],
  }),
  component: Index,
});

function Index() {
  return <App />;
}
