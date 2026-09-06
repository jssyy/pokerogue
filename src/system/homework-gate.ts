import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import { COST_NEW_RUN, COST_RESUME_RUN, COST_WAVE_TOLL, WAVE_TOLL_INTERVAL } from "#system/homework-config";
import { homeworkManager } from "#system/homework-manager";
import i18next from "i18next";

/** The two ways a child can start playing, each with its own stamina price. */
export type PlayAction = "newRun" | "resumeRun";

const PLAY_COSTS: Readonly<Record<PlayAction, number>> = {
  newRun: COST_NEW_RUN,
  resumeRun: COST_RESUME_RUN,
};

/** Stamina price of a play action, or `0` while the gate is off. */
export function getPlayCost(action: PlayAction): number {
  return homeworkManager.get().isGateActive() ? PLAY_COSTS[action] : 0;
}

/**
 * Whether the homework planner stands in for the title screen.
 *
 * @remarks
 * Tied to the stamina gate on purpose: while playing costs homework stamina, the plan is what the
 * child should land on after the intro. A parent who switches the gate off is saying "never mind the
 * homework for now", so the normal title screen comes back and the planner moves to a menu entry.
 * The test harness switches the gate off, which is also what keeps the upstream title-screen tests
 * behaving exactly as before.
 */
export function isHomeworkHomeScreen(): boolean {
  return homeworkManager.get().gateEnabled;
}

/**
 * Puts a message in front of the player, preferring the planner's own footer.
 *
 * @remarks
 * `ui.showText` falls back to the battle message box when the active handler cannot show text, and
 * that box is not on screen while the planner is up - the child would get an error sound and no
 * explanation. The planner is looked up structurally rather than by import to keep this module free
 * of a cycle with the handler.
 */
function announce(message: string): void {
  const { ui } = globalScene;
  const planner = ui.handlers[UiMode.HOMEWORK] as { showText?: (text: string, delay?: number) => void } | undefined;
  const plannerVisible = ui.mode === UiMode.HOMEWORK || ui.modeChain.includes(UiMode.HOMEWORK);

  if (plannerVisible && typeof planner?.showText === "function") {
    planner.showText(message, 0);
    return;
  }
  ui.showText(message);
}

/** Whether the child currently has enough stamina for a play action. */
export function canAffordPlay(action: PlayAction): boolean {
  return homeworkManager.get().missingStamina(PLAY_COSTS[action]) === 0;
}

/** Tells the child how much stamina they are short for a play action. */
export function showPlayBlockedMessage(action: PlayAction): void {
  const data = homeworkManager.get();
  const cost = PLAY_COSTS[action];
  announce(
    i18next.t(action === "newRun" ? "homework:gate.blockedNewRun" : "homework:gate.blockedResumeRun", {
      cost,
      missing: data.missingStamina(cost),
    }),
  );
}

/**
 * Charges stamina for starting or resuming a run.
 *
 * Shows the child why they were turned away when they cannot afford it, so callers only have to
 * respect the return value.
 *
 * @returns Whether play may proceed.
 */
export function tryPayToPlay(action: PlayAction): boolean {
  const data = homeworkManager.get();
  const cost = PLAY_COSTS[action];

  if (!data.isGateActive()) {
    return true;
  }

  if (data.missingStamina(cost) > 0) {
    showPlayBlockedMessage(action);
    return false;
  }

  data.spend(cost, action === "newRun" ? "newRun" : "resumeRun");
  homeworkManager.save();

  announce(
    i18next.t(action === "newRun" ? "homework:gate.paidNewRun" : "homework:gate.paidResumeRun", {
      cost,
      remaining: data.stamina,
    }),
  );
  return true;
}

/**
 * Charges the running toll when the next wave crosses a {@linkcode WAVE_TOLL_INTERVAL} boundary.
 *
 * When the child has run dry the run is saved and closed instead of being abandoned mid-battle, so
 * an empty balance never costs them their party.
 *
 * @returns Whether the next wave may be created.
 */
export function tryPayWaveToll(): boolean {
  const data = homeworkManager.get();
  const nextWave = (globalScene.currentBattle?.waveIndex ?? 0) + 1;

  // The entry fee covers the first interval, so tolls start at wave 11, 21, ...
  const tollDue = nextWave > 1 && (nextWave - 1) % WAVE_TOLL_INTERVAL === 0;
  if (!data.isGateActive() || !tollDue) {
    return true;
  }

  if (!data.spend(COST_WAVE_TOLL, "waveToll")) {
    saveAndQuitOutOfStamina();
    return false;
  }

  homeworkManager.save();
  globalScene.phaseManager.queueMessage(
    i18next.t("homework:gate.paidWaveToll", {
      waves: WAVE_TOLL_INTERVAL,
      cost: COST_WAVE_TOLL,
      remaining: data.stamina,
    }),
    null,
    true,
  );
  return true;
}

/**
 * Saves the run and returns to the title screen because the child is out of stamina.
 *
 * @remarks
 * Uses the same cached save path as "save and quit" from the in-game menu, which rewinds to the
 * start of the current wave - one wave replayed is a far better outcome than a run the child cannot
 * get back into.
 */
function saveAndQuitOutOfStamina(): void {
  globalScene.ui.showText(
    i18next.t("homework:gate.exhausted"),
    null,
    () => {
      globalScene.ui.setMode(UiMode.LOADING, {
        buttonActions: [],
        fadeOut: () =>
          globalScene.gameData.saveAll(true, true, true, true).then(() => {
            globalScene.reset(true);
          }),
      });
    },
    null,
    true,
  );
}
