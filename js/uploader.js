/**
 * uploader.js — Image upload via click and drag & drop.
 *
 * HTML structure (per slot):
 *   <div class="dropzone" id="drop-SLOT">       ← drag target (this module)
 *     <label class="dz-click" for="file-SLOT">  ← click-to-open (browser-native)
 *       <canvas class="dz-bg" hidden></canvas>
 *       …
 *     </label>
 *     <div class="dz-controls">…</div>
 *     <input type="file" id="file-SLOT" hidden>  ← change event (this module)
 *   </div>
 *
 * The <label for="…"> handles click → file dialog natively (no JS needed).
 * This module only needs to:
 *   1. Listen to input `change` to process the selected file.
 *   2. Attach drag events to the outer <div> for drop support.
 */

const SLOTS = ['main', 'top', 'bottom', 'left', 'right'];

/**
 * Initialize all 5 dropzones.
 * @param {function(slot: string, img: ImageBitmap): void} onImageLoaded
 */
export function initUploaders(onImageLoaded) {
  SLOTS.forEach(slot => {
    const zone  = document.getElementById(`drop-${slot}`);
    if (!zone) return;

    const input = zone.querySelector('input[type="file"]');
    if (!input) return;

    // ── File selected via OS dialog ──────────────────────────
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) {
        await loadFile(slot, file, onImageLoaded);
        // Reset so same file can be re-selected later
        input.value = '';
      }
    });

    // ── Drag & drop ──────────────────────────────────────────

    zone.addEventListener('dragenter', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    // dragover must call preventDefault to allow drop
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    // Only remove highlight when cursor truly leaves the zone,
    // not when it moves over a child element.
    zone.addEventListener('dragleave', e => {
      if (zone.contains(e.relatedTarget)) return;
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');

      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        await loadFile(slot, file, onImageLoaded);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────

async function loadFile(slot, file, callback) {
  try {
    const bitmap = await createImageBitmap(file);
    callback(slot, bitmap);
  } catch (err) {
    console.error(`[uploader] Failed to load image for slot "${slot}":`, err);
  }
}
