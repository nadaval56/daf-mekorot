// js/export.js
// Export = browser print, with @media print CSS doing the heavy lifting.
// Kept as its own module so future phases (e.g. server-side PDF, custom
// page sizes) can extend the surface without touching app.js.

export function printSheet() {
  // Give the browser a tick to apply any pending DOM mutations
  // (e.g. user just typed in a card right before printing).
  requestAnimationFrame(() => window.print());
}

/**
 * Export the current sheet as a JSON file. Used by "ייצא קובץ עבודה"
 * (advanced settings — surfaced in later phases).
 */
export function exportSheetAsJSON(sheet) {
  if (!sheet) return;
  const filename = `${sanitizeFilename(sheet.title || 'daf-mekorot')}.json`;
  const blob = new Blob([JSON.stringify(sheet, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parse the text of a previously exported JSON file into a sheet object
 * ready for the library. Throws on anything that isn't a sheet. Only known
 * fields are kept, and the sheet gets a fresh id so an import can never
 * overwrite an existing library entry.
 */
export function parseImportedSheet(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.sources)) {
    throw new Error('not a sheet file');
  }
  const str = (v) => (typeof v === 'string' ? v : '');
  const now = Date.now();
  const sources = data.sources
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      id: `source_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: s.type === 'sefaria' ? 'sefaria' : 'custom',
      title: str(s.title),
      text: str(s.text),
      sefariaRef: str(s.sefariaRef),
      sefariaHeRef: str(s.sefariaHeRef),
      originalText: str(s.originalText),
      hasBeenEdited: !!s.hasBeenEdited,
    }));
  const out = {
    id: `sheet_${now}_${Math.random().toString(36).slice(2, 6)}`,
    title: str(data.title).trim() || 'דף ללא שם',
    createdAt: Number(data.createdAt) || now,
    updatedAt: now,
    settings: data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? { ...data.settings }
      : {},
    sources,
  };
  if (typeof data.headerRight === 'string') out.headerRight = data.headerRight;
  if (typeof data.headerLeft === 'string') out.headerLeft = data.headerLeft;
  return out;
}

function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80).trim() || 'daf-mekorot';
}
