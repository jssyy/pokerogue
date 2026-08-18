import Phaser from "phaser";

/**
 * How many times wider the rebuilt textures are. Scale3x is fixed at three, and three divides the
 * 6x the UI containers are drawn at, so every source pixel still lands on a whole number of screen
 * pixels - two of them.
 */
const UPSCALE = 3;

/**
 * The UI textures worth rebuilding: hand-drawn shapes whose outlines carry diagonals, and which
 * nothing stretches.
 *
 * Nine-slice textures are deliberately absent. Their borders are measured in source pixels, so
 * tripling the image without restating every border would tear the frames apart - `type_bgs`,
 * `select_cursor*`, `summary_moves_cursor`, `namebox`, `party_exp_bar`, `scroll_bar_handle`,
 * `achv_bar` and the `window_*` set all sit out for that reason.
 *
 * So do the bars. `overlay_hp` is 48x6 and `overlay_exp` 85x2, both pure horizontal banding: Scale3x
 * only ever fills in a staircase, so it would hand back exactly what it was given.
 */
const TEXTURE_KEYS = [
  "cursor",
  "cursor_reverse",
  "cursor_tera",
  "pbinfo_player",
  "pbinfo_player_stats",
  "pbinfo_player_mini",
  "pbinfo_player_mini_stats",
  "pbinfo_enemy_mini",
  "pbinfo_enemy_mini_stats",
  "pbinfo_enemy_boss",
  "pbinfo_enemy_boss_stats",
  "pbinfo_player_type",
  "pbinfo_player_type1",
  "pbinfo_player_type2",
  "pbinfo_enemy_type",
  "pbinfo_enemy_type1",
  "pbinfo_enemy_type2",
] as const;

/** Keys already rebuilt, so a second call cannot triple a texture that is already tripled. */
const rebuilt = new Set<string>();

/** One frame's placement on its sheet, in the source pixels it was authored in. */
interface FrameCut {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The 3x3 block one pixel expands into, given its eight neighbours clockwise from the top left.
 *
 * Each of the four corner tests asks the same question: do two neighbours agree across this corner
 * while the one opposite them disagrees? Where they do, the pixel was sitting on a diagonal rather
 * than a step, and the corner is filled with the colour that diagonal is made of. Nothing is ever
 * blended, so the block only ever holds colours the artist actually used.
 */
function expandPixel(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  g: number,
  h: number,
  i: number,
) {
  const dbCorner = d === b && b !== f && d !== h;
  const bfCorner = b === f && b !== d && f !== h;
  const hdCorner = h === d && d !== b && h !== f;
  const fhCorner = f === h && d !== h && b !== f;

  return [
    dbCorner ? d : e,
    (dbCorner && e !== c) || (bfCorner && e !== a) ? b : e,
    bfCorner ? f : e,
    (hdCorner && e !== a) || (dbCorner && e !== g) ? d : e,
    e,
    (bfCorner && e !== i) || (fhCorner && e !== c) ? f : e,
    hdCorner ? d : e,
    (fhCorner && e !== g) || (hdCorner && e !== i) ? h : e,
    fhCorner ? f : e,
  ];
}

/**
 * Scale3x (AdvMAME3x): walks every pixel, expands it through {@linkcode expandPixel}, and writes the
 * result into `out`, which must already be `width * height * 9` long.
 *
 * Both arrays are read as one 32-bit word per pixel, so comparing two pixels is a single `===` over
 * all four channels.
 */
export function scale3x(pixels: Uint32Array, out: Uint32Array, width: number, height: number): void {
  const at = (x: number, y: number) =>
    pixels[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const rowStride = width * UPSCALE;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = expandPixel(
        at(x - 1, y - 1),
        at(x, y - 1),
        at(x + 1, y - 1),
        at(x - 1, y),
        at(x, y),
        at(x + 1, y),
        at(x - 1, y + 1),
        at(x, y + 1),
        at(x + 1, y + 1),
      );
      for (let dy = 0; dy < UPSCALE; dy++) {
        for (let dx = 0; dx < UPSCALE; dx++) {
          out[(y * UPSCALE + dy) * rowStride + x * UPSCALE + dx] = block[dy * UPSCALE + dx];
        }
      }
    }
  }
}

