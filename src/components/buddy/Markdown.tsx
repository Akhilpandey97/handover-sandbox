import { Fragment, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/utils";

/**
 * Buddy's answer text.
 *
 * Markdown tables are rendered here directly: react-markdown needs a separate
 * plugin for them, so this splits the answer into table and non-table blocks
 * and gives tables the app's own table styling.
 */

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="heading-card mt-3 mb-1 text-foreground">{children}</h3>,
  h2: ({ children }) => <h3 className="heading-card mt-3 mb-1 text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="heading-card mt-3 mb-1 text-foreground">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold text-foreground">{children}</h4>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

type Block = { kind: "text"; text: string } | { kind: "table"; head: string[]; rows: string[][] };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function toBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length) blocks.push({ kind: "text", text: text.join("\n") });
    text = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (line.trim().startsWith("|") && isSeparator(next)) {
      flush();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      i--;
      blocks.push({ kind: "table", head, rows });
    } else {
      text.push(line);
    }
  }
  flush();
  return blocks;
}

const Inline = ({ text }: { text: string }) => (
  <ReactMarkdown components={{ ...components, p: ({ children }) => <>{children}</> }}>{text}</ReactMarkdown>
);

export const Markdown = ({ content, className }: { content: string; className?: string }) => {
  const blocks = useMemo(() => toBlocks(content), [content]);
  return (
    <div className={cn("text-sm leading-relaxed text-foreground", className)}>
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          b.text.trim() ? <ReactMarkdown key={i} components={components}>{b.text}</ReactMarkdown> : <Fragment key={i} />
        ) : (
          <div key={i} className="my-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/60">
                  {b.head.map((h, j) => (
                    <th key={j} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                      <Inline text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-t border-border/70">
                    {b.head.map((_, k) => (
                      <td key={k} className="px-3 py-2 align-top tabular-nums">
                        <Inline text={r[k] ?? ""} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  );
};
