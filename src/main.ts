import "#app/polyfills"; // All polyfills MUST be loaded first for side effects
import "#init/init-manifest"; // initializes the manifest, must be done *before* i18n is initialized due to being used for caching
import "#app/i18n"; // Initializes i18n on import

import { initPixelPerfectScaling } from "#app/display-scaling";
import { InvertPostFX } from "#app/pipelines/invert";
import { preventDoubleTapZoom } from "#app/touch-controls";
import { isBeta, isDev } from "#constants/app-constants";
import { version } from "#package.json";
import { installBugLog } from "#system/bug-log";
import Phaser from "phaser";
import BBCodeTextPlugin from "phaser3-rex-plugins/plugins/bbcodetext-plugin";
import InputTextPlugin from "phaser3-rex-plugins/plugins/inputtext-plugin";
import TransitionImagePackPlugin from "phaser3-rex-plugins/templates/transitionimagepack/transitionimagepack-plugin";
import UIPlugin from "phaser3-rex-plugins/templates/ui/ui-plugin";

if (isBeta || isDev) {
  document.title += " (Beta)";
}

preventDoubleTapZoom();

async function startGame(): Promise<void> {
  const LoadingScene = (await import("./loading-scene")).LoadingScene;
  const BattleScene = (await import("./battle-scene")).BattleScene;
  // Before anything else, so a failure during boot still leaves a trail.
  installBugLog();

  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: "app",
    scale: {
      width: 1920,
      height: 1080,
      mode: Phaser.Scale.FIT,
    },
    plugins: {
      global: [
        {
          key: "rexInputTextPlugin",
          plugin: InputTextPlugin,
          start: true,
        },
        {
          key: "rexBBCodeTextPlugin",
          plugin: BBCodeTextPlugin,
          start: true,
        },
        {
          key: "rexTransitionImagePackPlugin",
          plugin: TransitionImagePackPlugin,
          start: true,
        },
      ],
      scene: [
        {
          key: "rexUI",
          plugin: UIPlugin,
          mapping: "rexUI",
        },
      ],
    },
    input: {
      mouse: {
        target: "app",
      },
      touch: {
        target: "app",
      },
      gamepad: true,
    },
    dom: {
      createContainer: true,
    },
    // `pixelArt` bundles nearest-neighbour texture sampling with `roundPixels`. Without the latter,
    // sprites land on half pixels and their art pixels come out uneven widths, which reads as a
    // soft, slightly smeared sprite next to the crisp UI text.
    pixelArt: true,
    antialias: false,
    pipeline: [InvertPostFX] as unknown as Phaser.Types.Core.PipelineConfig,
    scene: [LoadingScene, BattleScene],
    version,
  });
  game.sound.pauseOnBlur = false;
  initPixelPerfectScaling(game);
}

try {
  await Promise.all([document.fonts.load("16px emerald"), document.fonts.load("10px pkmnems")]);
} catch (err) {
  console.error("Error loading fonts:", err);
} finally {
  await startGame();
}
