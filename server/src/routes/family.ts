import type { Db } from "../db.ts";
import { now } from "../db.ts";
import type { Account } from "../auth.ts";
import { accountForToken, endAllSessions, hashPassword } from "../auth.ts";
import type { Ctx } from "../http.ts";
import { body, fail, json } from "../http.ts";

const MIN_PASSWORD = 4;

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
