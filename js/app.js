// js/app.js
// Entry point. Wires the model (Sheet), the panels (browser + sheet UI),
// the storage layer (auto-save + library), and the header actions.

import { $, $$, el, debounce, formatDate, truncate } from './utils.js';
import {
  loadActiveDraft, saveActiveDraft, clearActiveDraft,
  loadSavedSheets, saveSheetToLibrary, deleteSavedSheet, duplicateSavedSheet,
  loadUserSettings, saveUserSettings,
} from './storage.js';
import { Sheet, createEmptySheet, defaultSettings } from './sources.js';
import { initBrowser } from './ui-browser.js';
import { initSheetUI } from './ui-sheet.js';
import { printSheet } from './export.js';

/* -------------------- Toast -------------------- */

const toastEl = $('[data-role="toast"]');
let toastTimer = null;
function showToast(message, type = 'info') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.dataset.type = type;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
}

/* -------------------- Model + persistence -------------------- */

// Merge user defaults into a freshly-loaded draft, or build an empty sheet.
const userDefaults = loadUserSettings();
const initial = loadActiveDraft() || (() => {
  const s = createEmptySheet();
  if (userDefaults) {
    s.settings = { ...s.settings, ...userDefaults };
  }
  return s;
})();

const sheet = new Sheet(initial);

const persist = debounce((snapshot) => saveActiveDraft(snapshot), 300);
sheet.subscribe(persist);

/* -------------------- UI wiring -------------------- */

const sheetUI = initSheetUI({ sheet, showToast });
const browser = initBrowser({
  showToast,
  onAddSource: ({ title, text, sefariaRef, sefariaHeRef }) => {
    sheet.addSefariaSource({
      title,
      text,
      sefariaRef,
      sefariaHeRef,
      originalText: text,
    });
  },
});

// Re-render whenever the model changes.
sheet.subscribe((snap) => sheetUI.render(snap));
sheetUI.render(sheet.snapshot());

/* -------------------- Header actions -------------------- */

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  switch (action) {
    case 'new-sheet':       handleNewSheet(); break;
    case 'add-custom':      handleAddCustom(); break;
    case 'save-sheet':      handleSaveSheet(); break;
    case 'open-library':    openLibrary(); break;
    case 'close-library':   closeLibrary(); break;
    case 'open-settings':   openSettings(); break;
    case 'close-settings':  closeSettings(); break;
    case 'export-print':    printSheet(); break;
  }
});

function handleNewSheet() {
  const hasContent = sheet.snapshot().sources.length > 0 || sheet.snapshot().title;
  if (hasContent && !confirm('להתחיל דף חדש? הטיוטה הנוכחית תוחלף. (שמור בספרייה אם חשוב לשמור.)')) {
    return;
  }
  clearActiveDraft();
  const empty = createEmptySheet();
  empty.settings = { ...empty.settings, ...(loadUserSettings() || {}) };
  sheet.replace(empty);
  showToast('דף חדש מוכן.');
}

function handleAddCustom() {
  sheet.addCustomSource({ title: '', text: '' });
  // Scroll to and focus the newest card so the user can start typing.
  requestAnimationFrame(() => {
    const cards = $$('.source-card');
    const last = cards[cards.length - 1];
    if (last) {
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
      last.querySelector('.source-card__title')?.focus();
    }
  });
}

function handleSaveSheet() {
  const snap = sheet.snapshot();
  if (!snap.title?.trim()) {
    const name = prompt('שם הדף:', 'דף ללא שם');
    if (name == null) return;
    sheet.setTitle(name.trim() || 'דף ללא שם');
  }
  saveSheetToLibrary(sheet.snapshot());
  showToast('הדף נשמר בספרייה.');
}

/* -------------------- Library modal -------------------- */

const libraryModal = $('[data-role="library-modal"]');
const libraryList = $('[data-role="library-list"]');
const libraryEmpty = $('[data-role="library-empty"]');

