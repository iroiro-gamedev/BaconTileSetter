/**
 * tilemap.js — Free tile placement preview.
 *
 * Renders a click-to-toggle grid of tiles using the current algorithm
 * and uploaded images.  Each cell auto-computes its neighbor bitmask
 * from the surrounding cells, so the tile variant updates in real time.
 */

import { composeQuadrants, normalize47 } from './tilegen.js';

const GRID_COLS = 12;
const GRID_ROWS = 10;

/** 2-D boolean grid — true = tile present */
let grid = makeGrid(false);
let _state = null;

function makeGrid(fill) {
  return Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(fill));
}

// ─────────────────────────────────────────────────────────────
// Bitmask helpers
// ─────────────────────────────────────────────────────────────

function computeBm4(row, col) {
  const hasN = row > 0              && grid[row - 1][col];
  const hasE = col < GRID_COLS - 1  && grid[row][col + 1];
  const hasS = row < GRID_ROWS - 1  && grid[row + 1][col];
  const hasW = col > 0              && grid[row][col - 1];
  return (hasN ? 0x1 : 0) | (hasE ? 0x2 : 0) | (hasS ? 0x4 : 0) | (hasW ? 0x8 : 0);
}

function computeBm8(row, col) {
  const bm4 = computeBm4(row, col);
  const N = !!(bm4 & 0x1), E = !!(bm4 & 0x2), S = !!(bm4 & 0x4), W = !!(bm4 & 0x8);
  const NE = N && E && row > 0             && col < GRID_COLS - 1 && grid[row - 1][col + 1];
  const SE = S && E && row < GRID_ROWS - 1 && col < GRID_COLS - 1 && grid[row + 1][col + 1];
  const SW = S && W && row < GRID_ROWS - 1 && col > 0             && grid[row + 1][col - 1];
  const NW = N && W && row > 0             && col > 0             && grid[row - 1][col - 1];
  let bm8 = (N ? 0x01 : 0) | (E ? 0x04 : 0) | (S ? 0x10 : 0) | (W ? 0x40 : 0);
  if (NE) bm8 |= 0x02;
  if (SE) bm8 |= 0x08;
  if (SW) bm8 |= 0x20;
  if (NW) bm8 |= 0x80;
  return normalize47(bm8);
}

// ─────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────

export function renderTilemap(state) {
  _state = state;
  const canvas = document.getElementById('tilemap-canvas');
  if (!canvas) return;

  const ts = Math.max(8, state.tileSize);
  canvas.width  = GRID_COLS * ts;
  canvas.height = GRID_ROWS * ts;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grid background
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 0.5;
  for (let r = 0; r <= GRID_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0,              r * ts);
    ctx.lineTo(GRID_COLS * ts, r * ts);
    ctx.stroke();
  }
  for (let c = 0; c <= GRID_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * ts, 0);
    ctx.lineTo(c * ts, GRID_ROWS * ts);
    ctx.stroke();
  }

  // Tiles
  const is47 = state.algorithm === '47';
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (!grid[r][c]) continue;
      const tx  = c * ts;
      const ty  = r * ts;
      const bm4 = computeBm4(r, c);
      const bm8 = is47 ? computeBm8(r, c) : 0;
      composeQuadrants(ctx, tx, ty, ts, bm4, state.images, bm8);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Init — wires up click/drag + control buttons
// ─────────────────────────────────────────────────────────────

export function initTilemap(onChange) {
  const canvas = document.getElementById('tilemap-canvas');
  if (!canvas) return;

  let isDrawing = false;
  let drawValue = true; // true = place, false = erase

  function cellAt(e) {
    const ts   = _state ? Math.max(8, _state.tileSize) : 32;
    const rect = canvas.getBoundingClientRect();
    const sx   = canvas.width  / rect.width;
    const sy   = canvas.height / rect.height;
    const x    = (e.clientX - rect.left) * sx;
    const y    = (e.clientY - rect.top)  * sy;
    const row  = Math.floor(y / ts);
    const col  = Math.floor(x / ts);
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return null;
    return { row, col };
  }

  canvas.addEventListener('mousedown', e => {
    isDrawing = true;
    const cell = cellAt(e);
    if (!cell) return;
    drawValue = !grid[cell.row][cell.col];
    grid[cell.row][cell.col] = drawValue;
    onChange();
  });

  canvas.addEventListener('mousemove', e => {
    if (!isDrawing) return;
    const cell = cellAt(e);
    if (!cell) return;
    if (grid[cell.row][cell.col] === drawValue) return;
    grid[cell.row][cell.col] = drawValue;
    onChange();
  });

  window.addEventListener('mouseup', () => { isDrawing = false; });

  document.getElementById('tilemap-clear')?.addEventListener('click', () => {
    grid = makeGrid(false);
    onChange();
  });

  document.getElementById('tilemap-fill')?.addEventListener('click', () => {
    grid = makeGrid(true);
    onChange();
  });
}
