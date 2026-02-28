/**
 * main.js — App entry point.
 *
 * Responsibilities:
 *  - i18n init (localStorage → 'en')
 *  - Single cycling lang button (EN → JA → ZH → EN)
 *  - Hamburger menu for mobile
 *  - Image uploaders (click + drag & drop)
 *  - Per-slot transform state (rotation, flipX, flipY)
 *  - Auto-generate preview + spritesheet on any change (debounced 300 ms)
 *  - Export buttons
 */

import { loadLang, applyTranslations, detectLang } from './i18n.js';
import { initUploaders } from './uploader.js';
import { renderPreview,
         PREVIEW_DISPLAY_TS, PREVIEW_PAD, PREVIEW_CP_GAP,
         PREVIEW_LABEL_H, PREVIEW_GRID_ROWS,
         previewGridCols }    from './preview.js';
import { generate }       from './tilegen.js';
import { exportPNG, exportUnityPackage } from './exporter.js';
import { initTilemap, renderTilemap } from './tilemap.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SLOTS = ['main', 'top', 'bottom', 'left', 'right'];
const LANGS  = ['en', 'ja', 'zh'];

const ZOOM_MIN     = 1;
const ZOOM_MAX     = 8;
const ZOOM_DEFAULT = 2;  // 2× is a comfortable default for small pixel-art tiles

// ─────────────────────────────────────────────────────────────
// Application State
// ─────────────────────────────────────────────────────────────

const state = {
  lang:        'en',
  tileSize:    32,
  algorithm:   '16',
  tilesetName: 'BaconTileSet',

  // Raw ImageBitmap from file input — never mutated
  originals: {
    main: null, top: null, bottom: null, left: null, right: null,
  },

  // Per-slot transform parameters
  transforms: {
    main:   { rotation: 0, flipX: false, flipY: false },
    top:    { rotation: 0, flipX: false, flipY: false },
    bottom: { rotation: 0, flipX: false, flipY: false },
    left:   { rotation: 0, flipX: false, flipY: false },
    right:  { rotation: 0, flipX: false, flipY: false },
  },

  // Transformed canvases fed to tilegen / preview
  images: {
    main: null, top: null, bottom: null, left: null, right: null,
  },

  result: null,
};

// Zoom levels — persist across re-renders
const zoom = {
  preview: ZOOM_DEFAULT,
  tilemap: 1,
};

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────

async function boot() {
  state.lang = detectLang();
  await loadLang(state.lang);
  applyTranslations();

  // Shared UI (runs on every page)
  initLangCycle();
  initHamburger();

  // Index-page-only wiring (each function guards its own presence)
  initSettings();
  initUploadPanel();
  initTransformControls();
  initExportButtons();
  initZoomControls();
  initTilemap(() => { renderTilemap(state); applyZoom('tilemap'); });
  initSpritesheetHover();

  // Initial preview render (shows placeholder tiles)
  scheduleAutoGenerate();
}

// ─────────────────────────────────────────────────────────────
// Language — single cycling button
// ─────────────────────────────────────────────────────────────

function initLangCycle() {
  const btn = document.getElementById('lang-cycle');
  if (!btn) return;

  // Reflect actual detected language immediately
  btn.textContent = state.lang.toUpperCase();

  btn.addEventListener('click', async () => {
    const next = LANGS[(LANGS.indexOf(state.lang) + 1) % LANGS.length];
    state.lang = next;

    // Update button text IMMEDIATELY so the click feels responsive,
    // then fetch the dictionary in the background.
    btn.textContent = next.toUpperCase();

    await loadLang(next);   // persists to localStorage
    applyTranslations();
  });
}

// ─────────────────────────────────────────────────────────────
// Hamburger Menu
// ─────────────────────────────────────────────────────────────

function initHamburger() {
  const hamburger = document.getElementById('hamburger');
  const navbar    = document.querySelector('.navbar');
  if (!hamburger || !navbar) return;

  hamburger.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = navbar.classList.toggle('nav-open');
    hamburger.setAttribute('aria-expanded', String(isOpen));
    hamburger.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  });

  // Close when clicking outside the navbar
  document.addEventListener('click', e => {
    if (!navbar.contains(e.target)) {
      navbar.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.setAttribute('aria-label', 'Open menu');
    }
  });

  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => navbar.classList.remove('nav-open'));
  });
}

