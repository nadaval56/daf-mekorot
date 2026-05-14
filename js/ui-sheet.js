// js/ui-sheet.js
// Right panel: the source sheet — renders cards, wires inline editing,
// and exposes a render(snapshot) function called whenever the model changes.

import { $, el, debounce, formatDate } from './utils.js';

export function initSheetUI({ sheet, showToast }) {
  const titleInput = $('[data-role="sheet-title"]');
  const metaSpan = $('[data-role="sheet-meta"]');
  const sheetEl = $('[data-role="sheet"]');
  const listEl = $('[data-role="source-list"]');
  const emptyEl = $('[data-role="sheet-empty"]');

  // Sheet title — push edits into the model after a short debounce.
  const pushTitle = debounce((val) => sheet.setTitle(val), 150);
  titleInput.addEventListener('input', () => pushTitle(titleInput.value));

  function render(snapshot) {
    // Title (only update if user isn't actively editing this field).
    if (document.activeElement !== titleInput) {
      titleInput.value = snapshot.title || '';
    }

    // Print-time title is read from data-print-title via CSS ::before.
    sheetEl.dataset.printTitle = snapshot.title || 'דף מקורות';

    // Apply settings as data attributes for CSS hooks.
    const s = snapshot.settings || {};
    sheetEl.dataset.font = s.font || 'Frank Ruhl Libre';
    sheetEl.dataset.fontSize = String(s.fontSize || 14);
    sheetEl.dataset.showNumbering = String(s.showNumbering !== false);
    sheetEl.dataset.showDividers = String(s.showDividers !== false);
    sheetEl.dataset.margins = s.margins || 'normal';
    sheetEl.dataset.printMode = s.printMode || 'color';
    sheetEl.style.setProperty('--sheet-font-size', `${s.fontSize || 14}pt`);

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

    const numberEl = el('span', { class: 'source-card__number', text: `${number}.` });
    const titleEl = el('div', {
      class: 'source-card__title mixed-content',
      contenteditable: 'true',
      spellcheck: 'false',
      'data-placeholder': 'מראה מקום / כותרת',
      text: source.title || '',
    });
    // contenteditable doesn't expose value events; sync on blur + input.
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

    const head = el('div', { class: 'source-card__head' }, [numberEl, titleEl, badge, actions]);

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

    return el('li', { class: 'source-card', dataset: { sourceId: source.id } }, [head, textEl]);
  }

  return { render };
}
