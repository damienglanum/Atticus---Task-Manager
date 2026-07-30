import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-board text-fg-secondary text-xs leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
              <span className="border-border-subtle text-fg-secondary my-1 block rounded border border-dashed px-2 py-1 text-2xs">
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
