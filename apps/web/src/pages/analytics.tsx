import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { z } from "zod";
import {
  analyticsSchema,
  analyticsHabitSchema,
  dayDetailsSchema,
  type Analytics,
  type AnalyticsPeriod,
  type DayDetails,
} from "@habitquest/shared";
import {
  Check,
  Flame,
  Zap,
  Coins,
  Trophy,
  Snowflake,
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import { api, messageOf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/forms";
const percent = (value: number | null) => (value === null ? "—" : `${value}%`);
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
function DataTable({
  data,
  mode,
}: {
  data: AnalyticsPeriod[];
  mode: "rate" | "xp";
}) {
  return (
    <details className="chart-data">
      <summary>View chart data</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Period starts</th>
              {mode === "xp" ? (
                <th>Net XP</th>
              ) : (
                <>
                  <th>Completed</th>
                  <th>Scheduled</th>
                  <th>Pending</th>
                  <th>Assessed</th>
                  <th>Rate</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.period}>
                <th scope="row">{d.period}</th>
                {mode === "xp" ? (
                  <td>{d.xp}</td>
                ) : (
                  <>
                    <td>{d.completed}</td>
                    <td>{d.scheduled}</td>
                    <td>{d.pending}</td>
                    <td>{d.assessed}</td>
                    <td>{percent(d.rate)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
function ProgressChart({
  data,
  mode = "rate",
  line = false,
  label,
}: {
  data: AnalyticsPeriod[];
  mode?: "rate" | "xp";
  line?: boolean;
  label: string;
}) {
  const common = {
    data,
    margin: { top: 15, right: 15, bottom: 0, left: -15 },
    accessibilityLayer: true,
  };
  return (
    <>
      <div className="analytics-chart" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height={245}>
          {mode === "xp" ? (
            <AreaChart {...common}>
              <CartesianGrid stroke="#302838" strokeDasharray="3 5" />
              <XAxis
                dataKey="period"
                tickFormatter={dateLabel}
                minTickGap={38}
                tick={{ fill: "#a89bb6", fontSize: 10 }}
              />
              <YAxis tick={{ fill: "#a89bb6", fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "#211b2a",
                  border: "1px solid #5e4874",
                  borderRadius: 10,
                  color: "#eee",
                }}
              />
              <ReferenceLine y={0} stroke="#6b5e77" />
              <Area
                type="monotone"
                dataKey="xp"
                name="Net XP"
                stroke="#bf93f1"
                fill="#7e4caf"
                fillOpacity={0.3}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : line ? (
            <LineChart {...common}>
              <CartesianGrid stroke="#302838" strokeDasharray="3 5" />
              <XAxis
                dataKey="period"
                tickFormatter={dateLabel}
                minTickGap={38}
                tick={{ fill: "#a89bb6", fontSize: 10 }}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={{ fill: "#a89bb6", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{
                  background: "#211b2a",
                  border: "1px solid #5e4874",
                  borderRadius: 10,
                }}
              />
              <Line
                type="monotone"
                dataKey="rate"
                name="Assessed completion rate (%)"
                stroke="#c0a3f2"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          ) : (
            <BarChart {...common}>
              <CartesianGrid
                stroke="#302838"
                strokeDasharray="3 5"
                vertical={false}
              />
              <XAxis
                dataKey="period"
                tickFormatter={dateLabel}
                minTickGap={38}
                tick={{ fill: "#a89bb6", fontSize: 10 }}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={{ fill: "#a89bb6", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{
                  background: "#211b2a",
                  border: "1px solid #5e4874",
                  borderRadius: 10,
                }}
              />
              <Bar
                dataKey="rate"
                name="Assessed completion rate (%)"
                fill="#9c7bdf"
                radius={[4, 4, 0, 0]}
                maxBarSize={35}
                isAnimationActive={false}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <DataTable data={data} mode={mode} />
    </>
  );
}
function Heatmap({ data }: { data: Analytics }) {
  const [selected, setSelected] = useState(data.to);
  const [details, setDetails] = useState<DayDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api(`/analytics/days/${selected}`, { signal: controller.signal })
      .then((result) => {
        setDetails(dayDetailsSchema.parse(result));
        setError(null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(messageOf(e));
      });
    return () => controller.abort();
  }, [selected, data]);
  const offset = (new Date(data.from + "T12:00:00Z").getUTCDay() + 6) % 7;
  return (
    <section className="panel activity-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR LOCAL CALENDAR</p>
          <h2>Your activity calendar</h2>
        </div>
        <span className="subtle-badge">
          {data.from} → {data.to}
        </span>
      </div>
      <p className="muted">
        Each number is a real completion count. Use arrow keys to move through
        dates, then Enter to inspect a day.
      </p>
      <div className="heatmap-scroll">
        <div className="heatmap-weekdays" aria-hidden="true">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
        </div>
        <div
          className="heatmap-grid"
          ref={grid}
          role="group"
          aria-label="Daily completion activity"
        >
          {Array.from({ length: offset }, (_, i) => (
            <span aria-hidden="true" key={`pad-${i}`} />
          ))}
          {data.daily.map((day, index) => (
            <button
              key={day.period}
              data-index={index}
              className={`heat-cell intensity-${day.intensity} ${selected === day.period ? "selected" : ""}`}
              aria-label={`${day.period}: ${day.completed} completed of ${day.scheduled} scheduled, ${day.pending} pending, ${day.frozen} protected`}
              title={`${day.period} · ${day.completed} completions`}
              tabIndex={selected === day.period ? 0 : -1}
              onClick={() => setSelected(day.period)}
              onKeyDown={(event) => {
                const movement =
                  event.key === "ArrowRight"
                    ? 7
                    : event.key === "ArrowLeft"
                      ? -7
                      : event.key === "ArrowDown"
                        ? 1
                        : event.key === "ArrowUp"
                          ? -1
                          : 0;
                if (movement) {
                  event.preventDefault();
                  const next = Math.min(
                    data.daily.length - 1,
                    Math.max(0, index + movement),
                  );
                  grid.current
                    ?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)
                    ?.focus();
                }
              }}
            >
              {day.completed || "·"}
            </button>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`heat-cell intensity-${i}`}>
            {i === 0
              ? "0"
              : i === 1
                ? "1"
                : i === 2
                  ? "2–3"
                  : i === 3
                    ? "4–6"
                    : "7+"}
          </span>
        ))}
        <span>More completions</span>
      </div>
      <div className="day-detail">
        <h3>{selected}</h3>
        <ErrorNotice message={error} />
        {details?.date === selected ? (
          details.sessions.length ? (
            <ul>
              {details.sessions.map((s) => (
                <li key={s.habitId}>
                  <span>{s.title}</span>
                  <strong className={`session-state ${s.status.toLowerCase()}`}>
                    {s.status.toLowerCase()}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No scheduled sessions on this date. Rest days do not count as
              misses.
            </p>
          )
        ) : (
          !error && (
            <p role="status" className="muted">
              Loading day details…
            </p>
          )
        )}
      </div>
    </section>
  );
}
const habitDetailSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  habit: analyticsHabitSchema,
  history: z.array(
    z.object({
      date: z.string(),
      completed: z.boolean(),
      completedAt: z.string(),
      undoneAt: z.string().nullable(),
      timezone: z.string(),
    }),
  ),
});
function HabitAnalytics({ data }: { data: Analytics }) {
  const [selected, setSelected] = useState(data.habits[0]?.id ?? "");
  const [detail, setDetail] = useState<z.infer<
    typeof habitDetailSchema
  > | null>(null);
  const [unit, setUnit] = useState<"weekly" | "monthly">("weekly");
  const [visible, setVisible] = useState(20);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void api(`/analytics/habits/${selected}?from=${data.from}&to=${data.to}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setDetail(habitDetailSchema.parse(result));
        setVisible(20);
        setError(null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(messageOf(e));
      });
    return () => controller.abort();
  }, [selected, data]);
  return (
    <section className="panel habit-analytics">
      <div className="section-heading">
        <div>
          <p className="eyebrow">FIND YOUR RHYTHM</p>
          <h2>Habit consistency</h2>
        </div>
        {data.habits.length > 0 && (
          <label className="inline-filter">
            Habit
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {data.habits.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title}
                  {h.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {data.habits.length === 0 ? (
        <p className="history-empty">
          Create a habit to start building your completion history.
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="habit-stats-table">
              <thead>
                <tr>
                  <th>Habit</th>
                  <th>Scheduled</th>
                  <th>Completed</th>
                  <th>Rate</th>
                  <th>Current streak</th>
                  <th>Longest</th>
                </tr>
              </thead>
              <tbody>
                {data.habits.map((h) => (
                  <tr key={h.id}>
                    <th scope="row">
                      <button
                        className="text-link"
                        onClick={() => setSelected(h.id)}
                      >
                        {h.title}
                      </button>
                      {h.archived && (
                        <small className="table-archived">Archived</small>
                      )}
                    </th>
                    <td>{h.scheduled}</td>
                    <td>{h.completed}</td>
                    <td>{percent(h.rate)}</td>
                    <td>{h.currentStreak}</td>
                    <td>{h.longestStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ErrorNotice message={error} />
          {detail?.habit.id === selected ? (
            <>
              <div className="detail-chart-heading">
                <h3>{detail.habit.title}</h3>
                <div
                  className="filter-tabs"
                  role="group"
                  aria-label="Habit trend interval"
                >
                  {(["weekly", "monthly"] as const).map((value) => (
                    <button
                      key={value}
                      aria-pressed={unit === value}
                      onClick={() => setUnit(value)}
                    >
                      {value === "weekly" ? "Weekly" : "Monthly"}
                    </button>
                  ))}
                </div>
              </div>
              <ProgressChart
                data={detail.habit[unit]}
                line
                label={`${detail.habit.title}: ${unit} assessed completion rate`}
              />
              <h3 className="history-title">
                Completion history in this range
              </h3>
              {detail.history.length ? (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Scheduled local date</th>
                          <th>Status</th>
                          <th>Original timezone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.history.slice(0, visible).map((row) => (
                          <tr key={row.date}>
                            <th scope="row">{row.date}</th>
                            <td>{row.completed ? "Completed" : "Undone"}</td>
                            <td>{row.timezone}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {visible < detail.history.length && (
                    <Button
                      variant="outline"
                      onClick={() => setVisible((n) => n + 20)}
                    >
                      Show earlier entries
                    </Button>
                  )}
                </>
              ) : (
                <p className="muted">
                  No check-ins recorded in this date range.
                </p>
              )}
            </>
          ) : (
            !error && (
              <p role="status" className="muted">
                Loading habit details…
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}
export function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<"weekly" | "monthly">("weekly");
  useEffect(() => {
    const controller = new AbortController();
    void api(`/analytics${applied ? `?${applied}` : ""}`, {
      signal: controller.signal,
    })
      .then((result) => {
        const parsed = analyticsSchema.parse(result);
        setData(parsed);
        setFrom(parsed.from);
        setTo(parsed.to);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(messageOf(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [applied, refresh]);
  const apply = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLoading(true);
      const fields = new FormData(event.currentTarget);
      const query = `from=${encodeURIComponent(String(fields.get("from") ?? ""))}&to=${encodeURIComponent(String(fields.get("to") ?? ""))}`;
      if (applied === query) setRefresh((n) => n + 1);
      else setApplied(query);
    },
    [applied],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROGRESS YOU CAN SEE</p>
          <h1>
            Your consistency, in focus<span>.</span>
          </h1>
          <p className="muted">
            A clearer picture of the effort you are putting in.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRefresh((n) => n + 1);
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </Button>
      </div>
      <form className="analytics-range" onSubmit={apply}>
        <label>
          From
          <input
            type="date"
            required
            name="from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            required
            name="to"
            value={to}
            max={data?.today}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button disabled={loading || !from || !to} type="submit">
          Apply range
        </Button>
        <span>
          {data?.timezone ?? "Your configured timezone"} · Up to 366 local dates
        </span>
      </form>
      <ErrorNotice message={error} />
      {loading && (
        <p role="status" className="muted">
          Loading your analytics…
        </p>
      )}
      {data && (
        <>
          <div className="analytics-summary-grid">
            {[
              {
                label: "Completed sessions",
                value: data.overview.completed,
                sub: `${data.overview.lifetimeCompletions} lifetime completions`,
                icon: Check,
              },
              {
                label: "Assessed completion rate",
                value: percent(data.overview.rate),
                sub: `${data.overview.assessed} assessed · ${data.overview.pending} pending today`,
                icon: CalendarDays,
              },
              {
                label: "Current streak",
                value: data.overview.currentStreak,
                sub: `Longest recorded: ${data.overview.longestStreak}`,
                icon: Flame,
              },
              {
                label: "Lifetime XP",
                value: data.overview.xp,
                sub: `Current level ${data.overview.level}`,
                icon: Zap,
              },
              {
                label: "Coins earned · net",
                value: data.overview.coinsEarned,
                sub: "Verified habit awards, minus undo",
                icon: Coins,
              },
              {
                label: "Coins spent",
                value: data.overview.coinsSpent,
                sub: `${data.overview.coinsRefunded} refunded · ${data.overview.coinBalance} available`,
                icon: Coins,
              },
              {
                label: "Achievements unlocked",
                value: data.overview.achievementsUnlocked,
                sub: "Earned badges stay unlocked",
                icon: Trophy,
              },
              {
                label: "Protected occurrences",
                value: data.overview.frozen,
                sub: "Freezes preserve streaks, not completion rates",
                icon: Snowflake,
              },
            ].map(({ label, value, sub, icon: Icon }) => (
              <section className="stat analytics-stat" key={label}>
                <div className="stat-top">
                  <span>{label}</span>
                  <Icon size={18} />
                </div>
                <strong>
                  {typeof value === "number" ? value.toLocaleString() : value}
                </strong>
                <p>{sub}</p>
              </section>
            ))}
          </div>
          <p className="analytics-policy">
            Sessions and rates cover {data.from} through {data.to}. Unfinished
            sessions today are excluded from assessed rates until the day
            closes. Freezes are not completions. Streaks, XP, coins, and
            achievement totals reflect all recorded history.
          </p>
          {data.overview.coinAdjustments !== 0 && (
            <p className="analytics-policy">
              Your coin ledger also includes {data.overview.coinAdjustments} net
              adjustment coins.
            </p>
          )}
          <Heatmap key={`calendar:${data.from}:${data.to}`} data={data} />
          <div className="analytics-chart-grid">
            <section className="panel chart-panel">
              <div className="section-heading">
                <h2>Completion rate</h2>
                <div
                  className="filter-tabs"
                  role="group"
                  aria-label="Completion chart interval"
                >
                  {(["weekly", "monthly"] as const).map((value) => (
                    <button
                      key={value}
                      aria-pressed={unit === value}
                      onClick={() => setUnit(value)}
                    >
                      {value === "weekly" ? "Weekly" : "Monthly"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="muted">
                Completed sessions ÷ assessed scheduled sessions. Empty periods
                have no rate.
              </p>
              <ProgressChart
                data={data[unit]}
                label={`${unit} completion rate`}
              />
            </section>
            <section className="panel chart-panel">
              <h2>XP over time</h2>
              <p className="muted">
                Net XP changes by local calendar month, including undo
                reversals.
              </p>
              <ProgressChart
                data={data.monthly}
                mode="xp"
                label="Monthly net XP change"
              />
            </section>
          </div>
          <HabitAnalytics key={`habits:${data.from}:${data.to}`} data={data} />
          <p className="policy-note">
            Metrics use your saved schedule versions and recorded archive
            pauses. Unrecorded older pauses and pre-gamification XP cannot be
            reconstructed. Partial weeks and months include only dates inside
            the selected range.
          </p>
        </>
      )}
    </>
  );
}
