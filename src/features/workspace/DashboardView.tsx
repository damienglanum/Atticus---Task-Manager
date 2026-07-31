import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckSquare, FolderX, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { BoardTask } from "@/lib/bindings/BoardTask";
import type { Board } from "@/lib/bindings/Board";
import type { Project } from "@/lib/bindings/Project";
import { cn } from "@/lib/cn";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";

import { describeDue, dueState } from "@/features/board/dates";
import { priorityLevel } from "@/features/board/priority";
import { useToday } from "@/features/board/useToday";
import { ProjectDot } from "@/features/projects/ProjectColor";

interface DashboardViewProps {
  projects: Project[];
  boards: Board[];
  greeting: string;
  onOpenTask: (task: BoardTask) => void;
}

/**
 * What is on your plate, across every board in the open project.
 *
 * Everything here is derived from board snapshots the application already
 * loads — there is no dashboard query and no summary table, because a count
 * stored separately from the thing it counts is a count that goes wrong. The
 * cost is that the dashboard loads one snapshot per board; boards are few, and
 * the queries are shared with the board view's own cache.
 */
export function DashboardView({ projects, boards, greeting, onOpenTask }: DashboardViewProps) {
  const today = useToday();

  const snapshots = useQueries({
    queries: boards.map((board) => ({
      queryKey: queryKeys.board(board.id),
      queryFn: () => ipc.boardLoad(board.id),
    })),
  });

  const loading = snapshots.some((snapshot) => snapshot.isPending);

  // Not memoised. `useQueries` returns a fresh array every render, so any
  // dependency list built from it would miss every time anyway — and flattening
  // a handful of boards costs less than the comparison would.
  const tasks = snapshots.flatMap((snapshot) => snapshot.data?.tasks ?? []);

  const overdue = tasks
    .filter((task) => dueState(task.dueDate, today) === "overdue")
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  const soon = tasks
    .filter((task) => {
      const state = dueState(task.dueDate, today);
      return state === "today" || state === "soon";
    })
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  const missingFiles = tasks.filter((task) => task.hasMissingFile);
  const missingDirectories = projects.filter((project) => project.directoryMissing);

  return (
    <div className="h-full overflow-y-auto px-5 pt-5 pb-8">
      <header className="mb-6">
        <p className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase">
          Workspace
        </p>
        <h1 className="text-fg-primary mt-1 text-xl font-semibold tracking-[-0.01em]">
          {greeting}
        </h1>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Layers} label="Open tasks" value={tasks.length} pending={loading} />
        <Stat
          icon={AlertTriangle}
          label="Overdue"
          value={overdue.length}
          pending={loading}
          tone={overdue.length > 0 ? "danger" : undefined}
        />
        <Stat
          icon={CalendarClock}
          label="Due soon"
          value={soon.length}
          pending={loading}
          tone={soon.length > 0 ? "warning" : undefined}
        />
        <Stat icon={CheckSquare} label="Boards" value={boards.length} pending={loading} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TaskPanel
          title="Overdue"
          empty="Nothing is overdue."
          tasks={overdue}
          today={today}
          onOpenTask={onOpenTask}
        />
        <TaskPanel
          title="Due soon"
          empty="Nothing is due in the next few days."
          tasks={soon}
          today={today}
          onOpenTask={onOpenTask}
        />
      </div>

      {missingFiles.length === 0 && missingDirectories.length === 0 ? null : (
        <section
          aria-labelledby="dashboard-attention"
          className="border-warning-border bg-warning-bg mt-4 rounded-xl border p-4"
        >
          <h2
            id="dashboard-attention"
            className="text-warning-fg flex items-center gap-2 text-xs font-semibold tracking-[0.08em] uppercase"
          >
            <AlertTriangle size={13} aria-hidden />
            Needs attention
          </h2>
          <ul className="text-fg-primary mt-2 space-y-1 text-sm">
            {missingDirectories.map((project) => (
              <li key={project.id} className="flex items-center gap-2">
                <FolderX size={13} aria-hidden className="shrink-0" />
                {project.name} — its project folder is not where it was.
              </li>
            ))}
            {missingFiles.length === 0 ? null : (
              <li className="flex items-center gap-2">
                <FolderX size={13} aria-hidden className="shrink-0" />
                <span data-numeric>{missingFiles.length}</span>
                {missingFiles.length === 1
                  ? " task links a file that has moved."
                  : " tasks link files that have moved."}
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  pending,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  pending: boolean;
  tone?: "danger" | "warning" | undefined;
}) {
  return (
    <div className="border-border-subtle bg-surface-column rounded-xl border p-4">
      <p className="text-fg-secondary flex items-center gap-1.5 text-2xs font-semibold tracking-[0.08em] uppercase">
        <Icon size={13} aria-hidden />
        {label}
      </p>
      <p
        data-numeric
        className={cn(
          "mt-2 text-xl font-semibold",
          tone === "danger"
            ? "text-danger-fg"
            : tone === "warning"
              ? "text-warning-fg"
              : "text-fg-primary",
        )}
      >
        {pending ? "—" : value}
      </p>
    </div>
  );
}

function TaskPanel({
  title,
  empty,
  tasks,
  today,
  onOpenTask,
}: {
  title: string;
  empty: string;
  tasks: BoardTask[];
  today: string;
  onOpenTask: (task: BoardTask) => void;
}) {
  const headingId = `dashboard-${title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <section
      aria-labelledby={headingId}
      className="border-border-subtle bg-surface-column rounded-xl border p-4"
    >
      <h2
        id={headingId}
        className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase"
      >
        {title}
      </h2>

      {tasks.length === 0 ? (
        <p className="text-fg-secondary mt-3 text-sm">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {tasks.slice(0, 6).map((task) => {
            const priority = priorityLevel(task.priority);
            const PriorityIcon = priority.icon;
            const tone = dueState(task.dueDate, today);

            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenTask(task);
                  }}
                  className="border-border-subtle bg-surface-card hover:border-border-strong flex w-full cursor-default items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-(--duration-fast)"
                >
                  <span className="text-fg-primary min-w-0 flex-1 truncate text-sm font-medium">
                    {task.title}
                  </span>
                  {task.priority > 0 ? (
                    <span
                      className={cn("flex shrink-0 items-center gap-0.5 text-2xs", priority.tone)}
                    >
                      <PriorityIcon size={11} aria-hidden />
                      {priority.label}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "shrink-0 text-2xs",
                      tone === "overdue" ? "text-danger-fg" : "text-warning-fg",
                    )}
                  >
                    {describeDue(task.dueDate, today)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {tasks.length > 6 ? (
        <p className="text-fg-secondary mt-2 text-2xs">
          and <span data-numeric>{tasks.length - 6}</span> more
        </p>
      ) : null}
    </section>
  );
}

/** The project grid behind "My Projects". */
export function ProjectsView({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (project: Project) => void;
}) {
  return (
    <div className="h-full overflow-y-auto px-5 pt-5 pb-8">
      <header className="mb-6">
        <p className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase">
          Workspace
        </p>
        <h1 className="text-fg-primary mt-1 text-xl font-semibold tracking-[-0.01em]">
          My Projects
        </h1>
      </header>

      {projects.length === 0 ? (
        <p className="text-fg-secondary text-sm">
          No projects yet. Create one from the sidebar to begin.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => {
                  onOpen(project);
                }}
                className="border-border-subtle bg-surface-column hover:border-border-strong flex w-full cursor-default flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors duration-(--duration-fast)"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <ProjectDot color={project.color} />
                  <span className="text-fg-primary min-w-0 flex-1 truncate text-base font-semibold">
                    {project.name}
                  </span>
                  <span className="text-fg-secondary shrink-0 font-mono text-2xs" data-numeric>
                    {project.keyPrefix}
                  </span>
                </span>

                <span className="text-fg-secondary line-clamp-2 text-sm">
                  {project.description.trim() === "" ? "No description." : project.description}
                </span>

                {project.directoryMissing ? (
                  <span className="text-warning-fg flex items-center gap-1 text-2xs">
                    <FolderX size={12} aria-hidden />
                    Project folder is missing
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
