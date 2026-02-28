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
import { renderPreview }  from './preview.js';
import { generate }       from './tilegen.js';
import { exportPNG, exportUnityPackage } from './exporter.js';

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

// Zoom levels per canvas — persists across re-renders
const zoom = {
  preview:     ZOOM_DEFAULT,
  spritesheet: ZOOM_DEFAULT,
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

  // Only generate + show the full spritesheet when at least one image is loaded
  if (!SLOTS.some(s => state.images[s])) return;

  try {
    state.result = generate(state);
    renderSpritesheet(state.result.canvas);
    applyZoom('spritesheet');
    const panel = document.getElementById('export-panel');
    if (panel) panel.hidden = false;
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
  wireZoom('spritesheet');
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
 * Scale a canvas's CSS display size by the current zoom level for `key`.
 * The canvas's backing pixels are unchanged; only the rendered size changes.
 * `image-rendering: pixelated` (set in CSS) keeps tiles crisp.
 *
 * @param {'preview'|'spritesheet'} key
 */
function applyZoom(key) {
  const canvasId = key === 'preview' ? 'preview-canvas' : 'spritesheet-canvas';
  const labelId  = `${key}-zoom-label`;
  const canvas   = document.getElementById(canvasId);
  const label    = document.getElementById(labelId);
  const z        = zoom[key];
  if (canvas) {
    canvas.style.width  = canvas.width  * z + 'px';
    canvas.style.height = canvas.height * z + 'px';
  }
  if (label) label.textContent = z + '×';
}

// ─────────────────────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────────────────────

function renderSpritesheet(srcCanvas) {
  const out = document.getElementById('spritesheet-canvas');
  if (!out) return;
  out.width  = srcCanvas.width;
  out.height = srcCanvas.height;
  out.getContext('2d').drawImage(srcCanvas, 0, 0);
}

// ─────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────

boot().catch(err => console.error('[boot]', err));
