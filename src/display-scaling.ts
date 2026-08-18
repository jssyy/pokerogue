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
  const scale = largestCleanScale(Math.floor(Math.min(widthScale, heightScale)));

  if (scale < MIN_SNAP_SCALE) {
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
export function initPixelPerfectScaling(game: Phaser.Game): void {
  const apply = () => requestAnimationFrame(() => snapToPixelGrid(game));

  game.scale.on(Phaser.Scale.Events.RESIZE, apply);
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  setInterval(apply, RECHECK_INTERVAL);
  apply();
}
