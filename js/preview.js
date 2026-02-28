/**
 * preview.js — Real-time adjacency preview renderer.
 *
 * Layout:
 *   Left column  — 4 "Common Patterns" tiles stacked vertically
 *   Right grid   — Full tile set, PREVIEW_GRID_ROWS rows × variable columns
 *
 * All tiles render at a fixed PREVIEW_DISPLAY_TS regardless of state.tileSize,
 * so the panel stays compact and balanced at any tile resolution.
 */

import { composeQuadrants, generate16, generate47 } from './tilegen.js';

// ─────────────────────────────────────────────────────────────
// Layout constants — also imported by main.js for hover hit-testing
// ─────────────────────────────────────────────────────────────

export const PREVIEW_DISPLAY_TS = 32;   // Fixed tile display size (px)
export const PREVIEW_PAD        = 8;    // Outer padding
export const PREVIEW_CP_GAP     = 10;   // Gap between CP column and tile grid
export const PREVIEW_LABEL_H    = 14;   // Section label row height
export const PREVIEW_GRID_ROWS  = 4;    // Tile grid always 4 rows

/** Number of tile grid columns for a given algorithm. */
export function previewGridCols(algorithm) {
  return algorithm === '47' ? Math.ceil(47 / PREVIEW_GRID_ROWS) : 4; // 12 or 4
}

// ─────────────────────────────────────────────────────────────
// Common Patterns — 4 archetypal tiles
// ─────────────────────────────────────────────────────────────

const CP_PATTERNS = [
  { bitmask4: 0b0000 },   // Isolated
  { bitmask4: 0b1010 },   // H-Strip  (W+E)
  { bitmask4: 0b0101 },   // V-Strip  (N+S)
  { bitmask4: 0b1111 },   // Full
];

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function renderPreview(state) {
  const canvas = document.getElementById('preview-canvas');
  if (!canvas) return;

  const { images, algorithm } = state;
  const ts      = PREVIEW_DISPLAY_TS;
  const PAD     = PREVIEW_PAD;
  const LABEL_H = PREVIEW_LABEL_H;
  const CP_GAP  = PREVIEW_CP_GAP;
  const ROWS    = PREVIEW_GRID_ROWS;
  const cols    = previewGridCols(algorithm);
  const is47    = algorithm === '47';
  const hasAny  = Object.values(images).some(v => v !== null);

  const totalW = PAD + ts + CP_GAP + cols * ts + PAD;
  const totalH = PAD + LABEL_H + ROWS * ts + PAD;

  canvas.width  = totalW;
  canvas.height = totalH;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, totalW, totalH);

  // ── Section labels ───────────────────────────────────────────
  drawLabel(ctx, PAD, PAD, 'Common');
  drawLabel(ctx, PAD + ts + CP_GAP, PAD, is47 ? '47-Tile Set' : '16-Tile Set');

  const contentY = PAD + LABEL_H;

  // ── Common Patterns column (vertical, left) ──────────────────
  CP_PATTERNS.forEach((p, i) => {
    const x = PAD;
    const y = contentY + i * ts;
    if (hasAny) {
      composeQuadrants(ctx, x, y, ts, p.bitmask4, images);
      drawNeighborDots(ctx, x, y, ts, p.bitmask4);
    } else {
      drawPlaceholder(ctx, x, y, ts, p.bitmask4);
    }
  });

  // ── Tile grid (4 rows × numCols, right) ──────────────────────
  const gridX = PAD + ts + CP_GAP;
  const gridY = contentY;

  if (hasAny) {
    if (is47) {
      // generate47 returns an 8-col canvas; remap tiles to 4-row display layout
      const { canvas: src } = generate47(images, ts);
      const SRC_COLS = 8;
      for (let idx = 0; idx < 47; idx++) {
        const sc = idx % SRC_COLS;
        const sr = Math.floor(idx / SRC_COLS);
        const dc = idx % cols;
        const dr = Math.floor(idx / cols);
        ctx.drawImage(src,
          sc * ts, sr * ts, ts, ts,
          gridX + dc * ts, gridY + dr * ts, ts, ts);
      }
    } else {
      // generate16 returns a 4×4 canvas which already matches PREVIEW_GRID_ROWS
      ctx.drawImage(generate16(images, ts).canvas, gridX, gridY);
    }
  } else {
    drawPlaceholderGrid(ctx, gridX, gridY, cols, ROWS, ts);
  }
}

// ─────────────────────────────────────────────────────────────
// Drawing helpers
// ─────────────────────────────────────────────────────────────

function drawLabel(ctx, x, y, text) {
  ctx.fillStyle = '#555';
  ctx.font      = '10px system-ui, sans-serif';
  ctx.fillText(text, x, y + 11);
}

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

  ctx.fillStyle = 'rgba(249,115,22,0.35)';
  const ew = Math.max(2, ts / 8);
  if (hasN) ctx.fillRect(x,            y,            ts, ew);
  if (hasS) ctx.fillRect(x,            y + ts - ew,  ts, ew);
  if (hasW) ctx.fillRect(x,            y,            ew, ts);
  if (hasE) ctx.fillRect(x + ts - ew,  y,            ew, ts);
}

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

function drawNeighborDots(ctx, x, y, ts, bitmask4) {
  const hasN = !!(bitmask4 & 0b0001);
  const hasE = !!(bitmask4 & 0b0010);
  const hasS = !!(bitmask4 & 0b0100);
  const hasW = !!(bitmask4 & 0b1000);

  const r = Math.max(2, ts / 16);
  const m = r + 1;

  [
    { cx: x + ts / 2,  cy: y + m,       has: hasN },
    { cx: x + ts - m,  cy: y + ts / 2,  has: hasE },
    { cx: x + ts / 2,  cy: y + ts - m,  has: hasS },
    { cx: x + m,       cy: y + ts / 2,  has: hasW },
  ].forEach(({ cx, cy, has }) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = has ? '#f97316' : '#333';
    ctx.fill();
  });
}
