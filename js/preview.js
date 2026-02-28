/**
 * preview.js — Real-time adjacency preview renderer.
 *
 * Shows:
 *   1. "Common Patterns" row — 4 archetypal tiles (Isolated / H-Strip / V-Strip / Full)
 *      using the quadrant compositor so results match the spritesheet exactly.
 *   2. Full algorithm tile grid — 16-tile (4×4) or 47-tile (8×6),
 *      generated from the same functions used for the export spritesheet.
 *
 * When no images are loaded, both sections render placeholder tiles.
 */

import { composeQuadrants, generate16, generate47 } from './tilegen.js';

const CANVAS_ID = 'preview-canvas';
const PAD       = 4;   // px between tiles in the common-patterns row
const LABEL_H   = 18;  // px for section labels

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Re-render the adjacency preview whenever images or settings change.
 * @param {{ images: Object, tileSize: number, algorithm: string }} state
 */
export function renderPreview(state) {
  const canvas = document.getElementById(CANVAS_ID);
  if (!canvas) return;

  const { images, tileSize, algorithm } = state;
  const ts     = Math.max(8, Math.min(tileSize, 128)); // cap preview tile size
  const hasAny = Object.values(images).some(v => v !== null);

  // ── Common-patterns row (always 4 tiles, algorithm-independent) ──
  const patterns = [
    { label: 'Isolated', bitmask4: 0b0000 },
    { label: 'H-Strip',  bitmask4: 0b1010 },
    { label: 'V-Strip',  bitmask4: 0b0101 },
    { label: 'Full',     bitmask4: 0b1111 },
  ];

  // ── Grid dimensions and label by algorithm ──
  let gridCols, gridRows, gridLabel;
  if (algorithm === '47') {
    gridCols = 8; gridRows = 6; gridLabel = '47-Tile Set';
  } else {
    gridCols = 4; gridRows = 4; gridLabel = '16-Tile Set';
  }

  const patW   = patterns.length * (ts + PAD) - PAD;
  const gridW  = gridCols * ts;
  const gridH  = gridRows * ts;
  const totalW = Math.max(patW, gridW) + PAD * 2;
  const totalH = PAD + LABEL_H + ts + PAD * 3 + LABEL_H + gridH + PAD;

  canvas.width  = totalW;
  canvas.height = totalH;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, totalW, totalH);

  // Dark background for the preview (transparent tiles will appear dark here)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, totalW, totalH);

  // ── Section 1: Common Patterns ──────────────────────────────
  let curY = PAD;
  drawLabel(ctx, PAD, curY, 'Common Patterns');
  curY += LABEL_H;

  patterns.forEach((p, i) => {
    const x = PAD + i * (ts + PAD);
    if (hasAny) {
      composeQuadrants(ctx, x, curY, ts, p.bitmask4, images);
      drawNeighborDots(ctx, x, curY, ts, p.bitmask4);
    } else {
      drawPlaceholder(ctx, x, curY, ts, p.bitmask4);
    }
  });
  curY += ts + PAD * 3;

  // ── Section 2: Algorithm-specific tile grid ──────────────────
  drawLabel(ctx, PAD, curY, gridLabel);
  curY += LABEL_H;

  if (hasAny) {
    // Generate the full spritesheet for this algorithm and blit it into the preview.
    const gridCanvas = algorithm === '47'
      ? generate47(images, ts).canvas
      : generate16(images, ts).canvas;

    ctx.drawImage(gridCanvas, PAD, curY);
  } else {
    drawPlaceholderGrid(ctx, PAD, curY, gridCols, gridRows, ts);
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function drawLabel(ctx, x, y, text) {
  ctx.fillStyle = '#555';
  ctx.font      = '10px system-ui, sans-serif';
  ctx.fillText(text, x, y + 11);
}

/**
 * Placeholder tile for when no images are uploaded.
 * Shading reflects how many neighbors are present.
 */
function drawPlaceholder(ctx, x, y, ts, bitmask4) {
  const hasN = !!(bitmask4 & 0b0001);
  const hasE = !!(bitmask4 & 0b0010);
  const hasS = !!(bitmask4 & 0b0100);
  const hasW = !!(bitmask4 & 0b1000);

  const count = [hasN, hasE, hasS, hasW].filter(Boolean).length;
  const shade = 30 + count * 18;
  ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
  ctx.fillRect(x, y, ts, ts);

  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth   = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);

  // Edge highlight strips — present edges show orange, absent edges show nothing
  ctx.fillStyle = 'rgba(249,115,22,0.35)';
  const ew = Math.max(2, ts / 8);
  if (hasN) ctx.fillRect(x,          y,          ts, ew);
  if (hasS) ctx.fillRect(x,          y + ts - ew, ts, ew);
  if (hasW) ctx.fillRect(x,          y,          ew, ts);
  if (hasE) ctx.fillRect(x + ts - ew, y,          ew, ts);
}

/**
 * Placeholder grid of outlined squares when no images are loaded.
 * Each cell uses a subtle shade variation so the grid is visible.
 */
function drawPlaceholderGrid(ctx, startX, startY, cols, rows, ts) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x   = startX + c * ts;
      const y   = startY + r * ts;
      const bm  = (r * cols + c) & 0xF;
      const cnt = [bm & 1, (bm >> 1) & 1, (bm >> 2) & 1, (bm >> 3) & 1].filter(Boolean).length;
      const s   = 28 + cnt * 12;
      ctx.fillStyle = `rgb(${s},${s},${s})`;
      ctx.fillRect(x, y, ts, ts);
      ctx.strokeStyle = '#2e2e2e';
      ctx.lineWidth   = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);
    }
  }
}

/**
 * Tiny dots at each cardinal edge showing which neighbors are present (orange)
 * or absent (dark), so the viewer can tell which tile variant this is.
 */
function drawNeighborDots(ctx, x, y, ts, bitmask4) {
  const hasN = !!(bitmask4 & 0b0001);
  const hasE = !!(bitmask4 & 0b0010);
  const hasS = !!(bitmask4 & 0b0100);
  const hasW = !!(bitmask4 & 0b1000);

  const r = Math.max(2, ts / 16);
  const m = r + 1;

  [
    { cx: x + ts / 2, cy: y + m,       has: hasN },
    { cx: x + ts - m, cy: y + ts / 2,  has: hasE },
    { cx: x + ts / 2, cy: y + ts - m,  has: hasS },
    { cx: x + m,      cy: y + ts / 2,  has: hasW },
  ].forEach(({ cx, cy, has }) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = has ? '#f97316' : '#333';
    ctx.fill();
  });
}
