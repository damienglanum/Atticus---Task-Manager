import { QueryClient } from "@tanstack/react-query";

/**
 * There is no network here: every query is a local IPC call taking single-digit
 * milliseconds, so the usual defaults tuned for flaky HTTP are wrong.
 *
 * - `retry: false` — a failing command is a real error, not a transient blip.
 *   Retrying hides it and delays the message the user needs.
 * - `staleTime: Infinity` — data only changes when *we* change it, so a refetch
 *   on window focus would be pure waste. Mutations invalidate explicitly.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
