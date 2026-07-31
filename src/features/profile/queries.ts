import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";

/**
 * Where the user's name lives.
 *
 * `ui_state` is the generic key/value table the application already keeps for
 * remembered interface state, and a name is exactly that: one string, read once
 * at startup, written once at onboarding. Giving it a column on `preferences`
 * would have meant a migration, a Rust struct change and three regenerated
 * bindings to store a string the backend never reasons about.
 */
const PROFILE_NAME_KEY = "profile.name";

/**
 * The name, or `null` when it has never been set.
 *
 * `null` is what puts the welcome screen on screen, so this query is deliberately
 * one of the two the shell waits for before rendering anything: showing the
 * workspace and *then* replacing it with onboarding would be a visible flash of
 * somebody else's interface.
 */
export function useProfileName() {
  return useQuery({
    queryKey: queryKeys.profileName(),
    queryFn: async () => {
      const stored = await ipc.uiStateGet(PROFILE_NAME_KEY);
      const trimmed = stored?.trim() ?? "";
      return trimmed === "" ? null : trimmed;
    },
    // Written once and read from one place; refetching it on every focus would
    // be a round trip to learn something that cannot have changed elsewhere.
    staleTime: Infinity,
  });
}

export function useSetProfileName() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      await ipc.uiStateSet(PROFILE_NAME_KEY, trimmed);
      return trimmed;
    },
    onSuccess: (name) => {
      client.setQueryData(queryKeys.profileName(), name === "" ? null : name);
    },
  });
}

/**
 * The initials shown in the sidebar's avatar.
 *
 * First and last word, so "Ada Lovelace" is AL and "Ada" is A. Deliberately not
 * the first two characters: "Ad" reads as a truncation rather than as initials.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  // `codePointAt` rather than indexing or spreading: a name beginning with an
  // astral character — an emoji, or any of several scripts — would otherwise be
  // cut in half and render as a replacement glyph.
  const initial = (word: string): string => {
    const point = word.codePointAt(0);
    return point === undefined ? "" : String.fromCodePoint(point);
  };

  const first = words[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  return `${initial(first)}${initial(last)}`.toUpperCase();
}
