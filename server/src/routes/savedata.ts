import type { Db } from "../db.ts";
import { now, SAVE_HISTORY_DEPTH } from "../db.ts";
import { accountForToken } from "../auth.ts";
import type { Ctx } from "../http.ts";
import { body, fail, json, text } from "../http.ts";

/** The slot a system save is filed under; there is only ever one per account. */
const SYSTEM_SLOT = 0;

type Kind = "system" | "session";

export function savedataRoutes(db: Db) {
  /**
   * Writes a save, keeping the version it replaced.
   *
   * The client uploads its whole save each time, so a write from a device that was behind, or one
   * that arrives corrupted, would otherwise be the end of that progress. Every write pushes the old
   * version onto a short history first, which is what makes "the save is gone" recoverable.
   */
  function put(accountId: number, kind: Kind, slot: number, data: string): void {
    const previous = db
      .prepare("SELECT data FROM saves WHERE account_id = ? AND kind = ? AND slot = ?")
      .get(accountId, kind, slot) as { data: string } | undefined;

    if (previous && previous.data !== data) {
      db.prepare("INSERT INTO save_history (account_id, kind, slot, data, saved_at) VALUES (?, ?, ?, ?, ?)").run(
        accountId,
        kind,
        slot,
        previous.data,
        now(),
      );
      db.prepare(
        `DELETE FROM save_history
         WHERE account_id = ? AND kind = ? AND slot = ?
           AND id NOT IN (
             SELECT id FROM save_history
             WHERE account_id = ? AND kind = ? AND slot = ?
             ORDER BY id DESC LIMIT ?
           )`,
      ).run(accountId, kind, slot, accountId, kind, slot, SAVE_HISTORY_DEPTH);
    }

    db.prepare(
      `INSERT INTO saves (account_id, kind, slot, data, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id, kind, slot) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(accountId, kind, slot, data, now());
  }

  function get(accountId: number, kind: Kind, slot: number): string | null {
    const row = db
      .prepare("SELECT data FROM saves WHERE account_id = ? AND kind = ? AND slot = ?")
      .get(accountId, kind, slot) as { data: string } | undefined;
    return row?.data ?? null;
  }

  /** Resolves the caller, answering 401 itself when there is none. */
  function requireAccount(ctx: Ctx) {
    const account = accountForToken(db, ctx.token);
    if (!account) {
      fail(ctx, "未登录", 401);
      return null;
    }
    return account;
  }

  function slotOf(ctx: Ctx): number {
    return Number(ctx.query.get("slot") ?? 0) || 0;
  }

  return {
    systemGet(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      const data = get(account.id, "system", SYSTEM_SLOT);
      // A brand new account has nothing yet; the client treats an empty body as "start fresh".
      text(ctx, data ?? "");
    },

    /**
     * Answers the client's integrity check.
     *
     * Upstream uses this to detect a save the server considers stale and hand back its own copy.
     * Here the client is always the authority, so this reports valid and returns nothing - the
     * history table, not this endpoint, is the recovery path.
     */
    systemVerify(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      json(ctx, { valid: true });
    },

    systemUpdate(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      if (!ctx.raw) {
        return fail(ctx, "存档内容为空");
      }
      put(account.id, "system", SYSTEM_SLOT, ctx.raw);
      text(ctx, "");
    },

    sessionGet(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      text(ctx, get(account.id, "session", slotOf(ctx)) ?? "");
    },

    sessionUpdate(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      if (!ctx.raw) {
        return fail(ctx, "存档内容为空");
      }
      const slot = slotOf(ctx);
      put(account.id, "session", slot, ctx.raw);
      db.prepare("UPDATE accounts SET last_slot = ? WHERE id = ?").run(slot, account.id);
      text(ctx, "");
    },

    /** Removes one run. The history keeps its last versions, so a mis-click is not final. */
    sessionDelete(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      db.prepare("DELETE FROM saves WHERE account_id = ? AND kind = 'session' AND slot = ?").run(
        account.id,
        slotOf(ctx),
      );
      text(ctx, "");
    },

    /** Called when a run ends. Same as delete, but the client wants a JSON acknowledgement. */
    sessionClear(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      db.prepare("DELETE FROM saves WHERE account_id = ? AND kind = 'session' AND slot = ?").run(
        account.id,
        slotOf(ctx),
      );
      json(ctx, { success: true });
    },

    /** Upstream records this for leaderboards. Nothing here needs it, so it is acknowledged only. */
    sessionNewClear(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      json(ctx, true);
    },

    /**
     * Writes both saves in one request.
     *
     * This is what the client uses at the end of a wave, and doing it as one transaction is the
     * point: a half-applied pair - new run progress against old account progress - is exactly the
     * inconsistency that makes a save look corrupted later.
     */
    updateAll(ctx: Ctx): void {
      const account = requireAccount(ctx);
      if (!account) {
        return;
      }
      const payload = body<{ system: unknown; session: unknown; sessionSlotId: number }>(ctx);
      if (!payload?.system) {
        return fail(ctx, "存档内容不完整");
      }
      const slot = Number(payload.sessionSlotId ?? 0) || 0;
      db.exec("BEGIN");
      try {
        put(account.id, "system", SYSTEM_SLOT, JSON.stringify(payload.system));
        if (payload.session) {
          put(account.id, "session", slot, JSON.stringify(payload.session));
          db.prepare("UPDATE accounts SET last_slot = ? WHERE id = ?").run(slot, account.id);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        console.error("updateall failed", err);
        return fail(ctx, "保存失败", 500);
      }
      text(ctx, "");
    },
  };
}
