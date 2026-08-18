import { scale3x } from "#system/crisp-ui-textures";
import { describe, expect, it } from "vitest";

/** Runs one pixel grid, written as rows of single-digit colours, through Scale3x. */
function upscale(rows: number[][]): number[][] {
  const height = rows.length;
  const width = rows[0].length;
  const source = new Uint32Array(rows.flat());
  const out = new Uint32Array(width * height * 9);
  scale3x(source, out, width, height);

  const result: number[][] = [];
  for (let y = 0; y < height * 3; y++) {
    result.push(Array.from(out.slice(y * width * 3, (y + 1) * width * 3)));
  }
  return result;
}

/** What the renderer does today: every pixel becomes a 3x3 block of itself. */
function nearest(rows: number[][]): number[][] {
  return rows.flatMap(row => {
    const wide = row.flatMap(v => [v, v, v]);
    return [wide, [...wide], [...wide]];
  });
}

describe("scale3x", () => {
  it("triples both dimensions", () => {
    const out = upscale([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);

    expect(out).toHaveLength(6);
    expect(out[0]).toHaveLength(12);
  });

  it("leaves horizontal banding exactly as it found it", () => {
    // This is overlay_hp and overlay_exp: rows of flat colour, not one diagonal between them. The
    // filter has nothing to work with, which is why those two textures are not worth rebuilding.
    const bands = [
      [1, 1, 1, 1, 1],
      [2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3],
    ];

    expect(upscale(bands)).toEqual(nearest(bands));
  });

  it("leaves a flat field alone", () => {
    const flat = [
      [7, 7, 7],
      [7, 7, 7],
      [7, 7, 7],
    ];

    expect(upscale(flat)).toEqual(nearest(flat));
  });

  it("cuts the corner off a staircase so it reads as a diagonal", () => {
    // A hard diagonal edge: 0 above the line, 1 below it.
    const staircase = [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ];
    const out = upscale(staircase);

    // The centre pixel is 1, and its top-left ninth is the corner facing the 0 side. Scale3x hands
    // that ninth to the background, which is what turns the step into a slope.
    expect(out[3][3]).toBe(0);
    // Its bottom-right ninth stays on the filled side.
    expect(out[5][5]).toBe(1);
    // And the untouched middle of the block is still the pixel's own colour.
    expect(out[4][4]).toBe(1);
    expect(out).not.toEqual(nearest(staircase));
  });

  it("only ever emits colours that were already there", () => {
    // The guarantee that separates this from bilinear: no blending, so no new colours, so the
    // palette a pixel artist chose survives intact.
    const rows = [
      [0, 0, 9, 9],
      [0, 9, 9, 4],
      [9, 9, 4, 4],
      [9, 4, 4, 4],
    ];
    const palette = new Set(rows.flat());

    for (const value of upscale(rows).flat()) {
      expect(palette.has(value)).toBe(true);
    }
  });

  it("treats the edges as if the border repeated, so nothing bleeds in from outside", () => {
    const out = upscale([
      [1, 1],
      [1, 2],
    ]);

    // The top-left pixel has no neighbours above or left; clamping means it sees only 1s and 2s that
    // are really there, and stays whole.
    expect(out[0].slice(0, 3)).toEqual([1, 1, 1]);
  });
});
