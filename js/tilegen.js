/**
 * tilegen.js — Tile generation for 16-tile, 47-tile, and Wang tile algorithms.
 *
 * ─────────────────────────────────────────────────────────────
 * SHARED: Quadrant Compositor
 * ─────────────────────────────────────────────────────────────
 * All algorithms use composeQuadrants() as their drawing primitive.
 *
 * The tile is divided into 4 equal quadrants (TL, TR, BL, BR).
 * Each quadrant selects a source image and a source region:
 *
 *   Bitmask encodes 4-bit cardinal neighbors (bit 0=N, 1=E, 2=S, 3=W):
 *
 *   TL quadrant uses: N (top) and W (left) neighbors
 *     hasN && hasW → main  (interior corner — fully connected)
 *     hasN && !hasW → left  (left edge exposed)
 *    !hasN && hasW → top   (top edge exposed)
 *    !hasN && !hasW → top  (outer corner — use top edge; will composite left over it)
 *
 *   TR, BL, BR follow the same logic with their respective neighbors.
 *
 * ─────────────────────────────────────────────────────────────
 * 16-TILE ALGORITHM
 * ─────────────────────────────────────────────────────────────
 * Bitmask: 4 bits → 16 combinations (0x0–0xF)
 *   bit 0 (0x1) = N neighbor present
 *   bit 1 (0x2) = E neighbor present
 *   bit 2 (0x4) = S neighbor present
 *   bit 3 (0x8) = W neighbor present
 *
 * Spritesheet layout: 4 columns × 4 rows (tile i at row i>>2, col i&3)
 *
 * ─────────────────────────────────────────────────────────────
 * 47-TILE ALGORITHM
 * ─────────────────────────────────────────────────────────────
 * Bitmask: 8 bits (N, NE, E, SE, S, SW, W, NW) → normalized to 47 unique tiles.
 * Normalization rule: diagonal neighbor bits are cleared unless BOTH adjacent
 * cardinal neighbors are present (e.g. NE only counts if N AND E are both set).
 *
 * After normalization, 256 raw bitmasks collapse to exactly 47 unique values.
 * Spritesheet layout: 8 columns × 6 rows (tiles in sorted order by index).
 *
 * Each tile is composited using the quadrant logic on cardinal neighbors only.
 *
 */

// ─────────────────────────────────────────────────────────────
// Shared: Quadrant compositor
// ─────────────────────────────────────────────────────────────

/**
 * Draw one tile by compositing 4 quadrants from the 5 source images.
 * Each quadrant picks the source image based on the two adjacent cardinal neighbors.
 *
 * @param {CanvasRenderingContext2D} ctx  - Target context
 * @param {number} tx   - Tile X in context (pixels)
 * @param {number} ty   - Tile Y in context (pixels)
 * @param {number} ts   - Tile size (pixels, must be even)
 * @param {number} bm4  - 4-bit bitmask: bit0=N, bit1=E, bit2=S, bit3=W
 * @param {Object} imgs - { main, top, bottom, left, right } ImageBitmap or null
 * @param {number} bm8  - 8-bit bitmask (47-tile only); enables inner-corner rendering
 *                        when both adjacent cardinals are set but the diagonal is not.
 *                        Pass 0 (default) to disable inner-corner rendering (16-tile).
 */