/**
 * Stretches a frame's texture coordinates back over the whole enlarged region it was cut from.
 *
 * This is the hinge the whole approach turns on. `MultiPipeline.batchSprite` reads two independent
 * things off a frame: `cutWidth`/`cutHeight` decide how big the quad is drawn, and `u0`-`v1` decide
 * which part of the texture fills it. So every frame here keeps the cut it was authored with - the
 * quad stays exactly the size it always was, and no call site has to compensate - while its UVs are
 * multiplied out to cover the tripled pixels behind it.
 *
 * Getting this wrong the other way round, by winding back `frame.width` instead, silently does
 * nothing: `frame.width` is the size game code reads, not the size the renderer draws.
 */
function pointAtEnlargedRegion(frame: Phaser.Textures.Frame): void {
  frame.u0 *= UPSCALE;
  frame.v0 *= UPSCALE;
  frame.u1 *= UPSCALE;
  frame.v1 *= UPSCALE;
}

/** Redraws one texture through {@linkcode scale3x}, keeping its key, its frames and its drawn size. */
function sharpen(textures: Phaser.Textures.TextureManager, key: string): boolean {
  const texture = textures.get(key);
  const image = texture.getSourceImage();
  if (!(image instanceof HTMLImageElement) && !(image instanceof HTMLCanvasElement)) {
    return false;
  }

  // Plain canvases rather than Phaser's CanvasPool: the pool treats a null parent as "free to hand
  // out again", so pooled canvases would be reissued and every texture here would end up sharing one.
  const { width, height } = image;
  const read = document.createElement("canvas");
  read.width = width;
  read.height = height;
  const readContext = read.getContext("2d", { willReadFrequently: true });
  if (!readContext) {
    return false;
  }
  readContext.drawImage(image, 0, 0);
  const source = readContext.getImageData(0, 0, width, height);

  const enlarged = new ImageData(width * UPSCALE, height * UPSCALE);
  scale3x(new Uint32Array(source.data.buffer), new Uint32Array(enlarged.data.buffer), width, height);

  const target = document.createElement("canvas");
  target.width = width * UPSCALE;
  target.height = height * UPSCALE;
  const targetContext = target.getContext("2d");
  if (!targetContext) {
    return false;
  }
  targetContext.putImageData(enlarged, 0, 0);

  // Read the frame layout off the old texture before dropping it. These stay in authored pixels.
  const cuts: FrameCut[] = texture
    .getFrameNames(true)
    .filter(name => name !== "__BASE")
    .map(name => {
      const frame = texture.frames[name] as Phaser.Textures.Frame;
      return { name, x: frame.cutX, y: frame.cutY, width: frame.cutWidth, height: frame.cutHeight };
    });

  textures.remove(key);
  const next = textures.addCanvas(key, target);
  if (!next) {
    return false;
  }

  // The base frame arrives covering the whole tripled canvas; cut it back to the authored size.
  const base = next.frames["__BASE"] as Phaser.Textures.Frame;
  base.setSize(width, height, 0, 0);
  pointAtEnlargedRegion(base);

  for (const cut of cuts) {
    const frame = next.add(cut.name, 0, cut.x, cut.y, cut.width, cut.height);
    if (frame) {
      pointAtEnlargedRegion(frame);
    }
  }

  // Canvas textures do not pick up the game's pixelArt filter the way loaded ones do.
  next.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return true;
}

/**
 * Rebuilds the UI textures listed in {@linkcode TEXTURE_KEYS} at three times their authored
 * resolution, so their diagonals stop reading as staircases once the UI is drawn at 6x.
 *
 * Call this once the loader has finished and before anything has been built from these textures.
 * Nothing else has to change: each rebuilt texture keeps its key and every frame keeps the cut it
 * was authored with, so game objects are drawn at exactly the size they always were.
 */
export function sharpenUiTextures(scene: Phaser.Scene): void {
  const failed: string[] = [];
  for (const key of TEXTURE_KEYS) {
    // A rebuilt texture is itself a canvas, so a second pass would happily triple it again.
    if (rebuilt.has(key)) {
      continue;
    }
    try {
      if (!scene.textures.exists(key)) {
        continue;
      }
      if (sharpen(scene.textures, key)) {
        rebuilt.add(key);
      } else {
        failed.push(key);
      }
    } catch (error) {
      // A texture that will not rebuild is not worth failing the boot over; it just stays as it is.
      console.warn(`Could not sharpen the "${key}" texture`, error);
      failed.push(key);
    }
  }
  if (failed.length > 0) {
    console.warn(`Left ${failed.length} UI texture(s) at their authored resolution: ${failed.join(", ")}`);
  }
}
