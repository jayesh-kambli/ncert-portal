import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "./normalize-math";

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-[15px] font-semibold first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-3 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-surface p-3 text-[0.9em] last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-surface-border pl-3 text-foreground/75 last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-surface-border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-surface-border px-2 py-1">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="[&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalizeMathDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