function openLibrary() {
  renderLibrary();
  if (typeof libraryModal.showModal === 'function') libraryModal.showModal();
  else libraryModal.setAttribute('open', '');
}
function closeLibrary() {
  if (typeof libraryModal.close === 'function') libraryModal.close();
  else libraryModal.removeAttribute('open');
}

function renderLibrary() {
  const sheets = loadSavedSheets();
  libraryList.innerHTML = '';
  libraryEmpty.hidden = sheets.length > 0;
  for (const s of sheets) {
    const title = el('div', { class: 'library__title mixed-content', text: s.title || 'דף ללא שם' });
    const date = el('div', { class: 'library__date', text: formatDate(s.updatedAt || s.createdAt) });
    const meta = el('div', {}, [title, date]);

    const openBtn = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--small',
      text: '📂 פתח',
      onclick: () => {
        sheet.replace(s);
        showToast(`נטען: ${truncate(s.title || 'דף ללא שם', 40)}`);
        closeLibrary();
      },
    });
    const dupBtn = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--small',
      text: '📋 שכפל',
      onclick: () => {
        duplicateSavedSheet(s.id);
        renderLibrary();
        showToast('שוכפל.');
      },
    });
    const delBtn = el('button', {
      type: 'button',
      class: 'btn btn--danger btn--small',
      text: '🗑 מחק',
      onclick: () => {
        if (confirm(`למחוק את "${s.title || 'דף ללא שם'}" מהספרייה?`)) {
          deleteSavedSheet(s.id);
          renderLibrary();
          showToast('נמחק.');
        }
      },
    });

    const actions = el('div', { class: 'library__actions' }, [openBtn, dupBtn, delBtn]);
    libraryList.appendChild(el('li', {}, [meta, actions]));
  }
}

/* -------------------- Settings modal -------------------- */

const settingsModal = $('[data-role="settings-modal"]');
const fontSel = $('[data-role="setting-font"]');
const fontSizeSel = $('[data-role="setting-font-size"]');
const numberingChk = $('[data-role="setting-numbering"]');
const dividersChk = $('[data-role="setting-dividers"]');
const marginsSel = $('[data-role="setting-margins"]');
const printModeSel = $('[data-role="setting-print-mode"]');

function readSettingsFromForm() {
  return {
    font: fontSel.value,
    fontSize: parseInt(fontSizeSel.value, 10) || 14,
    showNumbering: numberingChk.checked,
    showDividers: dividersChk.checked,
    margins: marginsSel.value,
    printMode: printModeSel.value,
  };
}

function syncSettingsForm(settings) {
  const s = { ...defaultSettings(), ...(settings || {}) };
  fontSel.value = s.font;
  fontSizeSel.value = String(s.fontSize);
  numberingChk.checked = s.showNumbering !== false;
  dividersChk.checked = s.showDividers !== false;
  marginsSel.value = s.margins;
  printModeSel.value = s.printMode;
}

function openSettings() {
  syncSettingsForm(sheet.snapshot().settings);
  if (typeof settingsModal.showModal === 'function') settingsModal.showModal();
  else settingsModal.setAttribute('open', '');
}
function closeSettings() {
  if (typeof settingsModal.close === 'function') settingsModal.close();
  else settingsModal.removeAttribute('open');
}

// Live-apply settings on change (no separate "save" button needed).
for (const ctrl of [fontSel, fontSizeSel, numberingChk, dividersChk, marginsSel, printModeSel]) {
  ctrl.addEventListener('change', () => {
    const next = readSettingsFromForm();
    sheet.updateSettings(next);
    saveUserSettings(next);
  });
}

/* -------------------- Keyboard shortcuts -------------------- */

document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+P → print (let the browser handle it; just ensure our CSS is current).
  // Ctrl/Cmd+S → save to library
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    handleSaveSheet();
  }
});
