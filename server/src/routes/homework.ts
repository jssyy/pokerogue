import type { Db } from "../db.ts";
import { now } from "../db.ts";
import type { Account } from "../auth.ts";
import { accountForToken } from "../auth.ts";
import type { Ctx } from "../http.ts";
import { fail, json, text } from "../http.ts";

/**
 * Syncing for the homework plan itself: stamina, tasks, the ledger, the parent PIN.
 *
 * Syncing only the game save would still lose the part that matters most here. A child who moves to
 * another device would arrive with their Pokemon intact and no stamina and no plan - which is the
 * half of the state their effort actually went into.
 */
export function homeworkRoutes(db: Db) {
  /**
   * Whose plan a request is allowed to touch.
   *
   * A child reaches only their own. A parent may name one of their children, which is what will let
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

  return {
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
      // Nothing stored yet is a normal state, not an error: it means this account has never synced.
      json(ctx, { data: row?.data ?? null, updatedAt: row?.updated_at ?? null });
    },

    /**
     * Stores the plan as the client sent it.
     *
     * The body is kept verbatim rather than parsed into columns. The rules live in the game and will
     * keep changing; a server that understood their shape would have to be redeployed in step with
     * every tuning change, and a mismatch would be a lost plan.
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
  };
}
