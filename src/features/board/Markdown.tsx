import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/cn";
import { ipc } from "@/lib/ipc";
import { isOpenable } from "@/lib/links";

/**
 * Renders a task description.
 *
 * Three restrictions, all of them US-10 AC4 and none of them optional:
 *
 * - **No raw HTML.** `react-markdown` ignores HTML in the source unless
 *   `rehype-raw` is added; it is not added, and must not be. That single
 *   decision removes script injection, iframes and event handlers together.
 * - **No remote images.** An `<img>` pointing at a URL would turn opening a task
 *   into a network request — from an application whose whole promise is that it
 *   makes none. Images render as their alt text and the source is shown.
 * - **Links open in the system browser**, through the opener plugin, and only
 *   for `http` and `https`. A `javascript:` or `file:` URL is rendered as plain
 *   text, so a pasted link can never become an action.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-board text-fg-secondary text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children: heading }) {
            return (
              <h1 className="text-fg-primary mt-1 mb-4 text-xl font-semibold tracking-[-0.025em]">
                {heading}
              </h1>
            );
          },
          h2({ children: heading }) {
            return (
              <h2 className="border-border-subtle text-fg-primary mt-7 mb-3 border-b pb-2 text-lg font-semibold">
                {heading}
              </h2>
            );
          },
          h3({ children: heading }) {
            return <h3 className="text-fg-primary mt-5 mb-2 text-base font-semibold">{heading}</h3>;
          },
          h4({ children: heading }) {
            return <h4 className="text-fg-primary mt-4 mb-2 text-sm font-semibold">{heading}</h4>;
          },
          p({ children: paragraph }) {
            return <p className="mb-3 last:mb-0">{paragraph}</p>;
          },
          strong({ children: strong }) {
            return <strong className="text-fg-primary font-semibold">{strong}</strong>;
          },
          ul({ children: items }) {
            return <ul className="mb-4 list-disc space-y-1 pl-5">{items}</ul>;
          },
          ol({ children: items }) {
            return <ol className="mb-4 list-decimal space-y-1 pl-5">{items}</ol>;
          },
          li({ children: item }) {
            return <li className="pl-0.5">{item}</li>;
          },
          blockquote({ children: quote }) {
            return (
              <blockquote className="border-accent-border bg-accent-bg text-fg-primary my-4 border-l-2 px-4 py-2">
                {quote}
              </blockquote>
            );
          },
          hr() {
            return <hr className="border-border-default my-6 border-t" />;
          },
          code({ className: codeClassName, children: code }) {
            const block = codeClassName?.startsWith("language-") ?? false;
            return (
              <code
                className={cn(
                  "font-mono text-[0.92em]",
                  block
                    ? "text-fg-primary"
                    : "border-border-subtle bg-surface-sunken text-fg-primary rounded-sm border px-1 py-0.5",
                  codeClassName,
                )}
              >
                {code}
              </code>
            );
          },
          pre({ children: code }) {
            return (
              <pre className="border-border-default bg-surface-sunken my-4 overflow-x-auto rounded-md border p-4 text-xs leading-relaxed">
                {code}
              </pre>
            );
          },
          table({ children: table }) {
            return (
              <table className="border-border-default my-4 w-full border-collapse border text-left text-xs">
                {table}
              </table>
            );
          },
          th({ children: cell }) {
            return (
              <th className="border-border-default bg-surface-column text-fg-primary border px-3 py-2 font-semibold">
                {cell}
              </th>
            );
          },
          td({ children: cell }) {
            return <td className="border-border-default border px-3 py-2 align-top">{cell}</td>;
          },
          input({ type, checked }) {
            if (type !== "checkbox") return null;
            return (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                disabled
                className="dui-checkbox dui-checkbox-xs border-border-strong mr-2 align-[-2px]"
              />
            );
          },
          a({ href, children: linkChildren }) {
            if (href === undefined || !isOpenable(href)) {
              return (
                <span className="text-fg-primary underline decoration-dotted">{linkChildren}</span>
              );
            }
            return (
              <button
                type="button"
                className="text-accent-fg cursor-default underline underline-offset-2"
                onClick={() => {
                  void ipc.openExternal(href);
                }}
              >
                {linkChildren}
              </button>
            );
          },

          img({ alt, src }) {
            return (
              <span className="border-border-subtle text-fg-secondary my-2 block rounded border border-dashed px-3 py-2 text-2xs">
                Image not shown: {alt === undefined || alt === "" ? "no description" : alt}
                {typeof src === "string" ? ` — ${src}` : null}
              </span>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
