"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";
import type { Citation } from "./citations";
import { Chat } from "./components/Chat";
import { Header } from "./components/Header";
import { Sources } from "./components/Sources";
import {
  type ChatStats,
  MAX_PROMPT_CHARS,
  PROFILES,
  profileAccent,
  sourcesOf,
} from "./components/types";

export default function Home() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const [profileId, setProfileId] = useState<string>(PROFILES[0].id);
  // Sources of the shown answer, held in state so a new question clears the
  // panel immediately and it fills again when the new answer's parts arrive.
  const [sources, setSources] = useState<Citation[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [chatStats, setChatStats] = useState<ChatStats | null>(null);
  const busy = status === "submitted" || status === "streaming";
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant");

  useEffect(() => {
    if (!lastAnswer || lastAnswer.id === answeredId) return;
    const s = sourcesOf(lastAnswer);
    if (s.length > 0) {
      setSources(s);
      setAnsweredId(lastAnswer.id);
      // aggregate stats refresh after each answer; the route caches 30 s
      fetch("/api/stats")
        .then((r) => r.json())
        .then((v: ChatStats) => setChatStats(v))
        .catch(() => {});
    }
  }, [lastAnswer, answeredId]);

  function submit(text: string) {
    if (!text.trim() || text.length > MAX_PROMPT_CHARS || busy) return;
    setInput("");
    setSources([]);
    setHighlightedId(null);
    sendMessage({ text }, { body: { profileId } });
  }

  return (
    <div className="flex min-h-full flex-col">
      <Header profileId={profileId} setProfileId={setProfileId} chatStats={chatStats} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-1 flex-col gap-4 md:flex-row">
          <Chat
            messages={messages}
            status={status}
            error={error}
            stop={stop}
            lastAnswerId={lastAnswer?.id ?? null}
            input={input}
            setInput={setInput}
            submit={submit}
            accent={profileAccent(profileId)}
            onCiteClick={(id) => {
              setHighlightedId(id);
              const el = document.getElementById(`quelle-${id}`);
              el?.scrollIntoView({
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
                block: "nearest",
              });
            }}
          />
          <Sources
            sources={sources}
            highlightedId={highlightedId}
            searching={status === "submitted"}
          />
        </div>
      </main>
    </div>
  );
}
