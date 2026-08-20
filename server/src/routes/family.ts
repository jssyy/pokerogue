import type { Db } from "../db.ts";
import { now } from "../db.ts";
import type { Account } from "../auth.ts";
import { accountForToken, endAllSessions, hashPassword } from "../auth.ts";
import type { Ctx } from "../http.ts";
import { body, fail, json } from "../http.ts";

const MIN_PASSWORD = 4;

/** Stamina a new child starts with: one run's worth, matching `WELCOME_STAMINA` in the game. */
const WELCOME_STAMINA = 30;

/**
 * The parent's side of the account system: creating a child, and managing one afterwards.
 *
 * Ids are carried in the request body rather than the path so the router can stay an exact-match
 * table. With fourteen routes that is a better trade than a pattern matcher.
 */
export function familyRoutes(db: Db) {
  /** Resolves the caller and insists they are a parent. */
  function requireParent(ctx: Ctx): Account | null {
    const account = accountForToken(db, ctx.token);
    if (!account) {
      fail(ctx, "未登录", 401);
      return null;
    }
    if (account.role !== "parent") {
      fail(ctx, "只有家长账号能做这件事", 403);
      return null;
    }
    return account;
  }

  /**
   * Resolves a child that belongs to this parent.
   *
   * Checking the parentage rather than just the id is what stops one account reaching another's
   * data; with a single family it would rarely matter, but a rule that only holds by luck is not
   * one worth relying on.
   */
  function childOf(parent: Account, childId: unknown): Account | null {
    const row = db
      .prepare(
        `SELECT id, username, role, parent_id, display_name, disabled, last_slot
         FROM accounts WHERE id = ? AND parent_id = ? AND role = 'child'`,
      )
      .get(Number(childId), parent.id) as Account | undefined;
    return row ?? null;
  }

  return {
    /** Everything the parent needs to see at a glance: who exists, and when they last played. */
    list(ctx: Ctx): void {
      const parent = requireParent(ctx);
      if (!parent) {
        return;
      }
      const children = db
        .prepare(
          `SELECT a.id, a.username, a.display_name AS displayName, a.disabled, a.created_at AS createdAt,
                  a.last_seen AS lastSeen,
                  (SELECT updated_at FROM saves s WHERE s.account_id = a.id AND s.kind = 'system') AS lastSave,
                  (SELECT updated_at FROM homework h WHERE h.account_id = a.id) AS lastHomework
           FROM accounts a WHERE a.parent_id = ? ORDER BY a.id`,
        )
        .all(parent.id);
      json(ctx, { parent: { username: parent.username }, children });
    },

    /** Creates a child account. Only a parent can; there is no self-registration for children. */
    create(ctx: Ctx): void {
      const parent = requireParent(ctx);
      if (!parent) {
        return;
      }
      const payload = body<{ username?: string; password?: string; displayName?: string }>(ctx);
      const username = payload?.username?.trim();
      const password = payload?.password ?? "";
      if (!username || password.length < MIN_PASSWORD) {
        return fail(ctx, `用户名不能为空，密码至少 ${MIN_PASSWORD} 位`);
      }
      const taken = db.prepare("SELECT 1 FROM accounts WHERE username = ?").get(username);
      if (taken) {
        return fail(ctx, "这个用户名已经有人用了");
      }
      const result = db
        .prepare(
          `INSERT INTO accounts (username, password_hash, role, parent_id, display_name, created_at)
           VALUES (?, ?, 'child', ?, ?, ?)`,
        )
        .run(username, hashPassword(password), parent.id, payload?.displayName?.trim() || username, now());
      // The welcome balance is credited here rather than granted by the child's own client, so that
      // every credit on the account came from something a parent did. One run's worth, because a
      // fresh account with nothing is a locked door.
      db.prepare(
        "INSERT INTO stamina_credits (account_id, amount, reason, granted_by, granted_at) VALUES (?, ?, 'welcome', ?, ?)",
      ).run(Number(result.lastInsertRowid), WELCOME_STAMINA, parent.id, now());
      json(ctx, { id: Number(result.lastInsertRowid), username });
    },

    /**
     * Resets a child's password.
     *
     * Every session that child has open is ended: a password a parent had to reset is usually one
     * that someone else learned, and leaving the already-signed-in devices alone would defeat it.
     */
    setPassword(ctx: Ctx): void {
      const parent = requireParent(ctx);
      if (!parent) {
        return;
      }
      const payload = body<{ id?: number; password?: string }>(ctx);
      const child = childOf(parent, payload?.id);
      if (!child) {
        return fail(ctx, "找不到这个孩子账号", 404);
      }
      if ((payload?.password?.length ?? 0) < MIN_PASSWORD) {
        return fail(ctx, `密码至少 ${MIN_PASSWORD} 位`);
      }
      db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(hashPassword(payload!.password!), child.id);
      endAllSessions(db, child.id);
      json(ctx, { success: true });
    },

    /**
     * Changes the name shown next to a child.
     *
     * Only the display name; the sign-in name stays put because it is what the child types and what
     * every row of their data is keyed to. A nickname is the part meant to be changed freely.
     */
    rename(ctx: Ctx): void {
      const parent = requireParent(ctx);
      if (!parent) {
        return;
      }
      const payload = body<{ id?: number; displayName?: string }>(ctx);
      const child = childOf(parent, payload?.id);
      if (!child) {
        return fail(ctx, "找不到这个孩子账号", 404);
      }
      const name = payload?.displayName?.trim();
      if (!name) {
        return fail(ctx, "昵称不能为空");
      }
      db.prepare("UPDATE accounts SET display_name = ? WHERE id = ?").run(name, child.id);
      json(ctx, { success: true, displayName: name });
    },

    /**
     * Removes a child account and everything belonging to it.
     *
     * The username has to be typed back before this runs. Everywhere else this service errs towards
     * keeping progress - suspending rather than deleting - so the one action that really destroys it
     * should cost more than a mis-click. Sessions, saves, homework and stamina credits all go with
     * the row, through the foreign keys.
     */
    remove(ctx: Ctx): void {
      const parent = requireParent(ctx);
      if (!parent) {
        return;
      }
      const payload = body<{ id?: number; confirm?: string }>(ctx);
      const child = childOf(parent, payload?.id);
      if (!child) {
        return fail(ctx, "找不到这个孩子账号", 404);
      }
      if (payload?.confirm !== child.username) {
        return fail(ctx, `要删除请把登录名原样打一遍：${child.username}`);
      }
      endAllSessions(db, child.id);
      db.prepare("DELETE FROM accounts WHERE id = ?").run(child.id);
      json(ctx, { success: true });
    },

    /**
     * Suspends or restores a child account.
     *
     * Deliberately not a delete: nothing here removes a child's progress, because the point of the
     * whole service is that progress does not disappear. A suspended account cannot sign in and its
     * open sessions are ended, and turning it back on returns everything untouched.
     */
    setDisabled(ctx: Ctx): void {
      const parent = requireParent(ctx);
      if (!parent) {
        return;
      }
      const payload = body<{ id?: number; disabled?: boolean }>(ctx);
      const child = childOf(parent, payload?.id);
      if (!child) {
        return fail(ctx, "找不到这个孩子账号", 404);
      }
      const disabled = payload?.disabled ? 1 : 0;
      db.prepare("UPDATE accounts SET disabled = ? WHERE id = ?").run(disabled, child.id);
      if (disabled) {
        endAllSessions(db, child.id);
      }
      json(ctx, { success: true, disabled: Boolean(disabled) });
    },
  };
}
