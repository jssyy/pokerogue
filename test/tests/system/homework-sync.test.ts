import { HomeworkSubject } from "#enums/homework-subject";
import type { RemoteHomework } from "#system/family-session";
import { HomeworkData } from "#system/homework-data";
import { todayKey } from "#system/homework-date";
import type { homeworkManager as HomeworkManager } from "#system/homework-manager";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the seam between the planner and the family service.
 *
 * This is where a parent's grading turns into a number the child sees, and every bug that lives here
 * looks the same from the outside: the adult did the thing, and the child's screen says it never
 * happened. The cases below are the ways that went wrong.
 * @module
 */

let signedIn = true;
let parentAccount = false;
let remote: RemoteHomework | null = null;
/** Everything the manager has sent up, in order, as `[payload, accountId]`. */
let pushes: [string, number | undefined][] = [];

vi.mock("#app/account", () => ({
  get loggedInUser() {
    return signedIn ? { username: "syf", hasAdminRole: parentAccount } : null;
  },
}));

vi.mock("#system/family-session", () => ({
  isSignedIn: () => signedIn,
  isParentAccount: () => signedIn && parentAccount,
  fetchHomework: async () => remote,
  pushHomework: async (payload: string, accountId?: number) => {
    pushes.push([payload, accountId]);
    return true;
  },
}));

/** A stored plan as the service would hold it. */
function planWith(earned: number, title: string): string {
  const data = new HomeworkData();
  data.addTask({ date: todayKey(), title, subject: HomeworkSubject.OTHER });
  data.earn(earned, "grade");
  return JSON.stringify(data.toSaveData());
}

/** Whether anything is stored under a slot. The test stub cannot be enumerated, so slots are named. */
function slotHasPlan(key: string): boolean {
  return Boolean(localStorage.getItem(key));
}

/**
 * The manager under test.
 *
 * Loaded fresh for every case. It is a singleton holding the plan, the sync state and a pending
 * push, and the suite runs with `isolate: false`, so one case's leftovers would decide the next
 * one's result.
 */
let homeworkManager: typeof HomeworkManager;

beforeEach(async () => {
  // The suite runs with `isolate: false` and the push is on a real 1.5 second timer, so a pending
  // push from the previous case would otherwise land in the middle of this one. Draining it clears
  // the timer; where it goes does not matter, because the recorder is reset just below.
  await homeworkManager?.flushPush();

  localStorage.clear();
  signedIn = true;
  parentAccount = false;
  remote = null;
  pushes = [];
  vi.useRealTimers();
  vi.resetModules();
  ({ homeworkManager } = await import("#system/homework-manager"));
});

