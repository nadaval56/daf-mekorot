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
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80).trim() || 'daf-mekorot';
}
