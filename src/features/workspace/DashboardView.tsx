import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckSquare, FolderX, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { BlurFade } from "@/components/magicui/BlurFade";
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
    <BlurFade className="h-full overflow-y-auto px-8 pt-8 pb-12">
      <div className="w-full">
        <header className="border-border-default mb-8 flex items-end justify-between gap-6 border-b pb-6">
          <div>
            <p className="text-accent-fg font-mono text-2xs font-semibold tracking-[0.14em] uppercase">
              Daily field report
            </p>
            <h1 className="text-fg-primary mt-2 text-xl font-semibold tracking-[-0.025em]">
              {greeting}
            </h1>
          </div>
          <p className="text-fg-secondary hidden max-w-xs text-right text-sm sm:block">
            A quiet read on what is moving and what needs a decision.
          </p>
        </header>

        <div className="border-border-default mb-10 grid grid-cols-2 border-y sm:grid-cols-4 sm:divide-x sm:divide-border-subtle">
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

        <div className="grid gap-9 xl:grid-cols-2 xl:gap-12">
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
            className="border-warning-fg mt-9 border-l-2 py-1 pl-4"
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
    </BlurFade>
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
    <div className="border-border-subtle px-4 py-5 max-sm:border-b sm:px-5">
      <p className="text-fg-secondary flex items-center gap-2 text-2xs font-medium tracking-[0.06em] uppercase">
        <Icon size={13} strokeWidth={1.75} aria-hidden />
        {label}
      </p>
      <p
        data-numeric
        className={cn(
          "mt-2 font-mono text-2xl font-medium tracking-[-0.04em]",
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
    <section aria-labelledby={headingId} className="border-border-default border-t pt-4">
      <h2
        id={headingId}
        className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase"
      >
        {title}
      </h2>

      {tasks.length === 0 ? (
        <p className="text-fg-secondary mt-3 text-sm">{empty}</p>
      ) : (
        <ul className="mt-2">
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
                  className="border-border-subtle hover:bg-surface-column flex w-full cursor-default items-center gap-3 border-b px-2 py-3 text-left"
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
    <BlurFade className="h-full overflow-y-auto px-8 pt-8 pb-12">
      <div className="w-full">
        <header className="border-border-default mb-8 border-b pb-6">
          <p className="text-accent-fg font-mono text-2xs font-semibold tracking-[0.14em] uppercase">
            Project index
          </p>
          <h1 className="text-fg-primary mt-2 text-xl font-semibold tracking-[-0.02em]">
            My Projects
          </h1>
        </header>

        {projects.length === 0 ? (
          <p className="text-fg-secondary text-sm">
            No projects yet. Create one from the sidebar to begin.
          </p>
        ) : (
          <ul className="border-border-default border-y">
            {projects.map((project, index) => (
              <li key={project.id} className="border-border-subtle border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    onOpen(project);
                  }}
                  className="hover:bg-surface-column grid min-h-24 w-full cursor-default grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-4 px-3 py-4 text-left"
                >
                  <span className="text-fg-secondary font-mono text-2xs" data-numeric>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ProjectDot color={project.color} />
                      <span className="text-fg-primary min-w-0 flex-1 truncate text-base font-semibold">
                        {project.name}
                      </span>
                    </span>
                    <span className="text-fg-secondary mt-1 block line-clamp-1 text-sm">
                      {project.description.trim() === "" ? "No description." : project.description}
                    </span>

                    {project.directoryMissing ? (
                      <span className="text-warning-fg mt-1 flex items-center gap-1 text-2xs">
                        <FolderX size={12} aria-hidden />
                        Project folder is missing
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="text-fg-secondary border-border-subtle border-l pl-5 font-mono text-xs"
                    data-numeric
                  >
                    {project.keyPrefix}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BlurFade>
  );
}