describe("homework sync", () => {
  it("gives a child the stamina the service says they earned", async () => {
    remote = { data: planWith(0, "读课文"), earned: 55 };

    expect(homeworkManager.get().stamina).toBe(0);
    await expect(homeworkManager.sync()).resolves.toBe(true);

    expect(homeworkManager.get().totalEarned).toBe(55);
    expect(homeworkManager.get().stamina).toBe(55);
  });

  it("subtracts what this device already spent from the service's total", async () => {
    remote = { data: null, earned: 100 };
    await homeworkManager.sync();
    homeworkManager.mutate(data => data.spend(30, "run"));

    remote = { data: null, earned: 120 };
    await homeworkManager.sync();

    expect(homeworkManager.get().stamina).toBe(90);
  });

  it("does not overwrite the stored plan with an empty one before it has been read", async () => {
    // Signing in on a new device: nothing local, and the real plan is on the service. A push here
    // would replace it with nothing.
    homeworkManager.get();
    homeworkManager.save();
    await vi.waitFor(() => expect(pushes).toHaveLength(0));
  });

  it("sends the plan up once it has been reconciled", async () => {
    remote = { data: planWith(0, "读课文"), earned: 10 };
    await homeworkManager.sync();

    homeworkManager.mutate(data => data.addTask({ date: todayKey(), title: "口算", subject: HomeworkSubject.MATH }));

    await vi.waitFor(() => expect(pushes.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(pushes.at(-1)?.[0]).toContain("口算");
  });

  it("sends the plan as it stands when the push fires, not as it stood when it was scheduled", async () => {
    remote = { data: planWith(0, "读课文"), earned: 10 };
    await homeworkManager.sync();

    homeworkManager.mutate(data => data.addTask({ date: todayKey(), title: "第一项", subject: HomeworkSubject.OTHER }));
    homeworkManager.mutate(data => data.addTask({ date: todayKey(), title: "第二项", subject: HomeworkSubject.OTHER }));

    await vi.waitFor(() => expect(pushes.length).toBeGreaterThan(0), { timeout: 4000 });
    // Both edits landed inside one debounce window; neither may be dropped.
    expect(pushes.at(-1)?.[0]).toContain("第一项");
    expect(pushes.at(-1)?.[0]).toContain("第二项");
  });

  it("shows a parent the child's plan, not their own", async () => {
    parentAccount = true;
    // The parent's own plan, left in this browser from an earlier visit.
    homeworkManager.mutate(data =>
      data.addTask({ date: todayKey(), title: "家长自己的", subject: HomeworkSubject.OTHER }),
    );

    remote = { data: planWith(0, "孩子的作业"), earned: 40 };
    await expect(homeworkManager.viewChild(7)).resolves.toBe(true);

    const titles = homeworkManager.get().tasks.map(task => task.title);
    expect(titles).toContain("孩子的作业");
    expect(titles).not.toContain("家长自己的");
    expect(homeworkManager.get().stamina).toBe(40);
  });

  it("keeps a child's plan in its own slot so it never lands in the parent's", async () => {
    parentAccount = true;
    homeworkManager.mutate(data =>
      data.addTask({ date: todayKey(), title: "家长自己的", subject: HomeworkSubject.OTHER }),
    );

    remote = { data: planWith(0, "孩子的作业"), earned: 40 };
    await homeworkManager.viewChild(7);
    homeworkManager.mutate(data =>
      data.addTask({ date: todayKey(), title: "新布置的", subject: HomeworkSubject.OTHER }),
    );

    // Two plans, two slots. One slot would mean the parent's plan and the child's overwrote each
    // other every time the parent switched.
    expect(slotHasPlan("homeworkQuest_syf")).toBe(true);
    expect(slotHasPlan("homeworkQuest_syf_child7")).toBe(true);
    expect(localStorage.getItem("homeworkQuest_syf")).not.toBe(localStorage.getItem("homeworkQuest_syf_child7"));

    // And going back to their own plan still finds it untouched.
    remote = null;
    await homeworkManager.viewChild(null);
    expect(homeworkManager.get().tasks.map(task => task.title)).toEqual(["家长自己的"]);
  });

  it("addresses the parent's push to the child being viewed", async () => {
    parentAccount = true;
    remote = { data: planWith(0, "孩子的作业"), earned: 40 };
    await homeworkManager.viewChild(7);

    homeworkManager.mutate(data =>
      data.addTask({ date: todayKey(), title: "新布置的", subject: HomeworkSubject.OTHER }),
    );

    await vi.waitFor(() => expect(pushes.length).toBeGreaterThan(0), { timeout: 4000 });
    // Every push while a child is being viewed must be addressed to that child, never to the parent.
    expect(pushes.map(([, account]) => account)).toEqual(pushes.map(() => 7));
  });

  it("carries on with the local plan when the service cannot be reached", async () => {
    remote = null;
    homeworkManager.mutate(data =>
      data.addTask({ date: todayKey(), title: "离线也要做", subject: HomeworkSubject.OTHER }),
    );

    await expect(homeworkManager.sync()).resolves.toBe(false);
    expect(homeworkManager.get().tasks.map(task => task.title)).toContain("离线也要做");
  });
});
