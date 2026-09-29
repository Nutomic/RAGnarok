import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAGnarok",
  description:
    "DSGVO-first, permission-aware RAG assistant over internal documents, on a single PostgreSQL.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
