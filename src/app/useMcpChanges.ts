import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { ipc } from "@/lib/ipc";

/**
 * Pulls externally written MCP changes into the otherwise permanently-fresh
 * local query cache. The integer read is tiny and polling avoids opening a
 * network listener or giving the companion process control of the webview.
 */
export function useMcpChanges(client: QueryClient) {
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const lifecycle = { active: true };
    let reading = false;

    async function poll() {
      if (!lifecycle.active || reading) return;
      reading = true;
      try {
        const revision = await ipc.mcpRevisionGet();
        if (
          (previous.current === null && revision > 0) ||
          (previous.current !== null && revision > previous.current)
        ) {
          await client.invalidateQueries();
        }
        previous.current = revision;
      } catch {
        // The web layer can run without Tauri during styling work. MCP refresh
        // simply stays inactive there, just like the updater integration.
      } finally {
        reading = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 1_500);

    return () => {
      lifecycle.active = false;
      window.clearInterval(timer);
    };
  }, [client]);
}
