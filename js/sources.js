// js/sources.js
// In-memory model + CRUD for the source sheet under construction.
// All mutations go through here. The model emits 'change' events so the
// UI layer can re-render without reaching into internals.

import { uid } from './utils.js';

const DEFAULT_SETTINGS = Object.freeze({
  font: 'Frank Ruhl Libre',
  fontSize: 14,
  showNumbering: true,
  showDividers: true,
  margins: 'normal',
  printMode: 'color',
});

export function defaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function createEmptySheet() {
  const now = Date.now();
  return {
    id: `sheet_${now}_${Math.random().toString(36).slice(2, 6)}`,
    title: '',
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    sources: [],
  };
}

/**
 * Sheet — small reactive wrapper. Subscribers receive a snapshot on
 * every mutation. We keep the API explicit (add/update/remove/move)
 * rather than letting callers mutate the underlying object.
 */
export class Sheet {
  constructor(initial) {
    this.state = normalize(initial || createEmptySheet());
    this.listeners = new Set();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    this.state.updatedAt = Date.now();
    const snap = this.snapshot();
    for (const fn of this.listeners) {
      try { fn(snap); } catch (err) { console.error('[sheet listener]', err); }
    }
  }

  /* ---------- mutations ---------- */

  setTitle(title) {
    this.state.title = String(title || '');
    this._emit();
  }

  updateSettings(partial) {
    this.state.settings = { ...this.state.settings, ...(partial || {}) };
    this._emit();
  }

  /**
   * Replace the entire sheet (used when loading from storage / library).
   * Caller is responsible for the new shape; we normalize defensively.
   */
  replace(sheet) {
    this.state = normalize(sheet || createEmptySheet());
    this._emit();
  }

  reset() {
    this.state = createEmptySheet();
    this._emit();
  }

  /* ---------- sources CRUD ---------- */

  addSefariaSource({ title, text, sefariaRef, sefariaHeRef, originalText }) {
    const source = {
      id: uid('source'),
      type: 'sefaria',
      title: String(title || ''),
      text: String(text || ''),
      sefariaRef: sefariaRef || '',
      sefariaHeRef: sefariaHeRef || '',
      originalText: originalText ?? text ?? '',
      hasBeenEdited: false,
    };
    this.state.sources.push(source);
    this._emit();
    return source.id;
  }

  addCustomSource({ title = '', text = '' } = {}) {
    const source = {
      id: uid('source'),
      type: 'custom',
      title: String(title),
      text: String(text),
    };
    this.state.sources.push(source);
    this._emit();
    return source.id;
  }

  updateSource(id, patch) {
    const src = this.state.sources.find((s) => s.id === id);
    if (!src) return false;
    const next = { ...src, ...patch };
    // Track edits on Sefaria-sourced text so we can show an indicator
    // and (in later phases) offer a "revert to original".
    if (src.type === 'sefaria' && patch && 'text' in patch) {
      next.hasBeenEdited = patch.text !== (src.originalText ?? src.text);
    }
    Object.assign(src, next);
    this._emit();
    return true;
  }

  removeSource(id) {
    const idx = this.state.sources.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.state.sources.splice(idx, 1);
    this._emit();
    return true;
  }

  moveSource(id, direction) {
    const sources = this.state.sources;
    const idx = sources.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    const target = idx + (direction === 'up' ? -1 : 1);
    if (target < 0 || target >= sources.length) return false;
    const [item] = sources.splice(idx, 1);
    sources.splice(target, 0, item);
    this._emit();
    return true;
  }
}

/** Normalize a possibly-partial sheet object loaded from storage. */
function normalize(sheet) {
  const base = createEmptySheet();
  const out = { ...base, ...(sheet || {}) };
  out.settings = { ...defaultSettings(), ...(sheet?.settings || {}) };
  out.sources = Array.isArray(sheet?.sources)
    ? sheet.sources.map((s) => ({ ...s, id: s.id || uid('source') }))
    : [];
  out.id = out.id || base.id;
  out.createdAt = out.createdAt || base.createdAt;
  out.updatedAt = out.updatedAt || base.updatedAt;
  out.title = typeof out.title === 'string' ? out.title : '';
  return out;
}
