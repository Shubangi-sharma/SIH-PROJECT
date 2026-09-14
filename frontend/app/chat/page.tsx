"use client";

import React, { useEffect, useRef, useState } from "react";
import { Send, Trash2, Sparkles, Bot, User, RotateCcw } from "lucide-react";
import { useChat } from "@/lib/hooks";
import type { ChatMessage } from "@/lib/types";
import MarkdownText from "@/components/MarkdownText";
import clsx from "clsx";

/** Suggested starter questions — grouped by intent. */
const SUGGESTIONS: { label: string; query: string }[] = [
  { label: "System status", query: "What's the current system status?" },
  { label: "Critical sites", query: "Which facilities need immediate attention?" },
  { label: "FRP anomalies", query: "Show me facilities with FRP above baseline" },
  { label: "Last 24 hours", query: "What changed in the last 24 hours?" },
  { label: "Risk scores", query: "Explain how risk scores are calculated" },
  { label: "Unknown sources", query: "Are there any unidentified thermal sources?" },
];

/** HH:MM timestamp in the user's locale. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Same-day check — timestamps collapse to time only when recent. */
const sameDay = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString();

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isLoading, clearMessages } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);

  // Auto-scroll, but respect the user scrolling back through history.
  useEffect(() => {
    if (scrollRef.current && stickToBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    // The textarea auto-resets to 1 row once emptied.
    if (inputRef.current) inputRef.current.style.height = "auto";
    stickToBottomRef.current = true;
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-grow textarea (capped).
  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border-hairline px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary">
            <Bot size={16} />
          </div>
          <div>
            <h1 className="font-display text-sm font-semibold text-text-primary">
              PYRO AI Assistant
            </h1>
            <p className="font-mono text-[10px] text-text-tertiary">
              grounded in live FIRMS + facility data
            </p>
          </div>
          <span
            aria-hidden
            className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent-secondary/70"
          />
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={clearMessages}
            aria-label="Clear conversation"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border-hairline px-3 text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary"
          >
            <RotateCcw size={12} />
            <span className="text-[11px]">New chat</span>
          </button>
        )}
      </div>

      {/* ── messages ───────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="pyro-scroll flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => void sendMessage(q)} disabled={isLoading} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1 px-6 pb-6 pt-4">
            {messages.map((msg, i) => {
              const prev = messages[i - 1];
              const showTime =
                !prev || !sameDay(prev.timestamp, msg.timestamp) || msg.timestamp - prev.timestamp > 10 * 60_000;
              return (
                <React.Fragment key={i}>
                  {showTime && <TimeDivider ts={msg.timestamp} />}
                  <MessageRow message={msg} />
                </React.Fragment>
              );
            })}
            {isLoading && <TypingRow />}
          </div>
        )}
      </div>

      {/* ── composer ───────────────────────────────────────────── */}
      <div className="border-t border-border-hairline bg-bg-base/60 px-6 py-3.5">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2.5"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about facilities, thermal activity, risk scores…"
            disabled={isLoading}
            rows={1}
            aria-label="Message"
            className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-xl border border-border-hairline bg-bg-inset px-4 py-3 font-body text-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/40 focus:outline-none focus:ring-1 focus:ring-accent-primary/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-xl border border-accent-primary/20 bg-accent-primary/10 text-accent-primary transition-colors hover:border-accent-primary/35 hover:bg-accent-primary/20 disabled:opacity-25"
          >
            <Send size={15} />
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center font-mono text-[10px] text-text-tertiary">
          Answers cite only live backend facts · Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────── */

function TimeDivider({ ts }: { ts: number }) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return (
    <div className="flex items-center gap-3 py-3" aria-hidden>
      <span className="h-px flex-1 bg-border-hairline" />
      <span className="font-mono text-[10px] text-text-tertiary">
        {today ? "Today" : d.toLocaleDateString()} {formatTime(ts)}
      </span>
      <span className="h-px flex-1 bg-border-hairline" />
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={clsx(
        "flex animate-fade-in items-start gap-3 py-2",
        isUser && "flex-row-reverse",
      )}
    >
      <div
        aria-hidden
        className={clsx(
          "mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border",
          isUser
            ? "border-border-hairline bg-bg-raised text-text-secondary"
            : "border-accent-primary/20 bg-accent-primary/10 text-accent-primary",
        )}
      >
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>
      <div className={clsx("flex min-w-0 max-w-[78%] flex-col gap-1", isUser && "items-end")}>
        <div
          className={clsx(
            "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
            isUser
              ? "whitespace-pre-wrap rounded-tr-sm border border-border-hairline bg-bg-raised text-text-primary"
              : "rounded-tl-sm border border-border-hairline bg-bg-surface text-text-secondary",
          )}
        >
          {isUser ? message.text : <MarkdownText>{message.text}</MarkdownText>}
        </div>
        <div className={clsx("flex items-center gap-2 px-1", isUser && "flex-row-reverse")}>
          <span className="font-mono text-[10px] text-text-tertiary">
            {formatTime(message.timestamp)}
          </span>
          {!isUser && message.provider && (
            <span className="font-mono text-[10px] text-text-tertiary/80">
              {message.provider === "openrouter" ? "AI" : "fallback"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingRow() {
  return (
    <div className="flex animate-fade-in items-start gap-3 py-2" aria-live="polite">
      <div
        aria-hidden
        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10 text-accent-primary"
      >
        <Bot size={13} />
      </div>
      <div className="flex items-center gap-1.5 rounded-xl rounded-tl-sm border border-border-hairline bg-bg-surface px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-text-tertiary"
            style={{ animation: `typing-dot 1.2s ease-in-out ${i * 0.18}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (q: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border-hairline bg-bg-surface">
          <Sparkles size={22} className="text-accent-primary/80" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-text-primary">
            Ask about your monitoring data
          </h2>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
            I can see live facility health scores, FIRMS detections, thermal
            baselines, and anomaly classifications — and I only answer from
            those facts.
          </p>
        </div>
      </div>

      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map(({ label, query }) => (
          <button
            key={query}
            type="button"
            onClick={() => onPick(query)}
            disabled={disabled}
            className="group flex items-center justify-between rounded-xl border border-border-hairline bg-bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-bg-raised disabled:opacity-50"
          >
            <span>
              <span className="block text-[13px] font-medium text-text-primary">
                {label}
              </span>
              <span className="block truncate text-[11px] text-text-tertiary">
                {query}
              </span>
            </span>
            <Send
              size={12}
              className="flex-shrink-0 text-text-tertiary transition-colors group-hover:text-accent-primary"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