export function composeQuadrants(ctx, tx, ty, ts, bm4, imgs, bm8 = 0) {
  const qs = ts / 2;
  const hasN = !!(bm4 & 0x1);
  const hasE = !!(bm4 & 0x2);
  const hasS = !!(bm4 & 0x4);
  const hasW = !!(bm4 & 0x8);

  // Diagonal presence from bm8 (only non-zero for 47-tile calls)
  // bit layout: bit1=NE, bit3=SE, bit5=SW, bit7=NW
  const hasNW = !!(bm8 & 0x80);
  const hasNE = !!(bm8 & 0x02);
  const hasSE = !!(bm8 & 0x08);
  const hasSW = !!(bm8 & 0x20);

  // TL quadrant: inner corner only in 47-tile (bm8≠0) when N&&W but !NW
  drawQuadrant(ctx, tx,      ty,      qs, 0, 0, hasN, hasW, imgs.main, imgs.top,    imgs.left,   !!bm8 && hasN && hasW && !hasNW);
  // TR quadrant: inner corner only in 47-tile (bm8≠0) when N&&E but !NE
  drawQuadrant(ctx, tx + qs, ty,      qs, 1, 0, hasN, hasE, imgs.main, imgs.top,    imgs.right,  !!bm8 && hasN && hasE && !hasNE);
  // BL quadrant: inner corner only in 47-tile (bm8≠0) when S&&W but !SW
  drawQuadrant(ctx, tx,      ty + qs, qs, 0, 1, hasS, hasW, imgs.main, imgs.bottom, imgs.left,   !!bm8 && hasS && hasW && !hasSW);
  // BR quadrant: inner corner only in 47-tile (bm8≠0) when S&&E but !SE
  drawQuadrant(ctx, tx + qs, ty + qs, qs, 1, 1, hasS, hasE, imgs.main, imgs.bottom, imgs.right,  !!bm8 && hasS && hasE && !hasSE);
}

/**
 * Draw a single quadrant of a tile.
 *
 * Transparency-aware compositing:
 *   1. Main image is always drawn first as the base layer.
 *   2. Edge images are composited on top using canvas source-over blending.
 *      If an edge image has transparent pixels, the main image shows through.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} qx, qy       - Output position (top-left of quadrant)
 * @param {number} qs           - Quadrant size
 * @param {number} qcol, qrow   - Which quadrant (0/1, 0/1) within source images
 * @param {boolean} hasVert     - Vertical cardinal neighbor present (N for top, S for bottom)
 * @param {boolean} hasHoriz    - Horizontal cardinal neighbor present (W for left, E for right)
 * @param {CanvasImageSource|null} imgMain  - Main (interior) image
 * @param {CanvasImageSource|null} imgVert  - Vertical edge image (top or bottom)
 * @param {CanvasImageSource|null} imgHoriz - Horizontal edge image (left or right)
 * @param {boolean} innerCorner - When true: both cardinals present but diagonal absent.
 *                                Overlay both edge images to render the concave corner.
 *                                Only set by 47-tile compositor; always false for 16-tile.
 */
function drawQuadrant(ctx, qx, qy, qs, qcol, qrow, hasVert, hasHoriz, imgMain, imgVert, imgHoriz, innerCorner = false) {
  const anyImg = imgMain || imgVert || imgHoriz;
  // If no source image is available for this quadrant, leave the pixels
  // transparent so the exported PNG carries correct alpha data.
  if (!anyImg) return;

  if (hasVert && hasHoriz) {
    // Interior quadrant: main image as base
    blitQuadrant(ctx, qx, qy, qs, qcol, qrow, imgMain || imgVert || imgHoriz);
    if (innerCorner) {
      // Inner corner (凹角): both cardinals connected but diagonal absent.
      // Draw only at the intersection of both edge images (overlap pixels only).
      if (imgVert && imgHoriz) {
        blendQuadrantEdges(ctx, qx, qy, qs, qcol, qrow, imgVert, imgHoriz);
      } else if (imgVert) {
        blitQuadrant(ctx, qx, qy, qs, qcol, qrow, imgVert);
      } else if (imgHoriz) {
        blitQuadrant(ctx, qx, qy, qs, qcol, qrow, imgHoriz);
      }
    }
    return;
  }

  // Edge / corner quadrant:
  //   Layer 1 — main image as opaque base
  //   Layer 2 — exposed edge image(s) composited on top
  //   Transparent pixels in edge images reveal the main image beneath.
  if (imgMain) {
    blitQuadrant(ctx, qx, qy, qs, qcol, qrow, imgMain);
  }

  if (!hasVert && imgVert) {
    blitQuadrant(ctx, qx, qy, qs, qcol, qrow, imgVert);
  }
  if (!hasHoriz && imgHoriz) {
    blitQuadrant(ctx, qx, qy, qs, qcol, qrow, imgHoriz);
  }
}

/**
 * Copy one quadrant region from a source image onto the canvas.
 * Source quadrant is selected by (qcol, qrow) — each is 0 or 1, addressing
 * the top-left / top-right / bottom-left / bottom-right quarter of the image.
 */
