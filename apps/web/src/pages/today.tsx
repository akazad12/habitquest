import { useProgression, StreakBadge, FreezePanel } from "@/progression";
import { useCallback, useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  Plus,
  Sun,
  CalendarDays,
  ArrowUpRight,
  Snowflake,
} from "lucide-react";
import {
  todaySchema,
  completionReceiptSchema,
  type Today,
} from "@habitquest/shared";
import { useAuth } from "@/auth";
import { api, messageOf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice, scheduleLabel } from "@/components/forms";
export function TodayPage() {
  const { user } = useAuth();
  const game = useProgression();
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    const result = todaySchema.parse(await api("/habits/today"));
    if (id === requestId.current) setData(result);
    return result;
  }, []);
  const invalidate = useCallback(() => {
    requestId.current++;
  }, []);
  useEffect(() => {
    let active = true;
    const reload = () => {
      load()
        .then(() => {
          if (active) setError(null);
        })
        .catch((error) => {
          if (active) setError(messageOf(error));
        });
    };
    reload();
    window.addEventListener("focus", reload);
    const timer = setInterval(reload, 60000);
    return () => {
      active = false;
      invalidate();
      window.removeEventListener("focus", reload);
      clearInterval(timer);
    };
  }, [load, invalidate, user?.timezone]);
  const protectedToday = (id: string) =>
    data !== null &&
    (game.data?.habits
      .find((h) => h.habitId === id)
      ?.frozenDates.includes(data.date) ??
      false);
  async function toggle(id: string, completed: boolean) {
    if (!data) return;
    setPending(id);
    setError(null);
    try {
      const receipt = completionReceiptSchema.parse(
        await api(
          completed
            ? `/habits/${id}/completions/${data.date}`
            : `/habits/${id}/completions`,
          {
            method: completed ? "DELETE" : "POST",
            headers: completed
              ? { Prefer: "return=representation" }
              : undefined,
            ...(completed ? {} : { body: { scheduledDate: data.date } }),
          },
        ),
      );
      game.celebrate(receipt);
      await load();
    } catch (error) {
      setError(messageOf(error));
      await load().catch(() => {});
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ONE DAY AT A TIME</p>
          <h1>
            Make today count<span>.</span>
          </h1>
          <p className="muted">
            Good to see you, {user?.displayName}. A little effort goes a long
            way.
          </p>
        </div>
        <Button asChild>
          <Link to="/habits/new">
            <Plus size={17} />
            New habit
          </Link>
        </Button>
      </div>
      <ErrorNotice message={error} />
      {!data ? (
        <section className="panel loading-panel" role="status">
          {error ? (
            <Button
              variant="outline"
              onClick={() => {
                void load()
                  .then(() => setError(null))
                  .catch((e) => setError(messageOf(e)));
              }}
            >
              Try again
            </Button>
          ) : (
            "Loading your day…"
          )}
        </section>
      ) : (
        <>
          <section className="daily-hero">
            <div>
              <span className="hero-tag">
                <Sun size={16} /> YOUR DAILY QUESTS
              </span>
              <h2>
                {new Intl.DateTimeFormat("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(new Date(data.date + "T12:00:00Z"))}
              </h2>
              <p>{data.timezone} · Check-ins follow your local calendar day.</p>
              <Link className="text-link" to="/profile">
                Timezone settings <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="daily-progress">
              <strong>
                {data.percentage}
                <span>%</span>
              </strong>
              <span>
                {data.completed} of {data.total} complete
              </span>
            </div>
            <progress
              aria-label="Daily completion progress"
              value={data.completed}
              max={data.total || 1}
            />
          </section>
          <div className="section-heading dashboard-heading">
            <h2>Scheduled for today</h2>
            <span className="subtle-badge">
              {data.total} {data.total === 1 ? "habit" : "habits"}
            </span>
          </div>
          {data.habits.length ? (
            <section className="quest-list" aria-label="Today's habits">
              {data.habits.map((habit) => (
                <article
                  className={`quest-row ${habit.completed ? "is-complete" : ""}`}
                  key={habit.id}
                >
                  <button
                    className="completion-toggle"
                    disabled={pending !== null || protectedToday(habit.id)}
                    aria-label={
                      protectedToday(habit.id)
                        ? `Freeze protected ${habit.title}`
                        : `${habit.completed ? "Undo" : "Complete"} ${habit.title}`
                    }
                    aria-pressed={habit.completed}
                    onClick={() => void toggle(habit.id, habit.completed)}
                  >
                    {pending === habit.id ? (
                      <span className="spinner" />
                    ) : protectedToday(habit.id) ? (
                      <Snowflake size={18} />
                    ) : habit.completed ? (
                      <Check size={20} />
                    ) : null}
                  </button>
                  <div className="quest-details">
                    <Link to={`/habits/${habit.id}/edit`}>
                      <h3>{habit.title}</h3>
                    </Link>
                    {habit.description && <p>{habit.description}</p>}
                    <div className="habit-meta">
                      <span>{habit.category}</span>
                      <span
                        className={`difficulty ${habit.difficulty.toLowerCase()}`}
                      >
                        {habit.difficulty.toLowerCase()}
                      </span>
                      <span>{scheduleLabel(habit.schedule)}</span>
                    </div>
                  </div>
                  <StreakBadge habitId={habit.id} />
                  <span className="quest-state">
                    {protectedToday(habit.id)
                      ? "Freeze protected"
                      : habit.completed
                        ? "Done for today"
                        : "Ready when you are"}
                  </span>
                </article>
              ))}
            </section>
          ) : (
            <section className="panel empty-state">
              <div className="empty-icon">
                <CalendarDays size={28} />
              </div>
              <h3>A little room in your day</h3>
              <p>
                No habits are scheduled for today. Create a new habit or review
                your recurring schedules.
              </p>
              <Button asChild>
                <Link to="/habits/new">
                  <Plus size={16} />
                  Create a habit
                </Link>
              </Button>
              <Link className="text-link" to="/habits">
                View all habits
              </Link>
            </section>
          )}
          <FreezePanel />
          <p className="policy-note">
            Check off habits today and earn XP and coins. Undo reverses the
            original award. Freezes protect missed days without earning rewards.
          </p>
        </>
      )}
    </>
  );
}
