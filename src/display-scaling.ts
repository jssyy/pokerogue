/**
 * The pixel grid the game is authored on. The canvas backing store is six times this, and every
 * sprite and font is drawn to align with it.
 */
const ART_WIDTH = 320;
const ART_HEIGHT = 180;

/**
 * Below this many screen pixels per art pixel, a sharp picture is not worth how small it makes the
 * game; the browser's own fitting is left alone instead.
 */
const MIN_SNAP_SCALE = 2;

/**
 * How much of the fitted size snapping is allowed to give up.
 *
 * Only whole multiples of six divide the canvas evenly, so the usable scales are 1, 2, 3 and 6 -
 * a gap that costs nothing at 6.5 (which rounds to 6) but a third of the picture at 4.75, where the
 * next clean scale down is 3.
 *
 * Losing that much is not just ugly. Phaser sizes the canvas by fitting its parent, and everything
 * derived from that size - including the DOM input boxes the sign-in and PIN forms are built from -
 * is positioned against the fitted figure, not the one written onto the canvas here. Shrink the
 * canvas far enough underneath it and those boxes end up somewhere the player is not clicking.
 * The figure is set just under the common desktop case: 1920 at 125% leaves 7.5 device pixels per
 * art pixel, which snaps to 6 for a ratio of 0.8 - the arrangement that makes the art exactly sharp.
 * A small window at 4.75 falls to 3, a ratio of 0.63, and is left to the browser instead.
 */
const MIN_SNAP_EFFICIENCY = 0.75;

/** Canvas pixels the game draws per art pixel: the 1920x1080 canvas over the 320x180 grid. */
const CANVAS_SCALE = 6;

/**
 * Sizes the canvas so that one art pixel covers a whole number of physical screen pixels.
 *
 * @remarks
 * Phaser's `FIT` mode stretches the 1920x1080 canvas to whatever the window happens to be, so an
 * art pixel can end up spanning 4.06 screen pixels; the browser resolves that fraction by blending
 * neighbours, which is what makes pixel-art text and Pokemon look smeared. Rounding down to a whole
 * multiple costs a border but keeps every pixel exact. The rounding is done in *device* pixels, not
 * CSS pixels, because a display running at 125% would otherwise reintroduce the same fraction.
 */
/**
 * The largest scale up to {@linkcode limit} that resamples the canvas evenly.
 *
 * @remarks
 * Whole screen pixels per art pixel is not enough on its own. The canvas is drawn at six canvas
 * pixels per art pixel, so showing it at, say, four screen pixels means a 3:2 resample - fine for
 * anything sitting on the art grid, but the battle info box places icons at half-pixel offsets and
 * at half scale, and those lose a row. Keeping the canvas-to-screen ratio a whole number in either
 * direction resamples every element the same way, off-grid ones included.
 */
function largestCleanScale(limit: number): number {
  for (let scale = limit; scale >= 1; scale--) {
    if (CANVAS_SCALE % scale === 0 || scale % CANVAS_SCALE === 0) {
      return scale;
    }
  }
  return 1;
}

/**
 * Whether snapping is paused.
 *
 * The forms - signing in, the parent PIN, naming a task - are DOM inputs laid over the canvas, and
 * the plugin that places them sizes them from what Phaser thinks the canvas is, not from the size
 * written onto it here. Shrinking the canvas underneath leaves those boxes wider than the ones drawn
 * for them, so the caret sits away from the text and a click near the edge misses. While one is open
 * the canvas is handed back to Phaser, which costs a little sharpness for as long as the form is up
 * and nothing at all the rest of the time.
 */
let suspended = false;

function snapToPixelGrid(game: Phaser.Game): void {
  const canvas = game.canvas;
  const parent = canvas?.parentElement;
  if (canvas == null || parent == null) {
    return;
  }

  const available = parent.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const widthScale = (available.width * pixelRatio) / ART_WIDTH;
  const heightScale = (available.height * pixelRatio) / ART_HEIGHT;
  const fitScale = Math.min(widthScale, heightScale);
  const scale = largestCleanScale(Math.floor(fitScale));

  if (suspended || scale < MIN_SNAP_SCALE || scale / fitScale < MIN_SNAP_EFFICIENCY) {
    // Hand the canvas back to Phaser's own fitting, undoing any size set on a previous pass.
    if (canvas.style.width || canvas.style.height) {
      canvas.style.width = "";
      canvas.style.height = "";
      game.scale.refresh();
    }
    return;
  }

  const width = `${(ART_WIDTH * scale) / pixelRatio}px`;
  const height = `${(ART_HEIGHT * scale) / pixelRatio}px`;
  if (canvas.style.width === width && canvas.style.height === height) {
    return;
  }

  canvas.style.width = width;
  canvas.style.height = height;

  // The scale manager caches the canvas bounds to translate pointer coordinates; resizing the
  // canvas without telling it would leave every click landing in the wrong place.
  game.scale.updateBounds();
}

/** How often the canvas size is re-checked, in milliseconds. */
const RECHECK_INTERVAL = 1000;

/**
 * Keeps the canvas on the pixel grid.
 *
 * @remarks
 * Resize events alone are not enough: Phaser sizes the canvas during its own boot sequence, after
 * this runs and without emitting a resize, so a page that is never resized would keep Phaser's
 * fractional fit. A cheap periodic re-check covers that; it only touches the DOM when the size is
 * actually wrong.
 */
let activeGame: Phaser.Game | null = null;

/** Hands the canvas back to Phaser while a form with DOM inputs is on screen. */
export function suspendPixelSnap(): void {
  suspended = true;
  if (activeGame) {
    snapToPixelGrid(activeGame);
  }
}

/** Resumes snapping once the form is gone. */
export function resumePixelSnap(): void {
  suspended = false;
  if (activeGame) {
    snapToPixelGrid(activeGame);
  }
}

export function initPixelPerfectScaling(game: Phaser.Game): void {
  activeGame = game;
  const apply = () => requestAnimationFrame(() => snapToPixelGrid(game));

  game.scale.on(Phaser.Scale.Events.RESIZE, apply);
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  setInterval(apply, RECHECK_INTERVAL);
  apply();
}
