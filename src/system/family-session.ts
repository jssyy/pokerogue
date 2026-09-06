import { loggedInUser } from "#app/account";
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { bypassLogin } from "#constants/app-constants";
import { getCookie } from "#utils/cookies";

/**
 * Who is signed in, and what they are allowed to do with the homework plan.
 *
 * @remarks
 * Before accounts existed, a parent proved themselves with a PIN on the child's own device. With
 * accounts the sign-in *is* the proof, so the parent tools appear for a parent and are not built at
 * all for a child - a menu entry that is never rendered cannot be guessed at, where a PIN prompt can
 * be watched over a shoulder.
 *
 * The PIN does not go away. The game has to keep working with no server reachable, and in that mode
 * there is no account to ask, so the PIN stays as the fallback. See {@linkcode isParentSession}.
 */

/** Where the family service lives. The same value the game's own API client uses. */
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:8001";

/**
 * Whether the game is running against the family service at all.
 *
 * `bypassLogin` is the build flag for playing with no server; in that mode `loggedInUser` is a local
 * stand-in rather than a real account, so nothing here should trust it.
 */
export function isSignedIn(): boolean {
  return !bypassLogin && loggedInUser != null;
}

/**
 * Whether the signed-in account may grade.
 *
 * The family service reports a parent through `hasAdminRole`; it is the only account flag the client
 * already carries, and reusing it avoids widening an upstream type just to hold one boolean. A child
 * account, and the offline stand-in account, both report `false`.
 */
export function isParentAccount(): boolean {
  return isSignedIn() && loggedInUser?.hasAdminRole === true;
}

/**
 * Whether the current session may use the parent tools.
 *
 * @param pinUnlocked - Whether the PIN has been entered in this visit to the planner
 * @returns `true` when signed in as a parent, or - with no account - when the PIN was given
 */
export function isParentSession(pinUnlocked: boolean): boolean {
  return isSignedIn() ? isParentAccount() : pinUnlocked;
}

/** Whether the PIN prompt is still the way in. With an account, the sign-in already settled it. */
export function usesPinForParentMode(): boolean {
  return !isSignedIn();
}

/** The display name for the current account, or `null` when playing without one. */
export function currentAccountName(): string | null {
  return isSignedIn() ? (loggedInUser?.username ?? null) : null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: { Authorization: getCookie(SESSION_ID_COOKIE_NAME), ...init.headers },
    });
  } catch (err) {
    // Unreachable is an ordinary state here, not a failure: the point of keeping the balance on the
    // client is that a child can keep playing while the machine at home is off.
    console.debug("family service unreachable", path, err);
    return null;
  }
}

export interface RemoteHomework {
  /** The plan as last synced, or `null` if this account has never synced. */
  data: string | null;
  /** Stamina the service has credited. The client's balance is this minus what it has spent. */
  earned: number;
}

/** Reads the plan and the authoritative earned total. `null` when the service cannot be reached. */
export async function fetchHomework(accountId?: number): Promise<RemoteHomework | null> {
  const query = accountId == null ? "" : `?account=${accountId}`;
  const response = await request(`/homework/get${query}`);
  if (!response?.ok) {
    return null;
  }
  try {
    return (await response.json()) as RemoteHomework;
  } catch {
    return null;
  }
}

/** Stores the plan. Returns whether it reached the service. */
export async function pushHomework(payload: string, accountId?: number): Promise<boolean> {
  const query = accountId == null ? "" : `?account=${accountId}`;
  const response = await request(`/homework/update${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  return response?.ok === true;
}

/**
 * Awards stamina to a child.
 *
 * Refused by the service unless the caller is that child's parent, which is what makes a grade
 * something a child cannot write for themselves - hiding the menu raises the bar, this closes it.
 *
 * @returns The new authoritative earned total, or `null` if the award did not go through
 */
export async function creditStamina(accountId: number, amount: number, reason: string): Promise<number | null> {
  const response = await request("/homework/credit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: accountId, amount, reason }),
  });
  if (!response?.ok) {
    return null;
  }
  try {
    return ((await response.json()) as { earned: number }).earned;
  } catch {
    return null;
  }
}

export interface FamilyChild {
  id: number;
  username: string;
  displayName: string;
  disabled: number;
  lastSeen: string | null;
  lastSave: string | null;
  lastHomework: string | null;
}

/** The children on this parent's account. `null` when unreachable or when not a parent. */
export async function listChildren(): Promise<FamilyChild[] | null> {
  const response = await request("/family/children");
  if (!response?.ok) {
    return null;
  }
  try {
    return ((await response.json()) as { children: FamilyChild[] }).children;
  } catch {
    return null;
  }
}

/** Creates a child account. Returns an error message, or `null` on success. */
export async function createChild(username: string, password: string, displayName: string): Promise<string | null> {
  const response = await request("/family/child/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, displayName }),
  });
  if (response == null) {
    return "连不上账号服务";
  }
  return response.ok ? null : await response.text();
}
