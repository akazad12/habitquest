import { StreakBadge } from "@/progression";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Plus,
  Repeat2,
  Pencil,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import { z } from "zod";
import {
  createHabitSchema,
  habitRecordSchema,
  categorySchema,
  difficultySchema,
  type HabitRecord,
  type Recurrence,
} from "@habitquest/shared";
import { api, messageOf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ErrorNotice,
  Field,
  ScheduleFields,
  scheduleLabel,
} from "@/components/forms";
export function HabitsPage() {
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [habits, setHabits] = useState<HabitRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = z
      .object({ habits: z.array(habitRecordSchema) })
      .parse(await api(`/habits?status=${status}`));
    setHabits(result.habits);
  }, [status]);
  useEffect(() => {
    let active = true;
    api(`/habits?status=${status}`)
      .then((result) => {
        if (active) {
          setHabits(
            z.object({ habits: z.array(habitRecordSchema) }).parse(result)
              .habits,
          );
          setError(null);
        }
      })
      .catch((error) => {
        if (active) setError(messageOf(error));
      });
    return () => {
      active = false;
    };
  }, [status]);
  async function archive(habit: HabitRecord) {
    setPending(habit.id);
    setError(null);
    try {
      await api(`/habits/${habit.id}`, {
        method: status === "active" ? "DELETE" : "PATCH",
        ...(status === "archived" ? { body: { archived: false } } : {}),
      });
      await load();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUILD A ROUTINE THAT FITS</p>
          <h1>
            Your habits<span>.</span>
          </h1>
          <p className="muted">Small commitments with room to grow.</p>
        </div>
        <Button asChild>
          <Link to="/habits/new">
            <Plus size={17} />
            New habit
          </Link>
        </Button>
      </div>
      <div className="filter-tabs" role="group" aria-label="Habit status">
        {(["active", "archived"] as const).map((value) => (
          <button
            disabled={pending !== null}
            aria-pressed={status === value}
            key={value}
            onClick={() => {
              if (value !== status) {
                setStatus(value);
                setHabits(null);
              }
            }}
          >
            {value === "active" ? "Active habits" : "Archived"}
          </button>
        ))}
      </div>
      <ErrorNotice message={error} />
      {error && (
        <Button
          variant="outline"
          onClick={() =>
            void load()
              .then(() => setError(null))
              .catch((e) => setError(messageOf(e)))
          }
        >
          Try again
        </Button>
      )}
      {!habits ? (
        <section className="panel loading-panel" role="status">
          Loading habits…
        </section>
      ) : habits.length ? (
        <div className="habit-grid">
          {habits.map((habit) => (
            <article className="panel habit-card" key={habit.id}>
              <div className="habit-card-icon">
                <Repeat2 size={21} />
                <span
                  className={`difficulty ${habit.difficulty.toLowerCase()}`}
                >
                  {habit.difficulty.toLowerCase()}
                </span>
              </div>
              <h2>{habit.title}</h2>
              <StreakBadge habitId={habit.id} />
              <p className="habit-description">
                {habit.description ||
                  "A small step toward a more consistent you."}
              </p>
              <div className="habit-meta">
                <span>{habit.category}</span>
                <span>{scheduleLabel(habit.schedule)}</span>
              </div>
              {habit.pendingSchedule && (
                <p className="pending-schedule">
                  From {habit.pendingSchedule.effectiveFrom}:{" "}
                  {scheduleLabel(habit.pendingSchedule.schedule)}
                </p>
              )}
              <p className="created-date">
                Created {new Date(habit.createdAt).toLocaleDateString()}
              </p>
              <div className="habit-actions">
                <Button variant="outline" asChild>
                  <Link to={`/habits/${habit.id}/edit`}>
                    <Pencil size={14} />
                    Edit
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  disabled={pending !== null}
                  onClick={() => void archive(habit)}
                >
                  {status === "active" ? (
                    <Archive size={14} />
                  ) : (
                    <RotateCcw size={14} />
                  )}{" "}
                  {pending === habit.id
                    ? "Saving…"
                    : status === "active"
                      ? "Archive"
                      : "Reactivate"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel empty-state">
          <div className="empty-icon">
            <Repeat2 size={28} />
          </div>
          <h3>
            {status === "active"
              ? "Your first habit starts here"
              : "No archived habits"}
          </h3>
          <p>
            {status === "active"
              ? "Choose something small, give it a schedule, and make it part of your day."
              : "Archived habits stay in your history and can be reactivated at any time."}
          </p>
          {status === "active" && (
            <Button asChild>
              <Link to="/habits/new">
                <Plus size={16} />
                Create a habit
              </Link>
            </Button>
          )}
        </section>
      )}
    </>
  );
}
type HistoryEntry = {
  id: string;
  scheduledDate: string;
  completedAt: string;
  undoneAt: string | null;
  timezone: string;
};
function History({ habitId }: { habitId: string }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ completions: HistoryEntry[]; nextCursor: string | null }>(
      `/habits/${habitId}/completions`,
    )
      .then((result) => {
        if (active) {
          setRows(result.completions);
          setCursor(result.nextCursor);
        }
      })
      .catch((error) => {
        if (active) setError(messageOf(error));
      });
    return () => {
      active = false;
    };
  }, [habitId]);
  async function more() {
    setPending(true);
    try {
      const result = await api<{
        completions: HistoryEntry[];
        nextCursor: string | null;
      }>(`/habits/${habitId}/completions?before=${cursor}`);
      setRows((previous) => [...(previous ?? []), ...result.completions]);
      setCursor(result.nextCursor);
      setError(null);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel history">
      <h2>Completion history</h2>
      <p className="muted">
        Recorded local dates are preserved, including undone check-ins.
      </p>
      <ErrorNotice message={error} />
      {rows ? (
        rows.length ? (
          <>
            <ul>
              {rows.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.scheduledDate}</strong>
                    <small>{row.timezone}</small>
                  </div>
                  <span className={row.undoneAt ? "muted" : "history-done"}>
                    {row.undoneAt ? "Undone" : "Completed"}
                  </span>
                </li>
              ))}
            </ul>
            {cursor && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void more()}
              >
                Load earlier dates <ChevronDown size={14} />
              </Button>
            )}
          </>
        ) : (
          <p className="muted">No completions recorded yet.</p>
        )
      ) : (
        !error && <p role="status">Loading history…</p>
      )}
    </section>
  );
}
export function HabitForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<HabitRecord["category"]>("Personal");
  const [difficulty, setDifficulty] =
    useState<HabitRecord["difficulty"]>("MEDIUM");
  const [schedule, setSchedule] = useState<Recurrence>({ kind: "DAILY" });
  const [originalRule, setOriginalRule] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<{ habit: HabitRecord }>(`/habits/${id}`)
      .then(({ habit }) => {
        if (!active) return;
        setTitle(habit.title);
        setDescription(habit.description ?? "");
        setCategory(habit.category);
        setDifficulty(habit.difficulty);
        const rule = habit.pendingSchedule?.schedule ?? habit.schedule;
        setSchedule(rule);
        setOriginalRule(JSON.stringify(rule));
        setPendingDate(habit.pendingSchedule?.effectiveFrom ?? null);
        setLoaded(true);
      })
      .catch((error) => {
        if (active) setError(messageOf(error));
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const input = createHabitSchema.parse({
        title,
        description,
        category,
        difficulty,
        schedule,
      });
      const body =
        id && JSON.stringify(schedule) === originalRule
          ? {
              title: input.title,
              description: input.description,
              category: input.category,
              difficulty: input.difficulty,
            }
          : input;
      await api(id ? `/habits/${id}` : "/habits", {
        method: id ? "PATCH" : "POST",
        body,
      });
      navigate("/habits");
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/habits">
        <ArrowLeft size={16} />
        Back to habits
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A SMALL COMMITMENT TO YOURSELF</p>
          <h1>
            {id ? "Edit your habit" : "Create a habit"}
            <span>.</span>
          </h1>
          <p className="muted">
            Make it achievable. You can always build from here.
          </p>
        </div>
      </div>
      <ErrorNotice message={error} />
      {loaded ? (
        <div className="editor-grid">
          <form className="panel habit-form" onSubmit={submit}>
            <fieldset className="form-reset" disabled={pending}>
              <Field label="Habit name">
                <input
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Read a few pages"
                />
              </Field>
              <Field label="Description (optional)">
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What would showing up look like?"
                />
              </Field>
              <div className="form-columns">
                <Field label="Category">
                  <select
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as HabitRecord["category"])
                    }
                  >
                    {categorySchema.options.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Difficulty">
                  <select
                    value={difficulty}
                    onChange={(e) =>
                      setDifficulty(e.target.value as HabitRecord["difficulty"])
                    }
                  >
                    {difficultySchema.options.map((difficulty) => (
                      <option key={difficulty} value={difficulty}>
                        {difficulty[0] + difficulty.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <ScheduleFields value={schedule} onChange={setSchedule} />
              <p className="policy-note">
                {id
                  ? `Recurrence changes start tomorrow in your configured timezone. Today and recorded completions stay unchanged.${pendingDate ? ` You are editing the pending schedule for ${pendingDate}.` : ""}`
                  : "Your habit starts today in your configured timezone. Interval schedules are due on the anchor date and every N calendar days afterward."}
              </p>
              <div className="form-actions">
                <Button type="submit">
                  {pending ? "Saving…" : id ? "Save changes" : "Create habit"}
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/habits">Cancel</Link>
                </Button>
              </div>
            </fieldset>
          </form>
          {id ? (
            <History habitId={id} />
          ) : (
            <aside className="panel editor-tip">
              <p className="eyebrow">START SMALL, KEEP GOING</p>
              <h2>A habit you can come back to.</h2>
              <p className="muted">
                Choose a name that makes the action clear. Your schedule decides
                when it appears on Today.
              </p>
              <p className="muted">
                Difficulty sets each completion’s base reward: Easy 15 XP / 5
                coins, Medium 25 XP / 10 coins, Hard 40 XP / 15 coins. Streak
                bonuses apply to XP.
              </p>
            </aside>
          )}
        </div>
      ) : (
        !error && <p role="status">Loading habit…</p>
      )}
    </>
  );
}
