import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { Zap, Coins, Snowflake, Flame, Trophy, X } from "lucide-react";
import {
  progressionSchema,
  type Progression,
  type CompletionReceipt,
} from "@habitquest/shared";
import { useAuth } from "@/auth";
import { api, messageOf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/forms";
type GameContext = {
  data: Progression | null;
  error: string | null;
  refresh: () => Promise<void>;
  accept: (game: Progression) => void;
  celebrate: (receipt: CompletionReceipt) => void;
};
const Context = createContext<GameContext | null>(null);
export function ProgressionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [data, setData] = useState<Progression | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CompletionReceipt | null>(null);
  const sequence = useRef(0);
  const accept = useCallback((game: Progression) => {
    sequence.current++;
    setData(game);
    setError(null);
  }, []);
  const load = useCallback(async (reconcile = false) => {
    const id = ++sequence.current;
    try {
      const result = progressionSchema.parse(
        await api(
          reconcile ? "/progression/reconcile" : "/progression",
          reconcile ? { method: "POST" } : {},
        ),
      );
      if (id === sequence.current) {
        setData(result);
        setError(null);
      }
    } catch (error) {
      if (id === sequence.current) setError(messageOf(error));
      throw error;
    }
  }, []);
  const refresh = useCallback(() => load(), [load]);
  useEffect(() => {
    void load(true).catch(() => {});
  }, [load, pathname, user?.timezone]);
  useEffect(() => {
    const reload = () => {
      void refresh().catch(() => {});
    };
    window.addEventListener("focus", reload);
    const timer = setInterval(reload, 60000);
    return () => {
      window.removeEventListener("focus", reload);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => setReceipt(null), 8000);
    return () => clearTimeout(timer);
  }, [receipt]);
  const celebrate = (result: CompletionReceipt) => {
    accept(result.progression);
    if (result.reward.changed) setReceipt(result);
  };
  return (
    <Context.Provider value={{ data, error, refresh, accept, celebrate }}>
      {children}
      {receipt && (
        <div className="reward-feedback" role="status" aria-live="polite">
          <button
            aria-label="Dismiss completion feedback"
            onClick={() => setReceipt(null)}
          >
            <X size={17} />
          </button>
          <span className="celebration-icon">
            {receipt.reward.levelAfter > receipt.reward.levelBefore ? (
              <Trophy size={25} />
            ) : receipt.reward.xp < 0 ? (
              <Zap size={25} />
            ) : (
              <Flame size={25} />
            )}
          </span>
          <div>
            <strong>
              {receipt.reward.xp < 0
                ? "Completion undone"
                : receipt.reward.levelAfter > receipt.reward.levelBefore
                  ? `Level ${receipt.reward.levelAfter} unlocked!`
                  : receipt.reward.milestone
                    ? `${receipt.reward.milestone}-session streak!`
                    : "A step forward."}
            </strong>
            <p>
              {receipt.reward.xp > 0
                ? `+${receipt.reward.xp} XP · +${receipt.reward.coins} coins${receipt.reward.bonusPercent ? ` · ${receipt.reward.bonusPercent}% streak bonus` : ""}`
                : receipt.reward.xp < 0
                  ? `${receipt.reward.xp} XP · ${receipt.reward.coins} coins reversed`
                  : "Your daily check-in has been updated."}
              {receipt.reward.restored ? " Original award restored." : ""}
            </p>
            {receipt.reward.milestone !== null &&
              receipt.reward.levelAfter > receipt.reward.levelBefore && (
                <p>{receipt.reward.milestone}-session streak milestone.</p>
              )}
            {receipt.reward.newAchievements.length > 0 && (
              <p>
                Achievement unlocked:{" "}
                {receipt.progression.achievements
                  .filter((a) => receipt.reward.newAchievements.includes(a.key))
                  .map((a) => a.title)
                  .join(", ")}
              </p>
            )}
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
export function useProgression() {
  const context = useContext(Context);
  if (!context) throw new Error("ProgressionProvider missing");
  return context;
}
export function ProgressionBar() {
  const game = useProgression();
  return (
    <>
      <ErrorNotice message={game.error} />
      {game.error && (
        <Button
          variant="outline"
          onClick={() => void game.refresh().catch(() => {})}
        >
          Retry progression
        </Button>
      )}
      {game.data ? (
        <section className="progression-bar" aria-label="Your game progression">
          <div className="level-indicator">
            <span>LVL</span>
            <strong>{game.data.level}</strong>
          </div>
          <div className="level-track">
            <div>
              <strong>{game.data.xp.toLocaleString()} lifetime XP</strong>
              <span>
                {game.data.xpIntoLevel} / {game.data.xpForNextLevel} XP
              </span>
            </div>
            <progress
              aria-label="Progress to next level"
              value={game.data.xpIntoLevel}
              max={game.data.xpForNextLevel}
            />
          </div>
          <span className="economy-counter gold">
            <Coins size={18} />
            <strong>{game.data.coins.toLocaleString()}</strong>
            <small>coins</small>
          </span>
          <span className="economy-counter ice">
            <Snowflake size={18} />
            <strong>{game.data.freezes.available}</strong>
            <small>freezes</small>
          </span>
        </section>
      ) : (
        !game.error && (
          <p className="progression-loading" role="status">
            Loading your progression…
          </p>
        )
      )}
    </>
  );
}
export function StreakBadge({ habitId }: { habitId: string }) {
  const { data } = useProgression();
  const stats = data?.habits.find((h) => h.habitId === habitId);
  return stats ? (
    <span
      className="streak-badge"
      title={`Current: ${stats.current} real completions. Longest: ${stats.longest}. Frozen misses preserve the run without increasing it.`}
    >
      <Flame size={14} />
      {stats.current} streak <span>· best {stats.longest}</span>
    </span>
  ) : null;
}
export function AchievementPanel() {
  const { data } = useProgression();
  return (
    <section className="panel achievements-panel">
      <p className="eyebrow">MILESTONES THAT MEAN SOMETHING</p>
      <h2>Your achievements</h2>
      <p className="muted">
        Earned badges stay unlocked, including after an undo.
      </p>
      {data ? (
        <div className="achievement-grid">
          {data.achievements.map((a) => (
            <article
              className={`achievement ${a.unlockedAt ? "earned" : "locked"}`}
              key={a.key}
            >
              <span>
                <Trophy size={22} />
              </span>
              <div>
                <h3>{a.title}</h3>
                <p>{a.description}</p>
                <small>
                  {a.unlockedAt
                    ? `Earned ${new Date(a.unlockedAt).toLocaleDateString("en-US", { timeZone: data.timezone })}`
                    : "Not yet unlocked"}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p role="status" className="muted">
          Loading achievements…
        </p>
      )}
    </section>
  );
}
export function FreezePanel() {
  const game = useProgression();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function consume() {
    if (!game.data) return;
    const candidate = game.data.freezeCandidates.find(
      (c) => `${c.habitId}:${c.date}` === selected,
    );
    if (!candidate) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ changed: boolean; progression: Progression }>(
        "/progression/freezes",
        {
          method: "POST",
          body: { habitId: candidate.habitId, scheduledDate: candidate.date },
        },
      );
      game.accept(progressionSchema.parse(result.progression));
      setSelected("");
      setNotice(
        result.changed
          ? "Freeze applied. Your streak is protected; no XP or coins were awarded."
          : "This occurrence was already protected.",
      );
    } catch (error) {
      setError(messageOf(error));
      await game.refresh().catch(() => {});
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel freeze-panel">
      <div className="freeze-heading">
        <Snowflake size={24} />
        <div>
          <h2>Keep a little breathing room.</h2>
          <p>
            {game.data
              ? `${game.data.freezes.available} of ${game.data.freezes.maximum} freezes available`
              : "Loading freeze inventory…"}
          </p>
        </div>
      </div>
      <p className="muted">
        One freeze protects one missed scheduled occurrence without adding a
        completion or earning rewards. Use it within seven closed local days, on
        or after its grant date. A freeze cannot be refunded.
      </p>
      <ErrorNotice message={error} />
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {game.data && game.data.freezeCandidates.length > 0 ? (
        <>
          <label className="field">
            <span>Missed occurrence to protect</span>
            <select
              value={selected}
              disabled={pending}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Choose a habit and date</option>
              {game.data.freezeCandidates.map((c) => (
                <option
                  key={`${c.habitId}:${c.date}`}
                  value={`${c.habitId}:${c.date}`}
                >
                  {c.title} · {c.date}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={
              pending ||
              !game.data.freezeCandidates.some(
                (c) => `${c.habitId}:${c.date}` === selected,
              )
            }
            onClick={() => void consume()}
          >
            <Snowflake size={15} />
            {pending ? "Applying…" : "Use one freeze"}
          </Button>
        </>
      ) : (
        <p className="policy-note">
          {game.data?.freezes.available === 0
            ? "Your freeze has been used. No freeze store is available in this phase."
            : "No eligible missed occurrences to protect right now."}
        </p>
      )}
    </section>
  );
}