function blitQuadrant(ctx, qx, qy, qs, qcol, qrow, src) {
  if (!src) return;
  const sw = src.width;
  const sh = src.height;
  ctx.drawImage(
    src,
    qcol * sw / 2, qrow * sh / 2, sw / 2, sh / 2, // source quadrant
    qx, qy, qs, qs                                  // destination quadrant
  );
}

/**
 * Composite two edge images onto the canvas, drawing ONLY at their intersection.
 * Pixels present in only one image are not drawn.
 *
 * - Pixels in both (intersection) → 50/50 alpha-weighted blend
 * - Pixels only in one image      → not drawn (transparent)
 *
 * Used for inner corners where both edge images meet at the diagonal.
 */
function blendQuadrantEdges(ctx, qx, qy, qs, qcol, qrow, imgVert, imgHoriz) {
  // Render each edge quadrant into its own temp canvas
  const tmpV = createCanvas(qs, qs);
  blitQuadrant(tmpV.getContext('2d'), 0, 0, qs, qcol, qrow, imgVert);

  const tmpH = createCanvas(qs, qs);
  blitQuadrant(tmpH.getContext('2d'), 0, 0, qs, qcol, qrow, imgHoriz);

  const dataV = tmpV.getContext('2d').getImageData(0, 0, qs, qs);
  const dataH = tmpH.getContext('2d').getImageData(0, 0, qs, qs);

  // Build output: only intersection pixels
  const tmpOut = createCanvas(qs, qs);
  const tcOut  = tmpOut.getContext('2d');
  const out    = tcOut.createImageData(qs, qs);

  for (let i = 0; i < out.data.length; i += 4) {
    const aV = dataV.data[i + 3];
    const aH = dataH.data[i + 3];

    if (aV > 0 && aH > 0) {
      // Intersection only: alpha-weighted 50/50 blend
      const total = aV + aH;
      out.data[i    ] = Math.round((dataV.data[i    ] * aV + dataH.data[i    ] * aH) / total);
      out.data[i + 1] = Math.round((dataV.data[i + 1] * aV + dataH.data[i + 1] * aH) / total);
      out.data[i + 2] = Math.round((dataV.data[i + 2] * aV + dataH.data[i + 2] * aH) / total);
      out.data[i + 3] = Math.max(aV, aH);
    }
    // Non-intersection: leave transparent (don't draw)
  }

  tcOut.putImageData(out, 0, 0);
  // Composite onto main canvas via source-over (sits on top of imgMain)
  ctx.drawImage(tmpOut, qx, qy);
}

// ─────────────────────────────────────────────────────────────
// 16-Tile Generator
// ─────────────────────────────────────────────────────────────

/**
 * Generate a 4×4 spritesheet of 16 tiles.
 * Returns the canvas element and tile descriptor array.
 *
 * @param {Object} images  - { main, top, bottom, left, right }
 * @param {number} tileSize
 * @returns {{ canvas: HTMLCanvasElement, tiles: TileDescriptor[] }}
 */
export function generate16(images, tileSize) {
  const cols = 4;
  const rows = 4;
  const canvas = createCanvas(cols * tileSize, rows * tileSize);
  const ctx = canvas.getContext('2d');
  const tiles = [];

  const LABELS = [
    'isolated', 'cap-N', 'cap-E', 'corner-NE',
    'cap-S', 'strip-V', 'corner-SE', 'T-E',
    'cap-W', 'corner-NW', 'strip-H', 'T-N',
    'corner-SW', 'T-W', 'T-S', 'cross',
  ];

  for (let bitmask = 0; bitmask < 16; bitmask++) {
    const col = bitmask % cols;
    const row = Math.floor(bitmask / cols);
    const tx = col * tileSize;
    const ty = row * tileSize;

    composeQuadrants(ctx, tx, ty, tileSize, bitmask, images);

    tiles.push({
      id: bitmask,
      bitmask,
      x: tx, y: ty,
      width: tileSize, height: tileSize,
      label: LABELS[bitmask] || `tile-${bitmask}`,
    });
  }

  return { canvas, tiles };
}

