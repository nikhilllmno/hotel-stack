import type { ElementType } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const safeHref = (href?: string) => (href && /^(https?:|mailto:)/i.test(href) ? href : undefined);

/** A markdown element rendered as `Tag` with our classes (react-markdown's `node` prop is not passed to the DOM). */
const styled = (Tag: ElementType, className: string): ElementType =>
  function Styled({ node: _node, ...props }: { node?: unknown } & Record<string, unknown>) { return <Tag className={className} {...props} />; };

const components: Components = {
  p: styled("p", "my-2 first:mt-0 last:mb-0"),
  a: ({ href, children }) => <a href={safeHref(href)} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline underline-offset-2">{children}</a>,
  ul: styled("ul", "my-2 list-disc pl-5"),
  ol: styled("ol", "my-2 list-decimal pl-5"),
  h1: styled("h3", "mt-3 mb-1 text-base font-semibold"),
  h2: styled("h3", "mt-3 mb-1 text-base font-semibold"),
  h3: styled("h4", "mt-3 mb-1 text-sm font-semibold"),
  pre: styled("pre", "my-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs"),
  code: ({ className, children }) => <code className={className ?? "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"}>{children}</code>,
  table: ({ node: _node, ...props }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs" {...props} /></div>,
  th: styled("th", "border border-border px-2 py-1 text-left font-medium"),
  td: styled("td", "border border-border px-2 py-1"),
  blockquote: styled("blockquote", "my-2 border-l-2 border-border pl-3 text-muted-foreground"),
  img: ({ alt }) => <span className="text-muted-foreground">[image{alt ? `: ${alt}` : ""}]</span>,
};

/** Assistant text: GitHub-flavoured markdown with single newlines kept. Links open in a new tab; images are not loaded. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 text-sm break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}
