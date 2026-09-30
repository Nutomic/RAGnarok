import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "RAGnarok",
  description:
    "DSGVO-first, permission-aware RAG assistant over internal documents, on a single PostgreSQL.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`h-full antialiased ${sans.variable} ${serif.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
