import { transitionPurchase } from "../apps/api/src/rewards/service.js";
import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app.js";
import { fixture, origin, testDatabase, testUrl } from "./phase4-support.js";
const db = testDatabase();
afterAll(async () => {
  await db?.$disconnect();
});
describe.skipIf(!testUrl)("personal reward transactions", () => {
  it("creates, lists, partially edits, archives, and reactivates owned rewards", async () => {
    const user = await fixture(db!, 30);
    const reward = await user.reward(25);
    expect(reward).toMatchObject({
      category: "Food",
      icon: "coffee",
      affordable: true,
      createdAt: "2026-11-16T17:00:00.000Z",
    });
    const edited = await user
      .mutate("patch", `/api/rewards/${reward.id}`)
      .send({ title: "An excellent coffee" });
    expect(edited.status).toBe(200);
    expect(edited.body.reward).toMatchObject({
      title: "An excellent coffee",
      category: "Food",
      coinCost: 25,
    });
    expect(
      (await user.agent.get("/api/rewards?category=Food")).body.rewards,
    ).toHaveLength(1);
    expect(
      (await user.mutate("delete", `/api/rewards/${reward.id}`)).status,
    ).toBe(204);
    expect((await user.agent.get("/api/rewards")).body.rewards).toHaveLength(0);
    expect(
      (await user.agent.get("/api/rewards?status=archived")).body.rewards,
    ).toHaveLength(1);
    expect(
      (
        await user
          .mutate("patch", `/api/rewards/${reward.id}`)
          .send({ archived: false })
      ).body.reward.archivedAt,
    ).toBeNull();
  });
  it("validates prices, metadata, spoofed ownership, and purchase intent", async () => {
    const user = await fixture(db!);
    for (const body of [
      { title: "Tea", coinCost: 0 },
      { title: "Tea", coinCost: 1.5 },
      { title: "Tea", coinCost: 1, userId: randomUUID() },
      { title: "Tea", coinCost: 1, icon: "javascript:bad" },
    ])
      expect(
        (await user.mutate("post", "/api/rewards").send(body)).status,
      ).toBe(400);
    const reward = await user.reward();
    expect(
      (
        await user
          .mutate("post", `/api/rewards/${reward.id}/redemptions`)
          .send({ expectedCoinCost: 25 })
      ).status,
    ).toBe(400);
  });
  it("enforces authentication, CSRF, and cross-user ownership on every resource", async () => {
    expect((await request(createApp()).get("/api/rewards")).status).toBe(401);
    expect((await request(createApp()).get("/api/redemptions")).status).toBe(
      401,
    );
    const owner = await fixture(db!, 100);
    const other = await fixture(db!, 100);
    const reward = await owner.reward();
    const purchase = await owner.buy(reward.id, 25);
    for (const method of ["get", "patch", "delete"] as const) {
      const result =
        method === "get"
          ? await other.agent.get(`/api/rewards/${reward.id}`)
          : await other
              .mutate(method, `/api/rewards/${reward.id}`)
              .send(method === "patch" ? { title: "Spoofed" } : undefined);
      expect(result.status).toBe(404);
    }
    expect((await other.buy(reward.id, 25)).status).toBe(404);
    for (const action of ["cancel", "fulfill"])
      expect(
        (
          await other.mutate(
            "post",
            `/api/redemptions/${purchase.body.redemption.id}/${action}`,
          )
        ).status,
      ).toBe(404);
    expect(
      (await other.agent.get("/api/redemptions")).body.redemptions,
    ).toHaveLength(0);
    expect(
      (
        await owner.agent
          .post(`/api/rewards/${reward.id}/redemptions`)
          .set("Origin", origin)
          .send({ idempotencyKey: randomUUID(), expectedCoinCost: 25 })
      ).status,
    ).toBe(403);
  });
  it("rejects insufficient balance and stale prices without creating a purchase or debit", async () => {
    const user = await fixture(db!, 10);
    const reward = await user.reward(20);
    expect(reward.affordable).toBe(false);
    expect((await user.buy(reward.id, 20)).status).toBe(409);
    expect((await user.buy(reward.id, 10)).body.error.code).toBe(
      "PRICE_CHANGED",
    );
    expect(
      await db!.rewardRedemption.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect((await user.agent.get("/api/progression")).body.coins).toBe(10);
  });
  it("atomically debits the snapshot price and returns the authoritative balance", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward(25);
    const response = await user.buy(reward.id, 25);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      changed: true,
      balance: 75,
      redemption: { title: "Quiet coffee", coinCost: 25, status: "PENDING" },
    });
    const rows = await db!.coinTransaction.findMany({
      where: { redemptionId: response.body.redemption.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-25);
    expect(response.body.progression.xp).toBe(0);
  });
  it("deduplicates retries and simultaneous requests with one request key", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => user.buy(reward.id, 25, key)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(new Set(results.map((r) => r.body.redemption.id)).size).toBe(1);
    expect(
      await db!.rewardRedemption.count({ where: { userId: user.id } }),
    ).toBe(1);
    expect((await user.agent.get("/api/progression")).body.coins).toBe(75);
  });
  it("prevents concurrent overspending across different request keys", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward(70);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => user.buy(reward.id, 70)),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await user.agent.get("/api/progression")).body.coins).toBe(30);
  });
  it("rejects conflicting idempotency payloads while isolating the same key across users", async () => {
    const first = await fixture(db!, 100);
    const second = await fixture(db!, 100);
    const a = await first.reward(25);
    const b = await first.reward(30);
    const c = await second.reward(25);
    const key = randomUUID();
    expect((await first.buy(a.id, 25, key)).status).toBe(201);
    expect((await first.buy(b.id, 30, key)).body.error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
    expect((await first.buy(a.id, 24, key)).body.error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
    expect((await second.buy(c.id, 25, key)).status).toBe(201);
  });
  it("cancels once, refunds the original price, and prevents double refund under concurrency", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward(25);
    const purchase = await user.buy(reward.id, 25);
    await user
      .mutate("patch", `/api/rewards/${reward.id}`)
      .send({ title: "Different title", coinCost: 90, description: "Changed" });
    const id = purchase.body.redemption.id;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        user.mutate("post", `/api/redemptions/${id}/cancel`),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(results.filter((r) => r.body.changed)).toHaveLength(1);
    expect(results[0]!.body.redemption).toMatchObject({
      title: "Quiet coffee",
      coinCost: 25,
      description: "A small celebration.",
      status: "CANCELED",
    });
    expect((await user.agent.get("/api/progression")).body.coins).toBe(100);
    expect(
      await db!.coinTransaction.count({ where: { refundRedemptionId: id } }),
    ).toBe(1);
    expect(
      await db!.redemptionEvent.count({ where: { redemptionId: id } }),
    ).toBe(2);
  });
  it("fulfills once and rejects cancellation or fulfillment of a canceled purchase", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward();
    const a = await user.buy(reward.id, 25);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await user.mutate(
            "post",
            `/api/redemptions/${a.body.redemption.id}/fulfill`,
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await user.mutate(
          "post",
          `/api/redemptions/${a.body.redemption.id}/cancel`,
        )
      ).status,
    ).toBe(409);
    const b = await user.buy(reward.id, 25);
    await user.mutate(
      "post",
      `/api/redemptions/${b.body.redemption.id}/cancel`,
    );
    expect(
      (
        await user.mutate(
          "post",
          `/api/redemptions/${b.body.redemption.id}/fulfill`,
        )
      ).status,
    ).toBe(409);
    expect((await user.agent.get("/api/progression")).body.coins).toBe(75);
  });
  it("serializes conflicting fulfill/cancel transitions with a single terminal result", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward();
    const purchase = await user.buy(reward.id, 25);
    const id = purchase.body.redemption.id;
    const results = await Promise.all(
      ["fulfill", "cancel"].map((action) =>
        user.mutate("post", `/api/redemptions/${id}/${action}`),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = await db!.rewardRedemption.findUniqueOrThrow({ where: { id } });
    expect(["FULFILLED", "CANCELED"]).toContain(row.status);
    expect(
      await db!.redemptionEvent.count({ where: { redemptionId: id } }),
    ).toBe(2);
    expect((await user.agent.get("/api/progression")).body.coins).toBe(
      row.status === "CANCELED" ? 100 : 75,
    );
  });
  it("preserves archived reward history and returns old receipts on idempotent retries", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward();
    const key = randomUUID();
    const purchase = await user.buy(reward.id, 25, key);
    await user.mutate("delete", `/api/rewards/${reward.id}`);
    expect((await user.buy(reward.id, 25)).status).toBe(409);
    expect((await user.buy(reward.id, 25, key)).body.redemption.id).toBe(
      purchase.body.redemption.id,
    );
    expect(
      (await user.agent.get("/api/redemptions")).body.redemptions[0].title,
    ).toBe("Quiet coffee");
    expect(
      (
        await user.mutate(
          "post",
          `/api/redemptions/${purchase.body.redemption.id}/cancel`,
        )
      ).body.balance,
    ).toBe(100);
    expect((await user.buy(reward.id, 25, key)).body.redemption.status).toBe(
      "CANCELED",
    );
  });
  it("rolls back a purchase if its debit writer fails", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward();
    const broken = db!.$extends({
      query: {
        coinTransaction: {
          async create() {
            throw new Error("Injected debit failure");
          },
        },
      },
    });
    const app = createApp(origin, {
      database: () => broken as unknown as NonNullable<typeof db>,
      now: () => new Date("2026-11-16T17:00:00Z"),
    });
    const session = await user.agent.get("/api/auth/me");
    const stored = await db!.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    const token = await user.agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({
        email: session.body.user.email,
        password: "HabitQuest phase four test password",
      });
    const cookie = token.headers["set-cookie"]![0]!.split(";")[0]!;
    const response = await request(app)
      .post(`/api/rewards/${reward.id}/redemptions`)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", token.body.csrfToken)
      .send({ idempotencyKey: randomUUID(), expectedCoinCost: 25 });
    expect(stored.userId).toBe(user.id);
    expect(response.status).toBe(500);
    expect(
      await db!.rewardRedemption.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect((await user.agent.get("/api/progression")).body.coins).toBe(100);
  });
  it("rejects missing debits, incorrect refunds, and mutation of immutable purchase details", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward();
    await expect(
      db!.$transaction(async (tx) => {
        const row = await tx.rewardRedemption.create({
          data: {
            userId: user.id,
            rewardId: reward.id,
            coinCost: 25,
            rewardTitle: "Quiet coffee",
            idempotencyKey: randomUUID(),
            lifecycleManaged: true,
          },
        });
        await tx.redemptionEvent.create({
          data: {
            redemptionId: row.id,
            status: "PENDING",
            createdAt: row.createdAt,
          },
        });
      }),
    ).rejects.toThrow();
    const purchase = await user.buy(reward.id, 25);
    const id = purchase.body.redemption.id;
    await expect(
      db!.coinTransaction.create({
        data: {
          userId: user.id,
          refundRedemptionId: id,
          amount: 1,
          reason: "bad refund",
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db!.rewardRedemption.update({
        where: { id },
        data: { rewardTitle: "Rewritten" },
      }),
    ).rejects.toThrow();
    await expect(
      db!.rewardRedemption.update({
        where: { id },
        data: { status: "CANCELED", canceledAt: new Date() },
      }),
    ).rejects.toThrow();
    expect((await user.agent.get("/api/progression")).body.coins).toBe(75);
  });
  it("paginates reward and redemption history using owned cursors", async () => {
    const user = await fixture(db!, 100);
    for (let i = 0; i < 3; i++) {
      const r = await user.reward(10);
      await user.buy(r.id, 10);
    }
    const first = await user.agent.get("/api/rewards?limit=2");
    expect(first.body.rewards).toHaveLength(2);
    const next = await user.agent.get(
      `/api/rewards?limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(next.body.rewards).toHaveLength(1);
    const purchases = await user.agent.get("/api/redemptions?limit=2");
    expect(purchases.body.redemptions).toHaveLength(2);
    expect(
      (
        await user.agent.get(
          `/api/redemptions?limit=2&cursor=${purchases.body.nextCursor}`,
        )
      ).body.redemptions,
    ).toHaveLength(1);
  });
  it("preserves Phase 3 undo rules when coins are spent, then permits undo after a refund", async () => {
    const user = await fixture(db!);
    const habit = await user.habit();
    await user
      .mutate("post", `/api/habits/${habit}/completions`)
      .send({ scheduledDate: "2026-11-16" });
    const reward = await user.reward(5);
    const purchase = await user.buy(reward.id, 5);
    expect(purchase.body.balance).toBe(5);
    expect(
      (
        await user.mutate(
          "delete",
          `/api/habits/${habit}/completions/2026-11-16`,
        )
      ).status,
    ).toBe(409);
    await user.mutate(
      "post",
      `/api/redemptions/${purchase.body.redemption.id}/cancel`,
    );
    expect(
      (
        await user.mutate(
          "delete",
          `/api/habits/${habit}/completions/2026-11-16`,
        )
      ).status,
    ).toBe(204);
    expect((await user.agent.get("/api/progression")).body).toMatchObject({
      xp: 0,
      coins: 0,
    });
  });
  it("rolls back a refund and status change if lifecycle auditing fails", async () => {
    const user = await fixture(db!, 100);
    const reward = await user.reward();
    const purchase = await user.buy(reward.id, 25);
    const id = purchase.body.redemption.id;
    const broken = db!.$extends({
      query: {
        redemptionEvent: {
          async create({ args, query }) {
            if (args.data.status === "CANCELED")
              throw new Error("Injected refund audit failure");
            return query(args);
          },
        },
      },
    });
    await expect(
      transitionPurchase(
        {
          database: () => broken as unknown as NonNullable<typeof db>,
          now: () => new Date("2026-11-16T17:00:00Z"),
          origin,
          production: false,
          sessionDays: 7,
          authLimit: 20,
        },
        user.id,
        id,
        "CANCELED",
      ),
    ).rejects.toThrow("Injected refund audit failure");
    expect(
      await db!.coinTransaction.count({ where: { refundRedemptionId: id } }),
    ).toBe(0);
    expect(
      (await db!.rewardRedemption.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("PENDING");
    expect((await user.agent.get("/api/progression")).body.coins).toBe(75);
  });
});
