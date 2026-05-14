// js/ui-sheet.js
// Right panel: the source sheet — renders cards, wires inline editing,
// and exposes a render(snapshot) function called whenever the model changes.

import { $, el, debounce, formatDate } from './utils.js';

export function initSheetUI({ sheet, showToast }) {
  const titleInput = $('[data-role="sheet-title"]');
  const headerRightInput = $('[data-role="sheet-header-right"]');
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

  if (headerRightInput) {
    const pushR = debounce((v) => sheet.setHeader('right', v), 150);
    headerRightInput.addEventListener('input', () => pushR(headerRightInput.value));
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
    if (headerRightInput && document.activeElement !== headerRightInput) {
      headerRightInput.value = snapshot.headerRight ?? '';
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
    sheetEl.dataset.printMode = s.printMode || 'color';
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

    // Print-only header row (בס"ד / date) — visible only in @media print.
    let printHead = sheetEl.querySelector('.sheet__print-header');
    if (!printHead) {
      printHead = document.createElement('div');
      printHead.className = 'sheet__print-header';
      printHead.innerHTML = '<span class="sheet__print-header-right"></span><span class="sheet__print-header-left"></span>';
      sheetEl.insertBefore(printHead, sheetEl.firstChild);
    }
    printHead.firstChild.textContent = snapshot.headerRight || '';
    printHead.lastChild.textContent = snapshot.headerLeft || '';

    // Empty state vs source list.
    const hasSources = snapshot.sources.length > 0;
    emptyEl.hidden = hasSources;
    listEl.hidden = !hasSources;

    listEl.innerHTML = '';
    snapshot.sources.forEach((source, idx) => {
      listEl.appendChild(renderCard(source, idx + 1));
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

  function renderCard(source, number) {
    const isCustom = source.type === 'custom';

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
        if (confirm('למחוק את המקור?')) {
          sheet.removeSource(source.id);
          showToast('המקור נמחק.');
        }
      },
    });

    const actions = el('div', { class: 'source-card__actions' }, [upBtn, downBtn, delBtn]);

    const head = el('div', { class: 'source-card__head' }, [dragHandle, numberEl, titleEl, badge, actions]);

    const textEl = el('div', {
      class: 'source-card__text mixed-content',
      contenteditable: 'true',
      spellcheck: 'false',
      'data-placeholder': isCustom ? 'הכנס את הטקסט כאן…' : 'טקסט המקור',
      text: source.text || '',
    });
    const pushText = debounce(() => {
      sheet.updateSource(source.id, { text: textEl.innerText });
    }, 200);
    textEl.addEventListener('input', pushText);

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
