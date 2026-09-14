"use client";

import React from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * MarkdownText — safe markdown rendering for assistant messages.
 *
 * react-markdown does NOT render raw HTML (default escape), so even if a
 * model emits `<script>` it stays inert text. remark-gfm adds tables,
 * strikethrough and task lists so the model can use them.
 *
 * Styling maps to the app's calm dark tokens: status words (Critical,
 * Suspicious, Watch, Normal…) pick up their palette color, `code` gets the
 * inset surface, tables stay muted.
 */

/** Words that get their status-palette color when they appear in text. */
const STATUS_WORDS: [RegExp, string][] = [
  [/\b(critical)\b/gi, "var(--color-status-critical, #C26A6A)"],
  [/\b(suspicious)\b/gi, "var(--color-status-suspicious, #C08A62)"],
  [/\b(watch)\b/gi, "var(--color-status-watch, #B99B5E)"],
  [/\b(normal)\b/gi, "var(--color-status-normal, #5FA97C)"],
  [/\b(wildfire|industrial fire)\b/gi, "#C26A6A"],
  [/\b(gas flare)\b/gi, "#C08A62"],
];

/** Wrap status words in a colored span (skips code/heading content). */
function highlightStatus(text: string): React.ReactNode[] {
  // Build one combined regex so overlapping matches resolve left-to-right.
  const combined = new RegExp(
    STATUS_WORDS.map(([re]) => re.source).join("|"),
    "gi",
  );
  const colorFor = (word: string): string | null => {
    for (const [re, color] of STATUS_WORDS) {
      if (new RegExp(`^(?:${re.source})$`, "i").test(word)) return color;
    }
    return null;
  };

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(combined)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const color = colorFor(m[0]);
    parts.push(
      <span key={`${idx}-${m[0]}`} style={color ? { color, fontWeight: 600 } : undefined}>
        {m[0]}
        </span>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function MarkdownText({ children }: { children: string }) {
  const components: Components = {
    p: ({ children }) => (
      <p className="my-2 text-sm leading-relaxed first:mt-0 last:mb-0">
        {children}
      </p>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-text-primary">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="text-text-primary/90">{children}</em>
    ),
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0 marker:text-text-tertiary">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0 marker:text-text-tertiary">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="pl-0.5 text-sm leading-relaxed">{children}</li>
    ),
    h1: ({ children }) => (
      <h3 className="mt-3 font-display text-sm font-semibold text-text-primary first:mt-0">
        {children}
      </h3>
    ),
    h2: ({ children }) => (
      <h3 className="mt-3 font-display text-sm font-semibold text-text-primary first:mt-0">
        {children}
      </h3>
    ),
    h3: ({ children }) => (
      <h3 className="mt-3 font-display text-sm font-semibold text-text-primary first:mt-0">
        {children}
      </h3>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-primary underline decoration-accent-primary/40 underline-offset-2 hover:text-accent-secondary"
      >
        {children}
      </a>
    ),
    code: ({ className, children }) => {
      const isBlock = /language-/.test(className ?? "");
      if (isBlock) {
        return (
          <code className="block overflow-x-auto rounded-lg border border-border-hairline bg-bg-inset p-3 font-mono text-xs leading-relaxed text-text-secondary">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-xs text-accent-secondary">
          {children}
        </code>
      );
    },
    pre: ({ children }) => <>{children}</>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-accent-primary/30 pl-3 text-sm italic text-text-secondary">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-border-hairline" />,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-lg border border-border-hairline">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-border-hairline bg-bg-inset">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="px-3 py-1.5 text-left font-body text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-t border-border-hairline px-3 py-1.5 text-sm text-text-secondary">
        {children}
      </td>
    ),
  };

  return (
    <div className="pyro-md max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...components,
          // Status-word highlighting walks only plain text nodes.
          p: ({ children }) => (
            <p className="my-2 text-sm leading-relaxed first:mt-0 last:mb-0">
              {highlightIn(children)}
            </p>
          ),
          li: ({ children }) => (
            <li className="pl-0.5 text-sm leading-relaxed">{highlightIn(children)}</li>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Apply status-word coloring to the string children of a node. */
function highlightIn(node: React.ReactNode): React.ReactNode {
  if (typeof node === "string") return highlightStatus(node);
  if (Array.isArray(node)) return node.map((c, i) => highlightIn(c));
  return node;
}
