import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";
import { tryPayWaveToll } from "#system/homework-gate";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  start() {
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    // Charges the homework stamina toll every so many waves. When the child has run out, the run is
    // saved and closed instead of continuing, so the phase must not create the next battle.
    if (!tryPayWaveToll()) {
      return;
    }

    globalScene.newBattle();

    this.end();
  }
}
