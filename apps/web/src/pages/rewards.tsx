import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import {
  Gift,
  Film,
  Utensils,
  Gamepad2,
  Coffee,
  Sparkles,
  Mountain,
  BookOpen,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  Coins,
  Check,
  ArrowLeft,
  X,
} from "lucide-react";
import {
  rewardCategorySchema,
  rewardIconSchema,
  rewardInputSchema,
  shopRewardSchema,
  purchaseSchema,
  purchaseReceiptSchema,
  redeemInputSchema,
  type ShopReward,
  type Purchase,
} from "@habitquest/shared";
import { useAuth } from "@/auth";
import { useProgression } from "@/progression";
import { api, HttpError, messageOf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, ErrorNotice } from "@/components/forms";
const icons = {
  gift: Gift,
  film: Film,
  utensils: Utensils,
  gamepad: Gamepad2,
  coffee: Coffee,
  sparkles: Sparkles,
  mountain: Mountain,
  book: BookOpen,
};
const intentSchema = redeemInputSchema.extend({
  rewardId: z.uuid(),
  title: z.string().max(120),
});
type Intent = z.infer<typeof intentSchema>;
function RewardIcon({ name }: { name: ShopReward["icon"] }) {
  const Icon = icons[name ?? "gift"];
  return <Icon size={26} />;
}
const catalogSchema = z.object({
  rewards: z.array(shopRewardSchema),
  balance: z.number(),
  nextCursor: z.uuid().nullable(),
});
const historySchema = z.object({
  redemptions: z.array(purchaseSchema),
  nextCursor: z.uuid().nullable(),
});
export function RewardsPage() {
  const { user } = useAuth();
  const game = useProgression();
  const storageKey = `habitquest:purchase-intent:${user!.id}`;
  const [restoredIntent] = useState<Intent | null>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? intentSchema.parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [category, setCategory] = useState("");
  const [rows, setRows] = useState<ShopReward[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<Purchase[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(restoredIntent);
  const [uncertain, setUncertain] = useState(restoredIntent !== null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const historyRequest = useRef(0);
  const query = `status=${status}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  const loadCatalog = useCallback(async () => {
    const id = ++request.current;
    const result = catalogSchema.parse(await api(`/rewards?${query}`));
    if (id === request.current) {
      setRows(result.rewards);
      setCursor(result.nextCursor);
      setBalance(result.balance);
    }
  }, [query]);
  const loadHistory = useCallback(() => {
    const id = ++historyRequest.current;
    return api(
      `/redemptions${historyFilter ? `?status=${historyFilter}` : ""}`,
    ).then((value) => {
      const result = historySchema.parse(value);
      if (id === historyRequest.current) {
        setHistory(result.redemptions);
        setHistoryCursor(result.nextCursor);
      }
    });
  }, [historyFilter]);
  useEffect(() => {
    void loadCatalog()
      .then(() => setError(null))
      .catch((e) => setError(messageOf(e)));
  }, [loadCatalog]);
  useEffect(() => {
    void loadHistory().catch((e) => setError(messageOf(e)));
  }, [loadHistory]);
  useEffect(() => {
    const refresh = () => {
      void Promise.all([loadCatalog(), loadHistory()]).catch((e) =>
        setError(messageOf(e)),
      );
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [loadCatalog, loadHistory]);
  useEffect(() => {
    const node = dialog.current;
    if (intent && !node?.open) node?.showModal();
    return () => {
      node?.close();
    };
  }, [intent]);
  function openPurchase(reward: ShopReward) {
    if (intent) return;
    setPurchaseError(null);
    setUncertain(false);
    setIntent({
      rewardId: reward.id,
      title: reward.title,
      expectedCoinCost: reward.coinCost,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  async function purchase() {
    if (!intent) return;
    setPending("purchase");
    setPurchaseError(null);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(intent));
    } catch {
      setPurchaseError(
        "Session storage is unavailable. This purchase has not been sent. Enable storage and retry.",
      );
      setPending(null);
      return;
    }
    try {
      setUncertain(true);
      const result = purchaseReceiptSchema.parse(
        await api(`/rewards/${intent.rewardId}/redemptions`, {
          method: "POST",
          body: {
            idempotencyKey: intent.idempotencyKey,
            expectedCoinCost: intent.expectedCoinCost,
          },
        }),
      );
      game.accept(result.progression);
      setBalance(result.balance);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* A confirmed receipt is authoritative even if storage cleanup is blocked. */
      }
      setIntent(null);
      setUncertain(false);
      setNotice(
        result.changed
          ? `${result.redemption.title} reserved for ${result.redemption.coinCost} coins. Mark it fulfilled when you enjoy it.`
          : `Previous purchase confirmed: ${result.redemption.title}. No additional coins charged.`,
      );
      await Promise.all([loadCatalog(), loadHistory()]).catch((e) =>
        setError(`Purchase saved, but refreshing failed: ${messageOf(e)}`),
      );
    } catch (error) {
      setPurchaseError(messageOf(error));
      if (
        error instanceof HttpError &&
        [
          "INSUFFICIENT_COINS",
          "PRICE_CHANGED",
          "REWARD_ARCHIVED",
          "VALIDATION_ERROR",
          "NOT_FOUND",
        ].includes(error.code ?? "")
      ) {
        sessionStorage.removeItem(storageKey);
        setUncertain(false);
        await loadCatalog().catch(() => {});
      } else setUncertain(true);
    } finally {
      setPending(null);
    }
  }
  async function archive(row: ShopReward) {
    setPending(row.id);
    setError(null);
    try {
      await api(`/rewards/${row.id}`, {
        method: row.archivedAt ? "PATCH" : "DELETE",
        ...(row.archivedAt ? { body: { archived: false } } : {}),
      });
      await loadCatalog();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(null);
    }
  }
  async function transition(row: Purchase, action: "cancel" | "fulfill") {
    setPending(row.id);
    setError(null);
    try {
      const result = purchaseReceiptSchema.parse(
        await api(`/redemptions/${row.id}/${action}`, { method: "POST" }),
      );
      game.accept(result.progression);
      setBalance(result.balance);
      setNotice(
        !result.changed
          ? "This purchase was already updated. No additional coins changed."
          : action === "cancel"
            ? `${row.coinCost} coins refunded for ${row.title}.`
            : `${row.title} marked fulfilled. Enjoy it!`,
      );
      await Promise.all([loadCatalog(), loadHistory()]);
    } catch (e) {
      setError(messageOf(e));
      await game.refresh().catch(() => {});
    } finally {
      setPending(null);
    }
  }
  async function moreCatalog() {
    if (!cursor) return;
    setPending("more");
    try {
      const result = catalogSchema.parse(
        await api(`/rewards?${query}&cursor=${cursor}`),
      );
      setRows((previous) => [...(previous ?? []), ...result.rewards]);
      setCursor(result.nextCursor);
      setBalance(result.balance);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(null);
    }
  }
  async function moreHistory() {
    if (!historyCursor) return;
    setPending("more-history");
    try {
      const result = historySchema.parse(
        await api(
          `/redemptions?cursor=${historyCursor}${historyFilter ? `&status=${historyFilter}` : ""}`,
        ),
      );
      setHistory((previous) => [...(previous ?? []), ...result.redemptions]);
      setHistoryCursor(result.nextCursor);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE THE EFFORT FEEL WORTH IT</p>
          <h1>
            Your rewards<span>.</span>
          </h1>
          <p className="muted">
            Little things to look forward to. Chosen by you, earned by showing
            up.
          </p>
        </div>
        <Button asChild>
          <Link to="/rewards/new">
            <Plus size={17} />
            New reward
          </Link>
        </Button>
      </div>
      <section className="shop-hero">
        <div className="shop-hero-icon">
          <Gift size={36} />
        </div>
        <div>
          <span className="eyebrow">YOUR PERSONAL REWARD SPACE</span>
          <h2>Turn consistency into something good.</h2>
          <p>Reserve a reward with coins. Enjoy it, then mark it fulfilled.</p>
        </div>
        <div className="shop-balance">
          <Coins size={23} />
          <strong>{balance === null ? "—" : balance.toLocaleString()}</strong>
          <span>available coins</span>
        </div>
      </section>
      <div className="shop-filters">
        <div className="filter-tabs" role="group" aria-label="Reward status">
          {(["active", "archived"] as const).map((value) => (
            <button
              disabled={pending !== null}
              aria-pressed={status === value}
              key={value}
              onClick={() => {
                if (status !== value) {
                  setStatus(value);
                  setRows(null);
                }
              }}
            >
              {value === "active" ? "Available rewards" : "Archived"}
            </button>
          ))}
        </div>
        <label className="inline-filter">
          Category
          <select
            value={category}
            disabled={pending !== null}
            onChange={(e) => {
              setCategory(e.target.value);
              setRows(null);
            }}
          >
            <option value="">All categories</option>
            {rewardCategorySchema.options.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <ErrorNotice message={error} />
      {error && (
        <Button
          variant="outline"
          onClick={() => {
            void Promise.all([loadCatalog(), loadHistory()])
              .then(() => setError(null))
              .catch((e) => setError(messageOf(e)));
          }}
        >
          Retry rewards
        </Button>
      )}
      {notice && (
        <div className="shop-notice" role="status">
          <Check size={17} />
          {notice}
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss reward feedback"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {rows === null ? (
        <section className="panel loading-panel" role="status">
          Loading your rewards…
        </section>
      ) : rows.length ? (
        <div className="reward-grid">
          {rows.map((row) => (
            <article className="panel reward-card" key={row.id}>
              <div className={`reward-art icon-${row.icon ?? "gift"}`}>
                <RewardIcon name={row.icon} />
                <span>{row.category}</span>
              </div>
              <h2>{row.title}</h2>
              <p>
                {row.description || "A personal reason to keep showing up."}
              </p>
              <div className="reward-price">
                <span>
                  <Coins size={16} />
                  {row.coinCost.toLocaleString()} coins
                </span>
                <small>
                  {row.archivedAt
                    ? "Archived"
                    : row.affordable
                      ? "Within reach"
                      : "Keep building your balance"}
                </small>
              </div>
              <div className="reward-card-actions">
                {!row.archivedAt && (
                  <Button
                    disabled={
                      !row.affordable || pending !== null || intent !== null
                    }
                    onClick={() => openPurchase(row)}
                  >
                    Redeem reward
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link
                    to={`/rewards/${row.id}/edit`}
                    aria-label={`Edit ${row.title}`}
                  >
                    <Pencil size={15} />
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  disabled={pending !== null}
                  aria-label={`${row.archivedAt ? "Reactivate" : "Archive"} ${row.title}`}
                  onClick={() => void archive(row)}
                >
                  {row.archivedAt ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel empty-state">
          <div className="empty-icon">
            <Gift size={28} />
          </div>
          <h3>
            {status === "archived"
              ? "No archived rewards"
              : "What would feel rewarding?"}
          </h3>
          <p>
            {category
              ? "No rewards match this category. Try another filter."
              : "Create a small celebration, a favorite meal, or an experience you want to make time for."}
          </p>
          <Button asChild>
            <Link to="/rewards/new">Create a reward</Link>
          </Button>
        </section>
      )}
      {cursor && (
        <Button
          className="load-more"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void moreCatalog()}
        >
          Load more rewards
        </Button>
      )}
      <section className="panel redemption-history">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE MOMENTS YOU HAVE EARNED</p>
            <h2>Your redemptions</h2>
          </div>
          <label className="inline-filter">
            Status
            <select
              value={historyFilter}
              disabled={pending !== null}
              onChange={(e) => {
                setHistoryFilter(e.target.value);
                setHistory(null);
              }}
            >
              <option value="">All purchases</option>
              <option value="PENDING">Pending</option>
              <option value="FULFILLED">Fulfilled</option>
              <option value="CANCELED">Canceled</option>
            </select>
          </label>
        </div>
        <p className="muted">
          Pending rewards can be canceled for an exact refund. Fulfilled rewards
          are final.
        </p>
        {history === null ? (
          <p role="status" className="muted">
            Loading redemption history…
          </p>
        ) : history.length ? (
          <ul className="redemption-list">
            {history.map((row) => (
              <li key={row.id}>
                <div className="redemption-symbol">
                  <RewardIcon name={row.icon} />
                </div>
                <div className="redemption-details">
                  <h3>{row.title}</h3>
                  <p>
                    {row.coinCost.toLocaleString()} coins ·{" "}
                    {new Date(row.createdAt).toLocaleDateString("en-US", {
                      timeZone: user!.timezone,
                    })}
                  </p>
                  <small
                    className={`purchase-status ${(row.status ?? "legacy").toLowerCase()}`}
                  >
                    {row.status
                      ? row.status.toLowerCase()
                      : "Legacy snapshot — lifecycle untracked"}
                  </small>
                </div>
                {row.managed && row.status === "PENDING" && (
                  <div className="redemption-actions">
                    <Button
                      disabled={pending !== null}
                      onClick={() => void transition(row, "fulfill")}
                    >
                      <Check size={14} />
                      Mark fulfilled
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() => void transition(row, "cancel")}
                    >
                      Cancel & refund
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="history-empty">
            No purchases in this view yet. Your original reward details and
            prices will stay here after edits or archiving.
          </p>
        )}
        {historyCursor && (
          <Button
            variant="outline"
            disabled={pending !== null}
            onClick={() => void moreHistory()}
          >
            Load earlier redemptions
          </Button>
        )}
      </section>
      <dialog
        ref={dialog}
        className="purchase-dialog"
        aria-labelledby="purchase-title"
        onCancel={(e) => {
          if (pending === "purchase" || uncertain) e.preventDefault();
          else setIntent(null);
        }}
      >
        <div className="empty-icon">
          <Gift size={28} />
        </div>
        <p className="eyebrow">A LITTLE CELEBRATION</p>
        <h2 id="purchase-title">
          {uncertain
            ? "Confirm your previous request"
            : "Ready to enjoy your reward?"}
        </h2>
        <p>
          Reserve <strong>{intent?.title}</strong> for{" "}
          <strong>{intent?.expectedCoinCost.toLocaleString()} coins</strong>.
        </p>
        <p className="muted">
          You can cancel a pending redemption for an exact refund. Marking it
          fulfilled makes it final.
        </p>
        <ErrorNotice message={purchaseError} />
        {uncertain && (
          <p className="policy-note">
            The request key is saved in this browser tab. Retrying confirms the
            same purchase and cannot charge it twice. Resolve this request
            before starting another purchase.
          </p>
        )}
        <div className="form-actions">
          <Button
            disabled={pending === "purchase"}
            onClick={() => void purchase()}
          >
            {pending === "purchase"
              ? "Confirming…"
              : uncertain
                ? "Retry purchase safely"
                : "Confirm redemption"}
          </Button>
          <Button
            variant="outline"
            disabled={pending === "purchase" || uncertain}
            onClick={() => {
              setIntent(null);
              setPurchaseError(null);
            }}
          >
            Close
          </Button>
        </div>
      </dialog>
    </>
  );
}
export function RewardForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState(50);
  const [category, setCategory] = useState<ShopReward["category"]>("Personal");
  const [icon, setIcon] = useState<ShopReward["icon"]>("gift");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<{ reward: ShopReward }>(`/rewards/${id}`)
      .then(({ reward: r }) => {
        if (active) {
          setTitle(r.title);
          setDescription(r.description ?? "");
          setCost(r.coinCost);
          setCategory(r.category);
          setIcon(r.icon);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(messageOf(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const input = rewardInputSchema.parse({
        title,
        description,
        coinCost: cost,
        category,
        icon,
      });
      await api(id ? `/rewards/${id}` : "/rewards", {
        method: id ? "PATCH" : "POST",
        body: input,
      });
      navigate("/rewards");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/rewards">
        <ArrowLeft size={16} />
        Back to rewards
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SOMETHING PERSONAL TO WORK TOWARD</p>
          <h1>
            {id ? "Edit your reward" : "Create a reward"}
            <span>.</span>
          </h1>
          <p className="muted">
            Choose something meaningful. A small reward can go a long way.
          </p>
        </div>
      </div>
      <ErrorNotice message={error} />
      {loaded ? (
        <div className="editor-grid">
          <form className="panel habit-form" onSubmit={save}>
            <fieldset disabled={pending} className="form-reset">
              <Field label="Reward title">
                <input
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A quiet coffee break"
                />
              </Field>
              <Field label="Description (optional)">
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Make it something you look forward to."
                />
              </Field>
              <div className="form-columns">
                <Field label="Coin price">
                  <input
                    type="number"
                    required
                    min={1}
                    max={1000000}
                    value={cost}
                    onChange={(e) => setCost(Number(e.target.value))}
                  />
                </Field>
                <Field label="Category">
                  <select
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as ShopReward["category"])
                    }
                  >
                    {rewardCategorySchema.options.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Reward icon">
                <select
                  value={icon ?? ""}
                  onChange={(e) =>
                    setIcon(
                      e.target.value
                        ? (e.target.value as ShopReward["icon"])
                        : null,
                    )
                  }
                >
                  <option value="">No icon</option>
                  {rewardIconSchema.options.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="policy-note">
                Editing a reward changes future purchases only. Previous
                redemptions keep their original title, description, icon, and
                price.
              </p>
              <div className="form-actions">
                <Button type="submit">
                  {pending ? "Saving…" : id ? "Save reward" : "Create reward"}
                </Button>
                <Button asChild variant="outline">
                  <Link to="/rewards">Cancel</Link>
                </Button>
              </div>
            </fieldset>
          </form>
          <aside className="panel editor-tip">
            <div className="empty-icon">
              <RewardIcon name={icon} />
            </div>
            <h2>A little motivation, on your terms.</h2>
            <p className="muted">
              Coins come from your verified habit completions. Rewards are
              personal promises to yourself, with no real-money purchase or
              payment processing.
            </p>
          </aside>
        </div>
      ) : (
        !error && <p role="status">Loading reward…</p>
      )}
    </>
  );
}
