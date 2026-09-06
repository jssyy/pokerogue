import type { Db } from "../db.ts";
import { now } from "../db.ts";
import type { Account } from "../auth.ts";
import { accountForToken, createSession, endSession, hashPassword, verifyPassword } from "../auth.ts";
import type { Ctx } from "../http.ts";
import { fail, form, json, text } from "../http.ts";

/** The smallest password worth calling one, applied to parents and children alike. */
const MIN_PASSWORD = 4;

/**
 * The shape the game client expects from `/account/info`.
 *
 * The two third-party id fields and the admin flag exist upstream for Discord and Google linking,
 * which this service has no notion of; they are answered as empty so the client's own checks pass.
 */
function userInfo(account: Account) {
  return {
    username: account.username,
    lastSessionSlot: account.last_slot,
    discordId: "",
    googleId: "",
    hasAdminRole: account.role === "parent",
  };
}

export function accountRoutes(db: Db) {
  return {
    /**
     * Signs in and hands back a token.
     *
     * Posted as form fields rather than JSON because that is what the game client sends.
     */
    login(ctx: Ctx): void {
      const { username, password } = form(ctx);
      if (!username || !password) {
        return fail(ctx, "请填写用户名和密码");
      }
      const row = db
        .prepare("SELECT id, username, password_hash, role, disabled FROM accounts WHERE username = ?")
        .get(username) as { id: number; password_hash: string; disabled: number } | undefined;

      // The same message whether the name is unknown or the password is wrong, so the response
      // cannot be used to find out which accounts exist.
      if (!row || !verifyPassword(password, row.password_hash)) {
        return fail(ctx, "用户名或密码不对", 401);
      }
      if (row.disabled) {
        return fail(ctx, "这个账号已被家长停用", 403);
      }

      db.prepare("UPDATE accounts SET last_seen = ? WHERE id = ?").run(now(), row.id);
      json(ctx, { token: createSession(db, row.id) });
    },

    /**
     * Creates the parent account, once.
     *
     * This service is for one family, so there is no open registration: the first person to register
     * becomes the parent, and after that the endpoint is closed and children are created from the
     * parent's own account. It means the machine can be set up without a console, while leaving
     * nothing for a stranger who finds the port to sign up to.
     */
    register(ctx: Ctx): void {
      const existing = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
      if (existing.n > 0) {
        return fail(ctx, "本服务只服务一个家庭，孩子账号请由家长在「家长模式」里创建", 403);
      }
      const { username, password } = form(ctx);
      if (!username || (password?.length ?? 0) < MIN_PASSWORD) {
        return fail(ctx, `用户名不能为空，密码至少 ${MIN_PASSWORD} 位`);
      }
      db.prepare(
        `INSERT INTO accounts (username, password_hash, role, parent_id, display_name, created_at)
         VALUES (?, ?, 'parent', NULL, ?, ?)`,
      ).run(username, hashPassword(password), username, now());
      text(ctx, "");
    },

    info(ctx: Ctx): void {
      const account = accountForToken(db, ctx.token);
      if (!account) {
        return fail(ctx, "未登录", 401);
      }
      json(ctx, userInfo(account));
    },

    logout(ctx: Ctx): void {
      endSession(db, ctx.token);
      text(ctx, "");
    },

    /** Changes your own password. A parent resetting a child's goes through the family routes. */
    changePassword(ctx: Ctx): void {
      const account = accountForToken(db, ctx.token);
      if (!account) {
        return fail(ctx, "未登录", 401);
      }
      const { password } = form(ctx);
      if ((password?.length ?? 0) < MIN_PASSWORD) {
        return fail(ctx, `密码至少 ${MIN_PASSWORD} 位`);
      }
      db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(hashPassword(password), account.id);
      json(ctx, { success: true });
    },
  };
}