// ─────────────────────────────────────────────────────────────
// Settings (index.html only)
// ─────────────────────────────────────────────────────────────

function initSettings() {
  const nameInput     = document.getElementById('tileset-name');
  const algoSelect    = document.getElementById('algorithm');
  const tileSizeInput = document.getElementById('tile-size');
  if (!nameInput && !algoSelect && !tileSizeInput) return;

  if (nameInput) {
    nameInput.value = state.tilesetName;
    nameInput.addEventListener('input', () => {
      state.tilesetName = nameInput.value.trim() || 'BaconTileSet';
    });
  }

  if (algoSelect) {
    algoSelect.value = state.algorithm;
    algoSelect.addEventListener('change', () => {
      state.algorithm = algoSelect.value;
      scheduleAutoGenerate();
    });
  }

  if (tileSizeInput) {
    tileSizeInput.value = state.tileSize;
    tileSizeInput.addEventListener('change', () => {
      const v = parseInt(tileSizeInput.value, 10);
      if (!isNaN(v) && v >= 8) {
        state.tileSize = v;
        scheduleAutoGenerate();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Upload Panel (index.html only)
// ─────────────────────────────────────────────────────────────

function initUploadPanel() {
  if (!document.getElementById('drop-main')) return;
  initUploaders(onImageLoaded);
}

// ─────────────────────────────────────────────────────────────
// Transform Controls (index.html only)
// ─────────────────────────────────────────────────────────────

function initTransformControls() {
  SLOTS.forEach(slot => {
    const zone = document.getElementById(`drop-${slot}`);
    if (!zone) return;

    zone.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        // Prevent click from bubbling to the outer .dropzone
        // (drag listeners are there; we don't want a spurious dragenter etc.)
        e.stopPropagation();

        const tf = state.transforms[slot];
        switch (btn.dataset.tf) {
          case 'rot-ccw': tf.rotation = (tf.rotation - 90 + 360) % 360; break;
          case 'rot-cw':  tf.rotation = (tf.rotation + 90) % 360;       break;
          case 'flip-x':  tf.flipX    = !tf.flipX;                       break;
          case 'flip-y':  tf.flipY    = !tf.flipY;                       break;
        }

        updateTfBtnStates(slot);
        rebuildImage(slot);
        scheduleAutoGenerate();
      });
    });
  });
}

/** Highlight the flip buttons when their state is active. */
function updateTfBtnStates(slot) {
  const zone = document.getElementById(`drop-${slot}`);
  if (!zone) return;
  const tf = state.transforms[slot];
  zone.querySelectorAll('.tf-btn').forEach(btn => {
    if (btn.dataset.tf === 'flip-x') btn.classList.toggle('active', tf.flipX);
    if (btn.dataset.tf === 'flip-y') btn.classList.toggle('active', tf.flipY);
  });
}

// ─────────────────────────────────────────────────────────────
// Image Transform
// ─────────────────────────────────────────────────────────────

/**
 * Render `src` (ImageBitmap) into a canvas at its native resolution with
 * rotation + flip applied.
 *
 * When rotating 90°/270°, the output canvas dimensions are swapped so the
 * image fills without cropping or stretching.
 */
function applyTransform(src, { rotation, flipX, flipY }) {
  const swapped = rotation % 180 !== 0;
  const outW    = swapped ? src.height : src.width;
  const outH    = swapped ? src.width  : src.height;
  const out     = document.createElement('canvas');
  out.width  = outW;
  out.height = outH;
  const ctx  = out.getContext('2d');

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  if (flipX) ctx.scale(-1,  1);
  if (flipY) ctx.scale( 1, -1);
  ctx.drawImage(src, -src.width / 2, -src.height / 2, src.width, src.height);
  ctx.restore();
  return out;
}

/**
 * Re-apply the current transform for `slot` and refresh the background canvas.
 * Called on first upload and whenever a transform button is pressed.
 */
function rebuildImage(slot) {
  const src = state.originals[slot];
  if (!src) return;
  const canvas = applyTransform(src, state.transforms[slot]);
  state.images[slot] = canvas;
  updateDropzoneBg(slot, canvas);
}

/**
 * Draw the 256×256 transformed canvas into the .dz-bg element.
 * Visibility is controlled by CSS via the `.has-image` class.
 */
function updateDropzoneBg(slot, imgCanvas) {
  const zone = document.getElementById(`drop-${slot}`);
  if (!zone) return;
  const bg = zone.querySelector('.dz-bg');
  if (!bg) return;

  // Use the image's native dimensions; CSS `width:100%; height:100%` scales it to fit.
  bg.width  = imgCanvas.width;
  bg.height = imgCanvas.height;
  bg.getContext('2d').drawImage(imgCanvas, 0, 0);

  // Adding this class triggers the CSS transition (opacity 0 → 0.38)
  // and also reveals the transform controls bar.
  zone.classList.add('has-image');
}

// ─────────────────────────────────────────────────────────────
// Callback from uploader
// ─────────────────────────────────────────────────────────────

function onImageLoaded(slot, bitmap) {
  state.originals[slot] = bitmap;
  rebuildImage(slot);
  scheduleAutoGenerate();
}

// ─────────────────────────────────────────────────────────────
// Auto-generate (debounced 300 ms)
// ─────────────────────────────────────────────────────────────

let genTimer = null;

function scheduleAutoGenerate() {
  clearTimeout(genTimer);
  genTimer = setTimeout(doGenerate, 300);
}

function doGenerate() {
  // Always re-render the adjacency preview (shows placeholder when no images)
  renderPreview(state);
  applyZoom('preview');

  // Tilemap re-renders whenever state changes (algorithm / tileSize / images)
  renderTilemap(state);
  syncWrapHeight('tilemap-canvas', '.tilemap-canvas-wrap', 380);

  // Only generate + show export buttons when at least one image is loaded
  if (!SLOTS.some(s => state.images[s])) return;

  try {
    state.result = generate(state);
    const exportPanel = document.getElementById('export-panel');
    if (exportPanel) exportPanel.hidden = false;
  } catch (err) {
    console.error('[generate]', err);
  }
}

// ─────────────────────────────────────────────────────────────
// Export Buttons (index.html only)
// ─────────────────────────────────────────────────────────────

function initExportButtons() {
  const btnPNG   = document.getElementById('export-png');
  const btnUnity = document.getElementById('export-unity');
  if (!btnPNG && !btnUnity) return;

  if (btnPNG) {
    btnPNG.addEventListener('click', () => {
      if (state.result) exportPNG(state.result.canvas, `${state.tilesetName}-${state.algorithm}.png`);
    });
  }
  if (btnUnity) {
    btnUnity.addEventListener('click', () => {
      if (state.result)
        exportUnityPackage(state.result.canvas, state.result.tiles, state.tileSize, state.algorithm, state.tilesetName)
          .catch(err => console.error('[exportUnityPackage]', err));
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Zoom Controls (index.html only)
// ─────────────────────────────────────────────────────────────

function initZoomControls() {
  wireZoom('preview');
  wireZoom('tilemap');
}

function wireZoom(key) {
  const inBtn    = document.getElementById(`${key}-zoom-in`);
  const outBtn   = document.getElementById(`${key}-zoom-out`);
  const resetBtn = document.getElementById(`${key}-zoom-reset`);
  if (!inBtn) return;

  inBtn.addEventListener('click', () => {
    zoom[key] = Math.min(ZOOM_MAX, zoom[key] + 1);
    applyZoom(key);
  });
  outBtn.addEventListener('click', () => {
    zoom[key] = Math.max(ZOOM_MIN, zoom[key] - 1);
    applyZoom(key);
  });
  resetBtn.addEventListener('click', () => {
    zoom[key] = 1;
    applyZoom(key);
  });
}

/**
 * Lock a canvas-wrap's height to the canvas's natural pixel height (+ 2×1rem padding),
 * capped at maxH. Called after each render so zoom scales within a stable block.
 */
function syncWrapHeight(canvasId, wrapSelector, maxH) {
  const canvas = document.getElementById(canvasId);
  const wrap   = canvas?.closest(wrapSelector);
  if (canvas && wrap) {
    wrap.style.height = Math.min(canvas.height + 32, maxH) + 'px';
  }
}

/**
 * Scale a canvas's CSS display size by the current zoom level.
 * The canvas's backing pixels are unchanged; only the rendered size changes.
 * `image-rendering: pixelated` (set in CSS) keeps tiles crisp.
 */
function applyZoom(key) {
  const canvas = document.getElementById(`${key}-canvas`);
  const label  = document.getElementById(`${key}-zoom-label`);
  const z      = zoom[key];
  if (canvas) {
    canvas.style.width  = canvas.width  * z + 'px';
    canvas.style.height = canvas.height * z + 'px';
  }
  if (label) label.textContent = z + '×';
}

// ─────────────────────────────────────────────────────────────
// Preview Hover — Adjacency Tooltip
// ─────────────────────────────────────────────────────────────

function initSpritesheetHover() {
  const canvas  = document.getElementById('preview-canvas');
  const tooltip = document.getElementById('tile-tooltip');
  const ttLabel = document.getElementById('tt-label');
  if (!canvas || !tooltip) return;

  canvas.addEventListener('mousemove', e => {
    if (!state.result) { tooltip.hidden = true; return; }

    const { tiles, algorithm } = state.result;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top)  * scaleY;

    // Tile grid starts at (PAD + DISPLAY_TS + CP_GAP, PAD + LABEL_H) in the preview
    const gridOffsetX = PREVIEW_PAD + PREVIEW_DISPLAY_TS + PREVIEW_CP_GAP;
    const gridOffsetY = PREVIEW_PAD + PREVIEW_LABEL_H;
    const ts   = PREVIEW_DISPLAY_TS;
    const cols = previewGridCols(algorithm);

    const tileX = px - gridOffsetX;
    const tileY = py - gridOffsetY;
    if (tileX < 0 || tileY < 0) { tooltip.hidden = true; return; }

    const tileCol = Math.floor(tileX / ts);
    const tileRow = Math.floor(tileY / ts);
    if (tileCol >= cols || tileRow >= PREVIEW_GRID_ROWS) { tooltip.hidden = true; return; }

    const tile = tiles[tileRow * cols + tileCol];
    if (!tile) { tooltip.hidden = true; return; }

    // Decode cardinal + diagonal bits
    const bm4 = tile.bitmask4 ?? tile.bitmask ?? 0;
    const bm8 = tile.bitmask8 ?? 0;
    const hasN  = !!(bm4 & 0x1),  hasE  = !!(bm4 & 0x2);
    const hasS  = !!(bm4 & 0x4),  hasW  = !!(bm4 & 0x8);
    const hasNE = !!(bm8 & 0x02), hasSE = !!(bm8 & 0x08);
    const hasSW = !!(bm8 & 0x20), hasNW = !!(bm8 & 0x80);
    const is47  = algorithm === '47';

    const posMap = { n: hasN, e: hasE, s: hasS, w: hasW,
                     ne: hasNE, se: hasSE, sw: hasSW, nw: hasNW };

    tooltip.querySelectorAll('[data-pos]').forEach(cell => {
      const pos    = cell.dataset.pos;
      const isDiag = ['ne', 'se', 'sw', 'nw'].includes(pos);
      cell.className = 'tt-cell';
      if (!is47 && isDiag) { cell.classList.add('tt-dc'); }
      else if (posMap[pos]) { cell.classList.add('filled'); }
    });

    ttLabel.textContent = tile.label ?? `tile-${tile.id}`;
    tooltip.hidden = false;

    // Position tooltip near the cursor, keeping it inside the viewport
    const tx = e.clientX + 14;
    const ty = e.clientY - 10;
    const tw = 96, th = 86;
    tooltip.style.left = Math.min(tx, window.innerWidth  - tw - 8) + 'px';
    tooltip.style.top  = Math.min(ty, window.innerHeight - th - 8) + 'px';
  });

  canvas.addEventListener('mouseleave', () => { tooltip.hidden = true; });
}

// ─────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────

boot().catch(err => console.error('[boot]', err));
