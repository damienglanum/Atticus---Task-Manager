import { useEffect, useState } from "react";

import { todayIso } from "./dates";

/**
 * Today's date, kept current while the application is open.
 *
 * A board left open overnight would otherwise still be calling yesterday
 * "today" and hiding an overdue task (US-16 AC3). Re-checked when the window
 * regains focus or becomes visible again — the moment the user looks at it,
 * which is the only moment it matters — rather than on a timer that would wake
 * the app up all night to change nothing.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayIso);

  useEffect(() => {
    function recheck() {
      const now = todayIso();
      // Compared before setting, so an ordinary window focus does not re-render
      // every card on the board.
      setToday((current) => (current === now ? current : now));
    }

    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  return today;
}
