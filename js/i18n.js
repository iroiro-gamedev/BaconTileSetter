/**
 * i18n.js — Minimal internationalization module
 *
 * Usage:
 *   await loadLang('en')
 *   t('uploader.main')         // → "Main"
 *   applyTranslations()        // updates all [data-i18n] elements
 */

let _dict = {};
let _lang = 'en';

/**
 * Fetch and activate a language dictionary.
 * Falls back to English if the requested language file fails.
 */
export async function loadLang(lang) {
  try {
    const res = await fetch(`i18n/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _dict = await res.json();
    _lang = lang;
    document.documentElement.lang = lang;
    localStorage.setItem('bts-lang', lang);
  } catch (err) {
    console.warn(`[i18n] Failed to load lang "${lang}", falling back to en.`, err);
    if (lang !== 'en') {
      // Load English as a session fallback WITHOUT overwriting the stored preference.
      // This ensures the user's language choice (e.g. 'zh') is preserved across navigation.
      try {
        const r = await fetch('i18n/en.json');
        if (r.ok) {
          _dict = await r.json();
          _lang = 'en';
          document.documentElement.lang = 'en';
        }
      } catch {}
    }
  }
}

/**
 * Translate a key. Returns the key itself if not found.
 */
export function t(key) {
  return _dict[key] ?? key;
}

/**
 * Walk the DOM and replace textContent of all [data-i18n] elements.
 * Also updates [data-i18n-placeholder] for inputs.
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key in _dict) el.textContent = _dict[key];
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key in _dict) el.placeholder = _dict[key];
  });
  root.querySelectorAll('option[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key in _dict) el.textContent = _dict[key];
  });
}

/**
 * Detect the preferred language from localStorage, then browser.
 * Returns 'en', 'ja', or 'zh'.
 */
export function detectLang() {
  const stored = localStorage.getItem('bts-lang');
  if (stored && ['en', 'ja', 'zh'].includes(stored)) return stored;
  return 'en';
}
