import type { Db } from "../db.ts";
import { now } from "../db.ts";
import type { Account } from "../auth.ts";
import { accountForToken } from "../auth.ts";
import type { Ctx } from "../http.ts";
import { body, fail, json, text } from "../http.ts";

/**
 * Syncing for the homework plan, and the one number that is not the client's to decide.
 *
 * Syncing only the game save would lose the half a child's effort actually went into: the stamina,
 * the tasks and the ledger. But it also has to answer a sharper problem than device changes. The
 * whole design rests on "a grade means an adult looked at this", and while the balance is computed
 * in the browser, a child who can edit local storage can award themselves any amount.
 *
 * So the balance is split along the line where the incentive is. Stamina *earned* is credited here
 * and only ever by a parent-authenticated request, which is what makes a grade unforgeable. Stamina
 * *spent* stays with the client: spending your own balance can only lower it, so there is nothing to
 * gain by lying, and keeping it local is what lets a run continue while the service is unreachable.
 */
export function homeworkRoutes(db: Db) {
  /**
   * Whose plan a request may touch.
   *
   * A child reaches only their own. A parent may name one of their children, which is what lets
   * grading happen from the parent's own phone rather than only on the child's device.
   */
  function targetFor(ctx: Ctx, caller: Account): number | null {
    const asked = ctx.query.get("account");
    if (!asked || asked === "self") {
      return caller.id;
    }
    if (caller.role !== "parent") {
      return null;
    }
    const child = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND parent_id = ? AND role = 'child'")
      .get(Number(asked), caller.id) as { id: number } | undefined;
    return child?.id ?? null;
  }

  function requireCaller(ctx: Ctx): Account | null {
    const account = accountForToken(db, ctx.token);
    if (!account) {
      fail(ctx, "未登录", 401);
      return null;
    }
    return account;
  }

  /** Everything credited to an account so far. This total is the client's starting point. */
  function earnedBy(accountId: number): number {
    const row = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM stamina_credits WHERE account_id = ?").get(
      accountId,
    ) as { total: number };
    return row.total;
  }

  return {
    /** The plan, plus the authoritative earned total the client rebuilds its balance from. */
    get(ctx: Ctx): void {
      const caller = requireCaller(ctx);
      if (!caller) {
        return;
      }
      const target = targetFor(ctx, caller);
      if (target === null) {
        return fail(ctx, "无权访问这个账号的作业数据", 403);
      }
      const row = db.prepare("SELECT data, updated_at FROM homework WHERE account_id = ?").get(target) as
        | { data: string; updated_at: string }
        | undefined;
      // Nothing stored yet is a normal state, not an error: this account has simply never synced.
      json(ctx, { data: row?.data ?? null, updatedAt: row?.updated_at ?? null, earned: earnedBy(target) });
    },

    /**
     * Stores the plan as the client sent it.
     *
     * Kept verbatim rather than parsed into columns. The rules live in the game and will keep
     * changing; a server that understood their shape would have to be redeployed in step with every
     * tuning change, and a mismatch would be a lost plan.
     */
    update(ctx: Ctx): void {
      const caller = requireCaller(ctx);
      if (!caller) {
        return;
      }
      const target = targetFor(ctx, caller);
      if (target === null) {
        return fail(ctx, "无权修改这个账号的作业数据", 403);
      }
      if (!ctx.raw) {
        return fail(ctx, "内容为空");
      }
      db.prepare(
        `INSERT INTO homework (account_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (account_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      ).run(target, ctx.raw, now());
      text(ctx, "");
    },

    /**
     * Awards stamina. Refused unless the caller is the parent of the account being credited.
     *
     * The amount is taken from the request rather than recomputed here, and that is deliberate: the
     * thing being defended against is a child minting stamina, not a parent choosing to be generous
     * - a parent can already grant stamina outright from the settings. Recomputing the star curve on
     * the server would only mean the tuning table had to be kept in two places and redeployed
     * together, for no gain against the one attacker who matters.
     */
    credit(ctx: Ctx): void {
      const caller = requireCaller(ctx);
      if (!caller) {
        return;
      }
      if (caller.role !== "parent") {
        return fail(ctx, "只有家长能发放体力", 403);
      }
      const payload = body<{ account?: number; amount?: number; reason?: string }>(ctx);
      const child = db
        .prepare("SELECT id FROM accounts WHERE id = ? AND parent_id = ? AND role = 'child'")
        .get(Number(payload?.account), caller.id) as { id: number } | undefined;
      if (!child) {
        return fail(ctx, "找不到这个孩子账号", 404);
      }
      const amount = Math.round(Number(payload?.amount ?? 0));
      if (!Number.isFinite(amount) || amount <= 0) {
        return fail(ctx, "发放数量不对");
      }
      db.prepare("INSERT INTO stamina_credits (account_id, amount, reason, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)").run(
        child.id,
        amount,
        payload?.reason ?? "grade",
        caller.id,
        now(),
      );
      json(ctx, { earned: earnedBy(child.id) });
    },

    /** The credit history, so a parent can see where a balance came from. */
    credits(ctx: Ctx): void {
      const caller = requireCaller(ctx);
      if (!caller) {
        return;
      }
      const target = targetFor(ctx, caller);
      if (target === null) {
        return fail(ctx, "无权查看", 403);
      }
      const rows = db
        .prepare(
          `SELECT amount, reason, granted_at AS grantedAt FROM stamina_credits
           WHERE account_id = ? ORDER BY id DESC LIMIT 100`,
        )
        .all(target);
      json(ctx, { earned: earnedBy(target), credits: rows });
    },
  };
}
