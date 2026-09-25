"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bot, Flame, MessageSquare, RotateCcw, Send, Sparkles, User } from "lucide-react";
import { useChat } from "@/lib/hooks";
import type { ChatMessage } from "@/lib/types";
import MarkdownText from "@/components/MarkdownText";
import clsx from "clsx";

const SUGGESTIONS: { label: string; query: string; icon: React.ElementType }[] = [
  { label: "System overview", query: "What's the current system status?", icon: Bot },
  { label: "Critical alerts", query: "Which facilities need immediate attention?", icon: Flame },
  { label: "FRP anomalies", query: "Show me facilities with FRP above baseline", icon: Sparkles },
  { label: "Recent changes", query: "What changed in the last 24 hours?", icon: MessageSquare },
  { label: "Risk explained", query: "Explain how risk scores are calculated", icon: Bot },
  { label: "Unidentified sources", query: "Are there any unidentified thermal sources?", icon: Flame },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const sameDay = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString();

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isLoading, clearMessages } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);

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

  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gradient-mesh">
      {/* header */}
      <div
        className="flex items-center justify-between border-b border-border-hairline px-5 py-3"
        style={{
          background: "rgba(10,13,16,0.6)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-primary/10">
            <Sparkles size={16} className="text-accent-primary" />
          </div>
          <div>
            <h1 className="font-display text-sm font-semibold text-text-primary">
              PyroSense AI
            </h1>
            <p className="font-body text-[10px] text-text-tertiary">
              Grounded in live FIRMS + facility data · not a general chatbot
            </p>
          </div>
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={clearMessages}
            aria-label="New conversation"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border-hairline px-3 text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary"
          >
            <RotateCcw size={12} />
            <span className="text-[11px]">New chat</span>
          </button>
        )}
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="pyro-scroll flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <EmptyState onPick={(q) => void sendMessage(q)} disabled={isLoading} />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-1.5 px-5 pb-6 pt-4">
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

      {/* composer */}
      <div
        className="border-t border-border-hairline px-5 py-3"
        style={{
          background: "rgba(10,13,16,0.6)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-end gap-2.5"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about thermal activity, risk scores, facility health…"
            disabled={isLoading}
            rows={1}
            aria-label="Message"
            className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-xl border border-border-hairline bg-bg-inset/50 px-4 py-3 font-body text-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/40 focus:outline-none focus:ring-1 focus:ring-accent-primary/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-xl bg-accent-primary text-white transition-all hover:opacity-90 disabled:opacity-25"
          >
            <Send size={15} />
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[10px] text-text-tertiary">
          Answers cite only live backend facts · Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

/* ── sub-components ────────────────────────────────────────────────── */

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
    <div className={clsx("flex animate-fade-in items-start gap-3 py-1.5", isUser && "flex-row-reverse")}>
      <div
        aria-hidden
        className={clsx(
          "mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl",
          isUser
            ? "bg-bg-raised text-text-secondary"
            : "bg-accent-primary/10 text-accent-primary",
        )}
      >
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>
      <div className={clsx("flex min-w-0 max-w-[80%] flex-col gap-1", isUser && "items-end")}>
        <div
          className={clsx(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-md bg-accent-primary/10 text-text-primary"
              : "rounded-tl-md border border-border-hairline bg-bg-surface/50 text-text-secondary backdrop-blur-sm",
          )}
        >
          {isUser ? message.text : <MarkdownText>{message.text}</MarkdownText>}
        </div>
        <div className={clsx("flex items-center gap-2 px-1", isUser && "flex-row-reverse")}>
          <span className="font-mono text-[10px] text-text-tertiary">
            {formatTime(message.timestamp)}
          </span>
          {!isUser && message.provider && (
            <span className="rounded bg-bg-inset/50 px-1.5 py-0.5 font-mono text-[9px] text-text-tertiary">
              {message.provider === "openrouter" ? "AI" : "template"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingRow() {
  return (
    <div className="flex animate-fade-in items-start gap-3 py-1.5" aria-live="polite">
      <div
        aria-hidden
        className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary"
      >
        <Sparkles size={14} />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-border-hairline bg-bg-surface/50 px-4 py-3 backdrop-blur-sm">
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
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-primary/[0.08]">
          <Sparkles size={28} className="text-accent-primary/60" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-text-primary">
            PyroSense AI Assistant
          </h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-secondary">
            Ask about facility health, thermal anomalies, risk classifications,
            or recent changes — answers are grounded in live data only.
          </p>
        </div>
      </div>

      <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map(({ label, query, icon: Icon }) => (
          <button
            key={query}
            type="button"
            onClick={() => onPick(query)}
            disabled={disabled}
            className="group flex items-center gap-3 rounded-xl border border-border-hairline bg-bg-surface/30 px-4 py-3 text-left backdrop-blur-sm transition-all hover:border-border-strong hover:bg-bg-raised/50 disabled:opacity-50"
          >
            <Icon size={14} className="flex-shrink-0 text-text-tertiary transition-colors group-hover:text-accent-primary" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary">{label}</p>
              <p className="truncate text-[10px] text-text-tertiary">{query}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
