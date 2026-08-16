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
  // The sheet panel is the common ancestor of the header row (title +
  // chips) and the source list, so the font setting is applied there as
  // data-font and inherits down via the --sheet-font custom property.
  const sheetPanel = sheetEl.closest('.panel--sheet') || sheetEl;
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

  // בס"ד / Hashem-prefix dropdown — button + small menu. The menu is
  // position: fixed and we compute coordinates relative to the button
  // because the surrounding .panel has overflow: hidden which would
  // otherwise clip an absolute-positioned dropdown.
  if (headerRightButton && headerRightMenu) {
    const openMenu = () => {
      const rect = headerRightButton.getBoundingClientRect();
      headerRightMenu.style.top  = `${rect.bottom + 4}px`;
      headerRightMenu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      headerRightMenu.style.left  = 'auto';
      headerRightMenu.hidden = false;
    };
    const closeMenu = () => { headerRightMenu.hidden = true; };

    headerRightButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (headerRightMenu.hidden) openMenu();
      else closeMenu();
    });
    document.addEventListener('click', (e) => {
      if (!headerRightMenu.contains(e.target) && e.target !== headerRightButton) {
        closeMenu();
      }
    });
    window.addEventListener('resize',  closeMenu);
    window.addEventListener('scroll',  closeMenu, true);
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
      closeMenu();
    });
  }

  if (headerLeftInput) {
    const pushL = debounce((v) => sheet.setHeader('left', v), 150);
    headerLeftInput.addEventListener('input', () => pushL(headerLeftInput.value));
  }

  // Live copy of the kinnui setting. Card listeners are wired once, when
  // the card DOM is created, so they must read the *current* value rather
  // than one captured at creation time.
  let useKinnuiNow = true;

  // sourceId -> { li, numberEl, titleEl, textEl, badge, source,
  //               renderedTitle, renderedText }
  // The cards are reconciled in place (see reconcileList) instead of being
  // rebuilt from scratch: rebuilding destroyed the contenteditable node the
  // user was typing into — the debounced push fired ~200ms after a keypress,
  // the model emitted, render() wiped the list and focus was lost mid-word.
  const cardCache = new Map();

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
    sheetPanel.dataset.font = s.font || 'Frank Ruhl Libre';
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

    useKinnuiNow = !!s.replaceHashemName;
    reconcileList(snapshot.sources, useKinnuiNow);

    metaSpan.textContent = buildMeta(snapshot);
  }

  /**
   * Keyed reconciliation: reuse the existing <li> for each source id,
   * update only what changed, and never touch a field the user is
   * currently editing. Order is fixed up with insertBefore.
   */
  function reconcileList(sources, useKinnui) {
    const seen = new Set();
    let cursor = listEl.firstChild;

    sources.forEach((source, idx) => {
      seen.add(source.id);
      let entry = cardCache.get(source.id);
      if (!entry) {
        entry = createCard(source);
        cardCache.set(source.id, entry);
      }
      entry.source = source;
      updateCard(entry, source, idx + 1, useKinnui);

      if (cursor === entry.li) {
        cursor = cursor.nextSibling;
      } else {
        listEl.insertBefore(entry.li, cursor);
      }
    });

    for (const [id, entry] of cardCache) {
      if (!seen.has(id)) {
        entry.li.remove();
        cardCache.delete(id);
      }
    }
  }

  const isEditing = (node) => node === document.activeElement || node.contains(document.activeElement);

  function updateCard(entry, source, number, useKinnui) {
    entry.numberEl.textContent = `${number}.`;

    const isCustom = source.type === 'custom';
    entry.badge.title = isCustom ? 'מקור עצמאי' : (source.sefariaRef || 'ספריא');

    const title = source.title || '';
    if (title !== entry.renderedTitle && !isEditing(entry.titleEl)) {
      entry.titleEl.textContent = title;
      entry.renderedTitle = title;
    }

    const text = useKinnui ? applyHashemKinnui(source.text || '') : (source.text || '');
    if (text !== entry.renderedText && !isEditing(entry.textEl)) {
      entry.textEl.textContent = text;
      entry.renderedText = text;
    }
  }

  function buildMeta(snapshot) {
    const count = snapshot.sources.length;
    const updated = snapshot.updatedAt ? formatDate(snapshot.updatedAt) : '';
    const parts = [];
    parts.push(count === 0 ? 'אין מקורות' : `${count} מקורות`);
    if (updated) parts.push(`עודכן ${updated}`);
    return parts.join(' • ');
  }

  /**
   * Build the DOM for one source card and wire its listeners. Called once
   * per source — subsequent model changes go through updateCard.
   * `entry` is filled in below and handed back to the cache.
   */
  function createCard(source) {
    const entry = { source };
    const isCustom = source.type === 'custom';

    const dragHandle = el('span', {
      class: 'source-card__drag',
      title: 'גרור לשינוי סדר',
      'aria-label': 'גרור לשינוי סדר',
      text: '⋮⋮',
    });
    const numberEl = el('span', { class: 'source-card__number', text: '' });
    const titleEl = el('div', {
      class: 'source-card__title mixed-content',
      contenteditable: 'true',
      spellcheck: 'false',
      'data-placeholder': 'מראה מקום / כותרת',
      text: '',
    });
    const pushTitle = debounce(() => {
      const v = titleEl.textContent.trim();
      entry.renderedTitle = v;
      sheet.updateSource(source.id, { title: v });
    }, 200);
    titleEl.addEventListener('input', pushTitle);
    titleEl.addEventListener('blur', () => {
      pushTitle.cancel();
      const v = titleEl.textContent.trim();
      entry.renderedTitle = v;
      sheet.updateSource(source.id, { title: v });
    });

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
      text: '',
    });

    const pushText = debounce(() => {
      const v = textEl.innerText;
      // Mark what the field already shows so the re-render triggered by
      // this very update doesn't rewrite it under the caret.
      entry.renderedText = useKinnuiNow ? applyHashemKinnui(v) : v;
      sheet.updateSource(source.id, { text: v });
    }, 200);
    textEl.addEventListener('input', pushText);

    // While the kinnui toggle is on we show the dashed form in the editable
    // area. To let the user edit the canonical text, swap to the original on
    // focus and re-apply the kinnui on blur.
    const showCanonical = () => {
      if (!useKinnuiNow) return;
      const canonical = entry.source.text || '';
      if (textEl.innerText === canonical) return;
      textEl.textContent = canonical;
      entry.renderedText = canonical;
    };
    // pointerdown runs *before* the browser places the caret, so swapping
    // here keeps the click landing where the user aimed. The focus handler
    // stays as the fallback for keyboard (Tab) focus.
    textEl.addEventListener('pointerdown', showCanonical);
    textEl.addEventListener('focus', showCanonical);
    textEl.addEventListener('blur', () => {
      pushText.cancel();
      const v = textEl.innerText;
      const shown = useKinnuiNow ? applyHashemKinnui(v) : v;
      if (textEl.innerText !== shown) textEl.textContent = shown;
      entry.renderedText = shown;
      sheet.updateSource(source.id, { text: v });
    });

    const li = el('li', {
      class: 'source-card',
      dataset: { sourceId: source.id },
    }, [head, textEl]);
    wireDragAndDrop(li, source.id, dragHandle);

    Object.assign(entry, {
      li, numberEl, titleEl, textEl, badge,
      renderedTitle: '', renderedText: '',
    });
    return entry;
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