// ─────────────────────────────────────────────────────────────
// 47-Tile Generator
// ─────────────────────────────────────────────────────────────

/**
 * 8-bit bitmask bit layout for 47-tile:
 *   bit 0 (0x01) = N
 *   bit 1 (0x02) = NE
 *   bit 2 (0x04) = E
 *   bit 3 (0x08) = SE
 *   bit 4 (0x10) = S
 *   bit 5 (0x20) = SW
 *   bit 6 (0x40) = W
 *   bit 7 (0x80) = NW
 *
 * Normalization: diagonal bits cleared when adjacent cardinals not both set.
 */
export function normalize47(b) {
  // NE needs N(0x01) and E(0x04)
  if (!((b & 0x01) && (b & 0x04))) b &= ~0x02;
  // SE needs E(0x04) and S(0x10)
  if (!((b & 0x04) && (b & 0x10))) b &= ~0x08;
  // SW needs S(0x10) and W(0x40)
  if (!((b & 0x10) && (b & 0x40))) b &= ~0x20;
  // NW needs W(0x40) and N(0x01)
  if (!((b & 0x40) && (b & 0x01))) b &= ~0x80;
  return b;
}

/** Build the sorted array of 47 unique normalized values (index = tile slot). */
function build47Index() {
  const unique = new Set();
  for (let b = 0; b < 256; b++) unique.add(normalize47(b));
  return [...unique].sort((a, z) => a - z);
}

const NORMALIZED_47 = build47Index(); // 47 unique values, sorted

/** Map any raw 8-bit bitmask → tile index 0–46 */
export function bitmask8ToIndex47(raw8) {
  const norm = normalize47(raw8);
  return NORMALIZED_47.indexOf(norm);
}

/**
 * Extract 4-bit cardinal bitmask from 8-bit full bitmask.
 * bit0=N, bit1=E, bit2=S, bit3=W (matching composeQuadrants signature)
 */
function cardinals8to4(b8) {
  const hasN = !!(b8 & 0x01);
  const hasE = !!(b8 & 0x04);
  const hasS = !!(b8 & 0x10);
  const hasW = !!(b8 & 0x40);
  return (hasN ? 0x1 : 0) | (hasE ? 0x2 : 0) | (hasS ? 0x4 : 0) | (hasW ? 0x8 : 0);
}

/**
 * Generate a 8×6 spritesheet of 47 tiles.
 *
 * @param {Object} images
 * @param {number} tileSize
 * @returns {{ canvas: HTMLCanvasElement, tiles: TileDescriptor[] }}
 */
export function generate47(images, tileSize) {
  const cols = 8;
  const rows = Math.ceil(NORMALIZED_47.length / cols); // 6
  const canvas = createCanvas(cols * tileSize, rows * tileSize);
  const ctx = canvas.getContext('2d');
  const tiles = [];

  NORMALIZED_47.forEach((norm8, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const tx  = col * tileSize;
    const ty  = row * tileSize;

    // Compose using cardinal neighbors; pass norm8 for inner-corner rendering
    const bm4 = cardinals8to4(norm8);
    composeQuadrants(ctx, tx, ty, tileSize, bm4, images, norm8);

    tiles.push({
      id: idx,
      bitmask8: norm8,
      bitmask4: bm4,
      x: tx, y: ty,
      width: tileSize, height: tileSize,
      label: `tile-47-${idx}`,
    });
  });

  return { canvas, tiles };
}

// ─────────────────────────────────────────────────────────────
// Main dispatch
// ─────────────────────────────────────────────────────────────

/**
 * Generate tileset based on the current app state.
 * @param {{ images: Object, tileSize: number, algorithm: string }} state
 * @returns {{ canvas: HTMLCanvasElement, tiles: TileDescriptor[], algorithm: string }}
 */
export function generate(state) {
  const { images, tileSize, algorithm } = state;
  const ts = Math.max(8, tileSize);

  switch (algorithm) {
    case '47': return { ...generate47(images, ts), algorithm };
    case '16':
    default:   return { ...generate16(images, ts), algorithm };
  }
}

// ─────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────

function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  return c;
}
