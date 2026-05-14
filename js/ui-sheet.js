// js/ui-sheet.js
// Right panel: the source sheet — renders cards, wires inline editing,
// and exposes a render(snapshot) function called whenever the model changes.

import { $, el, debounce, formatDate, applyHashemKinnui } from './utils.js';

export function initSheetUI({ sheet, showToast }) {
  const titleInput = $('[data-role="sheet-title"]');
  const headerRightButton = $('[data-role="sheet-header-right-button"]');
  const headerRightMenu   = $('[data-role="sheet-header-right-menu"]');
  const headerLeftInput  = $('[data-role="sheet-header-left"]');
  const metaSpan = $('[data-role="sheet-meta"]');
  const sheetEl = $('[data-role="sheet"]');
  const listEl = $('[data-role="source-list"]');
  const emptyEl = $('[data-role="sheet-empty"]');

  // Dynamic <style> tag for print-only @page rules that can't be
  // gated by attribute selectors (e.g. page numbers).
  const printStyle = document.createElement('style');
  printStyle.id = 'print-dynamic';
  document.head.appendChild(printStyle);

  // Sheet title — push edits into the model after a short debounce.
  const pushTitle = debounce((val) => sheet.setTitle(val), 150);
  titleInput.addEventListener('input', () => pushTitle(titleInput.value));

  // בס"ד / Hashem-prefix dropdown — button + small menu.
  if (headerRightButton && headerRightMenu) {
    headerRightButton.addEventListener('click', (e) => {
      e.stopPropagation();
      headerRightMenu.hidden = !headerRightMenu.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!headerRightMenu.contains(e.target) && e.target !== headerRightButton) {
        headerRightMenu.hidden = true;
      }
    });
    headerRightMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'custom') {
        const current = sheet.snapshot().headerRight || '';
        const v = window.prompt('הזן טקסט לכותרת הימנית (לדוגמה: ב"ה, לק"י, ב"ה ירושלים…):', current);
        if (v != null) sheet.setHeader('right', v);
      } else if ('value' in btn.dataset) {
        sheet.setHeader('right', btn.dataset.value || '');
      }
      headerRightMenu.hidden = true;
    });
  }

  if (headerLeftInput) {
    const pushL = debounce((v) => sheet.setHeader('left', v), 150);
    headerLeftInput.addEventListener('input', () => pushL(headerLeftInput.value));
  }

  function render(snapshot) {
    // Title (only update if user isn't actively editing this field).
    if (document.activeElement !== titleInput) {
      titleInput.value = snapshot.title || '';
    }
    if (headerRightButton) {
      const v = snapshot.headerRight ?? '';
      headerRightButton.textContent = v || '—';
      headerRightButton.classList.toggle('sheet-header-chip__button--empty', !v);
    }
    if (headerLeftInput && document.activeElement !== headerLeftInput) {
      headerLeftInput.value = snapshot.headerLeft ?? '';
    }

    // Print-time title is read from data-print-title via CSS ::before.
    sheetEl.dataset.printTitle = snapshot.title || 'דף מקורות';
    sheetEl.dataset.printHeaderRight = snapshot.headerRight || '';
    sheetEl.dataset.printHeaderLeft  = snapshot.headerLeft  || '';

    // Apply settings as data attributes for CSS hooks.
    const s = snapshot.settings || {};
    sheetEl.dataset.font = s.font || 'Frank Ruhl Libre';
    sheetEl.dataset.fontSize = String(s.fontSize || 14);
    sheetEl.dataset.showNumbering = String(s.showNumbering !== false);
    sheetEl.dataset.showDividers = String(s.showDividers !== false);
    sheetEl.dataset.margins = s.margins || 'normal';
    sheetEl.dataset.hashemKinnui = String(!!s.replaceHashemName);
    sheetEl.style.setProperty('--sheet-font-size', `${s.fontSize || 14}pt`);

    // Page numbers — inject @page rule dynamically when on.
    printStyle.textContent = s.showPageNumbers
      ? `@media print {
          @page {
            @bottom-center {
              content: counter(page) " / " counter(pages);
              font-family: 'Heebo', sans-serif;
              font-size: 9pt;
              color: #555;
            }
          }
        }`
      : '';

    // Print-only header row (בס"ד / date) — first row in print order.
    let printHead = sheetEl.querySelector('.sheet__print-header');
    if (!printHead) {
      printHead = document.createElement('div');
      printHead.className = 'sheet__print-header';
      printHead.innerHTML = '<span class="sheet__print-header-right"></span><span class="sheet__print-header-left"></span>';
      sheetEl.insertBefore(printHead, sheetEl.firstChild);
    }
    printHead.firstChild.textContent = snapshot.headerRight || '';
    printHead.lastChild.textContent = snapshot.headerLeft || '';

    // Print-only title — sits BELOW the header row, ABOVE the sources.
    let printTitle = sheetEl.querySelector('.sheet__print-title');
    if (!printTitle) {
      printTitle = document.createElement('div');
      printTitle.className = 'sheet__print-title';
      printHead.after(printTitle);
    }
    printTitle.textContent = snapshot.title || 'דף מקורות';

    // Empty state vs source list.
    const hasSources = snapshot.sources.length > 0;
    emptyEl.hidden = hasSources;
    listEl.hidden = !hasSources;

    const useKinnui = !!s.replaceHashemName;
    listEl.innerHTML = '';
    snapshot.sources.forEach((source, idx) => {
      listEl.appendChild(renderCard(source, idx + 1, useKinnui));
    });

    metaSpan.textContent = buildMeta(snapshot);
  }

  function buildMeta(snapshot) {
    const count = snapshot.sources.length;
    const updated = snapshot.updatedAt ? formatDate(snapshot.updatedAt) : '';
    const parts = [];
    parts.push(count === 0 ? 'אין מקורות' : `${count} מקורות`);
    if (updated) parts.push(`עודכן ${updated}`);
    return parts.join(' • ');
  }

  function renderCard(source, number, useKinnui = false) {
    const isCustom = source.type === 'custom';
    const displayText = useKinnui ? applyHashemKinnui(source.text || '') : (source.text || '');

    const dragHandle = el('span', {
      class: 'source-card__drag',
      title: 'גרור לשינוי סדר',
      'aria-label': 'גרור לשינוי סדר',
      text: '⋮⋮',
    });
    const numberEl = el('span', { class: 'source-card__number', text: `${number}.` });
    const titleEl = el('div', {
      class: 'source-card__title mixed-content',
      contenteditable: 'true',
      spellcheck: 'false',
      'data-placeholder': 'מראה מקום / כותרת',
      text: source.title || '',
    });
    const pushTitle = debounce(() => {
      sheet.updateSource(source.id, { title: titleEl.textContent.trim() });
    }, 200);
    titleEl.addEventListener('input', pushTitle);

    const badge = el('span', {
      class: `source-card__badge ${isCustom ? 'source-card__badge--custom' : ''}`,
      text: isCustom ? '✏️ עצמאי' : '📜 ספריא',
      title: isCustom ? 'מקור עצמאי' : (source.sefariaRef || 'ספריא'),
    });

    const upBtn = el('button', {
      type: 'button',
      class: 'icon-btn',
      title: 'הזז למעלה',
      'aria-label': 'הזז למעלה',
      text: '⬆',
      onclick: () => sheet.moveSource(source.id, 'up'),
    });
    const downBtn = el('button', {
      type: 'button',
      class: 'icon-btn',
      title: 'הזז למטה',
      'aria-label': 'הזז למטה',
      text: '⬇',
      onclick: () => sheet.moveSource(source.id, 'down'),
    });
    const delBtn = el('button', {
      type: 'button',
      class: 'icon-btn icon-btn--danger',
      title: 'מחק מקור',
      'aria-label': 'מחק מקור',
      text: '🗑',
      onclick: () => {
        sheet.removeSource(source.id);
        showToast('המקור נמחק.');
      },
    });

    const actions = el('div', { class: 'source-card__actions' }, [upBtn, downBtn, delBtn]);

    const head = el('div', { class: 'source-card__head' }, [dragHandle, numberEl, titleEl, badge, actions]);

    const textEl = el('div', {
      class: 'source-card__text mixed-content',
      contenteditable: 'true',
      spellcheck: 'false',
      'data-placeholder': isCustom ? 'הכנס את הטקסט כאן…' : 'טקסט המקור',
      text: displayText,
    });
    if (useKinnui) {
      // While the kinnui toggle is on we show the dashed form in the
      // editable area. To let the user edit the canonical text, swap
      // to the original on focus and re-apply the kinnui on blur.
      textEl.addEventListener('focus', () => {
        textEl.textContent = source.text || '';
      });
      textEl.addEventListener('blur', () => {
        const v = textEl.innerText;
        sheet.updateSource(source.id, { text: v });
        textEl.textContent = applyHashemKinnui(v);
      });
    } else {
      const pushText = debounce(() => {
        sheet.updateSource(source.id, { text: textEl.innerText });
      }, 200);
      textEl.addEventListener('input', pushText);
    }

    const li = el('li', {
      class: 'source-card',
      dataset: { sourceId: source.id },
    }, [head, textEl]);
    wireDragAndDrop(li, source.id, dragHandle);
    return li;
  }

  /* -------------------- drag & drop reordering -------------------- */

  let draggingId = null;

  function wireDragAndDrop(cardEl, sourceId, handle) {
    // Drags only start from the explicit handle so the editable title /
    // body fields stay click-and-select normally.
    handle.addEventListener('mousedown',  () => { cardEl.draggable = true; });
    handle.addEventListener('touchstart', () => { cardEl.draggable = true; });
    cardEl.addEventListener('mouseup',    () => { cardEl.draggable = false; });
    cardEl.addEventListener('dragend',    () => {
      cardEl.draggable = false;
      cardEl.classList.remove('source-card--dragging');
      listEl.querySelectorAll('.source-card--drop-target').forEach((n) =>
        n.classList.remove('source-card--drop-target'));
      draggingId = null;
    });

    cardEl.addEventListener('dragstart', (e) => {
      draggingId = sourceId;
      cardEl.classList.add('source-card--dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', sourceId); } catch { /* ignore */ }
    });

    cardEl.addEventListener('dragover', (e) => {
      if (!draggingId || draggingId === sourceId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardEl.classList.add('source-card--drop-target');
    });
    cardEl.addEventListener('dragleave', () => {
      cardEl.classList.remove('source-card--drop-target');
    });

    cardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromId = draggingId || e.dataTransfer.getData('text/plain');
      cardEl.classList.remove('source-card--drop-target');
      if (!fromId || fromId === sourceId) return;
      // Compute drop position relative to mouse Y in the target card.
      const rect = cardEl.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      sheet.moveSourceTo(fromId, sourceId, before ? 'before' : 'after');
    });
  }

  return { render };
}
