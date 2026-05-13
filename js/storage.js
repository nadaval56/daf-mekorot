// js/storage.js
// localStorage layer. One file, all keys, with safe fallbacks.

const KEYS = {
  ACTIVE: 'daf_mekorot_activeDraft',
  SAVED: 'daf_mekorot_savedSheets',
  SETTINGS: 'daf_mekorot_userSettings',
};

function safeGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] failed to read ${key}:`, err);
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
      console.error('[storage] quota exceeded — try removing old sheets.');
    } else {
      console.warn(`[storage] failed to write ${key}:`, err);
    }
    return false;
  }
}

/* -------------------- Active draft -------------------- */

export function loadActiveDraft() {
  return safeGet(KEYS.ACTIVE, null);
}

export function saveActiveDraft(sheet) {
  if (!sheet) return false;
  return safeSet(KEYS.ACTIVE, sheet);
}

export function clearActiveDraft() {
  try { localStorage.removeItem(KEYS.ACTIVE); } catch { /* ignore */ }
}

/* -------------------- Saved sheets library -------------------- */

export function loadSavedSheets() {
  const list = safeGet(KEYS.SAVED, []);
  return Array.isArray(list) ? list : [];
}

export function saveSheetToLibrary(sheet) {
  if (!sheet?.id) return false;
  const list = loadSavedSheets();
  const idx = list.findIndex((s) => s.id === sheet.id);
  const snapshot = { ...sheet, updatedAt: Date.now() };
  if (idx >= 0) list[idx] = snapshot;
  else list.unshift(snapshot);
  return safeSet(KEYS.SAVED, list);
}

export function deleteSavedSheet(id) {
  const list = loadSavedSheets().filter((s) => s.id !== id);
  return safeSet(KEYS.SAVED, list);
}

export function getSavedSheet(id) {
  return loadSavedSheets().find((s) => s.id === id) || null;
}

export function duplicateSavedSheet(id) {
  const original = getSavedSheet(id);
  if (!original) return null;
  const copy = {
    ...structuredClone(original),
    id: `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: `${original.title || 'דף ללא שם'} — עותק`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSheetToLibrary(copy);
  return copy;
}

/* -------------------- User settings -------------------- */

export function loadUserSettings() {
  return safeGet(KEYS.SETTINGS, null);
}

export function saveUserSettings(settings) {
  return safeSet(KEYS.SETTINGS, settings || {});
}

/* -------------------- Misc -------------------- */

export function estimateStorageUsage() {
  let total = 0;
  for (const key of Object.values(KEYS)) {
    try {
      const v = localStorage.getItem(key);
      if (v) total += v.length;
    } catch { /* ignore */ }
  }
  return total; // chars, ~bytes for ASCII; double for UTF-16 in real terms.
}
