// js/ui-browser.js
// Left panel: Sefaria browser.
// Supports drill-down navigation (book → chapter/daf → verse/segment),
// selection-based partial add, and a related-sources panel under each
// leaf segment (commentaries, midrash, etc., grouped by category).

import { $, el, debounce, truncate, textDepth, buildSubRef, subSectionHeLabel } from './utils.js';
import { cleanSefariaText, flattenSefariaText, formatMarehMakom } from './utils.js';
import { lookupName, fetchText, fetchRelated, SefariaError } from './sefaria-api.js';

export function initBrowser({ onAddSource, showToast }) {
  const form = $('[data-role="search-form"]');
  const input = $('[data-role="search-input"]');
  const suggestionsBox = $('[data-role="suggestions"]');
  const emptyBox = $('[data-role="browser-empty"]');
  const loadingBox = $('[data-role="browser-loading"]');
  const resultBox = $('[data-role="browser-result"]');

  let activeLookup = null;
  let activeFetch = null;
  // Breadcrumb stack of refs we navigated through. Each item is the
  // *previous* level the user can return to.
  const navStack = [];
  let currentResult = null;

  /* -------------------- autocomplete -------------------- */

  function renderSuggestions(items) {
    suggestionsBox.innerHTML = '';
    if (!items?.length) {
      suggestionsBox.hidden = true;
      return;
    }
    for (const item of items) {
      const btn = el('button', {
        type: 'button',
        text: item.label,
        onclick: () => {
          suggestionsBox.hidden = true;
          input.value = item.label;
          loadRef(item.ref, { reset: true });
        },
      });
      suggestionsBox.appendChild(btn);
    }
    suggestionsBox.hidden = false;
  }

  const onType = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { renderSuggestions([]); return; }
    if (activeLookup) activeLookup.abort();
    activeLookup = new AbortController();
    try {
      const items = await lookupName(q, { signal: activeLookup.signal });
      renderSuggestions(items.slice(0, 8));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn('[browser] lookup failed:', err);
      renderSuggestions([]);
    }
  }, 220);

  input.addEventListener('input', onType);
  input.addEventListener('focus', () => {
    if (suggestionsBox.children.length) suggestionsBox.hidden = false;
  });
  document.addEventListener('click', (e) => {
    if (!suggestionsBox.contains(e.target) && e.target !== input) {
      suggestionsBox.hidden = true;
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    suggestionsBox.hidden = true;
    loadRef(q, { reset: true });
  });

  /* -------------------- loading + rendering -------------------- */

  async function loadRef(refOrName, { reset = false, drillFrom = null } = {}) {
    setLoading(true);
    if (activeFetch) activeFetch.abort();
    activeFetch = new AbortController();

    try {
      let result;
      try {
        result = await fetchText(refOrName, { signal: activeFetch.signal });
      } catch (err) {
        // Hebrew-name input may not resolve as a ref directly — look it up.
        if (err instanceof SefariaError && err.code === 'not_found') {
          const candidates = await lookupName(refOrName, { signal: activeFetch.signal });
          if (!candidates.length) throw err;
          result = await fetchText(candidates[0].ref, { signal: activeFetch.signal });
        } else {
          throw err;
        }
      }

      if (reset) navStack.length = 0;
      else if (drillFrom) navStack.push(drillFrom);

      currentResult = result;
      renderResult(result);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      const msg = err instanceof SefariaError ? err.message : 'אירעה שגיאה בשליפת המקור.';
      showToast(msg, 'error');
      console.warn('[browser] fetch failed:', err);
      resultBox.hidden = true;
      emptyBox.hidden = false;
    } finally {
      setLoading(false);
    }
  }

  function setLoading(on) {
    loadingBox.hidden = !on;
    if (on) {
      emptyBox.hidden = true;
      resultBox.hidden = true;
    }
  }

  /** Top-level render — chooses leaf vs section vs multi-section. */
  function renderResult(result) {
    emptyBox.hidden = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '';

    resultBox.appendChild(renderBreadcrumb(result));

    const depth = textDepth(result.hebrew);
    if (depth === 0) {
      resultBox.appendChild(renderLeaf(result));
    } else if (depth === 1) {
      resultBox.appendChild(renderSection(result));
    } else {
      resultBox.appendChild(renderMultiSection(result, depth));
    }
  }

  function renderBreadcrumb(result) {
    const crumbs = el('div', { class: 'crumbs' });

    if (navStack.length > 0) {
      const back = el('button', {
        type: 'button',
        class: 'crumbs__back',
        text: '← חזרה',
        onclick: () => {
          const prev = navStack.pop();
          if (prev) loadRef(prev.ref);
        },
      });
      crumbs.appendChild(back);
    }

    const path = el('div', { class: 'crumbs__path' });
    for (const item of navStack) {
      const link = el('button', {
        type: 'button',
        class: 'crumbs__link mixed-content',
        text: item.heRef || item.ref,
        title: item.ref,
        onclick: () => {
          // Truncate the stack back to where this crumb is and reload.
          const idx = navStack.indexOf(item);
          if (idx < 0) return;
          navStack.length = idx;
          loadRef(item.ref);
        },
      });
      path.appendChild(link);
      path.appendChild(el('span', { class: 'crumbs__sep', text: ' › ' }));
    }
    const current = el('span', {
      class: 'crumbs__current mixed-content',
      text: result.heRef || result.ref,
    });
    path.appendChild(current);
    crumbs.appendChild(path);

    return crumbs;
  }

  /* -------------------- leaf view -------------------- */

  function renderLeaf(result) {
    const heText = cleanSefariaText(flattenSefariaText(result.hebrew));
    const title = formatMarehMakom(result.heRef, result.heCategories) || result.heRef || result.ref;
    const category = (result.heCategories || []).join(' • ');

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: title }),
      el('div', { class: 'result-card__category', text: category }),
    ]);

    const body = el('div', {
      class: 'result-card__body',
      dataset: { selectable: 'true' },
      text: heText || '— אין טקסט עברי זמין למקור זה —',
    });

    // Floating "add selection" affordance — appears whenever the user
    // has selected text inside this body element.
    const selectionBar = el('div', { class: 'selection-bar', hidden: true }, [
      el('span', { class: 'selection-bar__hint', text: 'נבחר טקסט:' }),
      el('button', {
        type: 'button',
        class: 'btn btn--primary btn--small',
        text: '← הוסף קטע נבחר',
        onclick: () => {
          const sel = window.getSelection();
          const text = sel ? sel.toString().trim() : '';
          if (!text) return;
          onAddSource({
            title: `${title} (קטע)`,
            text,
            sefariaRef: result.ref,
            sefariaHeRef: result.heRef,
          });
          showToast('הקטע הנבחר נוסף לדף.');
          sel.removeAllRanges();
          selectionBar.hidden = true;
        },
      }),
    ]);
    body.addEventListener('mouseup', () => updateSelectionBar(body, selectionBar));
    body.addEventListener('keyup', () => updateSelectionBar(body, selectionBar));

    const addBtn = el('button', {
      type: 'button',
      class: 'btn btn--primary btn--small',
      text: '← הוסף לדף',
      onclick: () => {
        if (!heText) { showToast('אין טקסט להוסיף.', 'error'); return; }
        onAddSource({
          title,
          text: heText,
          sefariaRef: result.ref,
          sefariaHeRef: result.heRef,
        });
        showToast(`נוסף לדף: ${truncate(title, 40)}`);
      },
    });

    const copyBtn = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--small',
      text: '📋 העתק',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(`${title}\n\n${heText}`);
          showToast('הועתק ללוח.');
        } catch { showToast('העתקה נכשלה.', 'error'); }
      },
    });

    const sefariaLink = el('a', {
      href: `https://www.sefaria.org/${encodeURI(result.ref)}`,
      target: '_blank', rel: 'noopener',
      class: 'btn btn--ghost btn--small',
      text: '↗ פתח בספריא',
    });

    const actions = el('div', { class: 'result-card__actions' }, [addBtn, copyBtn, sefariaLink]);

    const relatedPanel = el('div', { class: 'related', dataset: { state: 'idle' } });
    relatedPanel.appendChild(el('div', { class: 'related__head', text: 'טוען מקורות מקושרים…' }));
    loadRelatedInto(result.ref, relatedPanel);

    return el('div', { class: 'result-card' }, [head, body, selectionBar, actions, relatedPanel]);
  }

  function updateSelectionBar(scopeEl, bar) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { bar.hidden = true; return; }
    // Only show when the selection is inside our text body.
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    const inside = scopeEl.contains(anchor) && scopeEl.contains(focus);
    bar.hidden = !inside;
  }

  /* -------------------- section view (depth 1) -------------------- */

  function renderSection(result) {
    const segments = Array.isArray(result.hebrew) ? result.hebrew : [];
    const title = formatMarehMakom(result.heRef, result.heCategories) || result.heRef || result.ref;
    const heSectionName = (result.heSectionNames || [])[result.heSectionNames?.length - 1] || 'פסוק';
    const lastAddressType = (result.addressTypes || [])[result.addressTypes?.length - 1] || 'Integer';

    // Combined text (entire section) for the "add all" button.
    const fullText = segments
      .map((s, i) => `${subSectionHeLabel(lastAddressType, heSectionName, i)}. ${cleanSefariaText(flattenSefariaText(s))}`)
      .filter(Boolean)
      .join('\n');

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: title }),
      el('div', { class: 'result-card__category', text: (result.heCategories || []).join(' • ') }),
    ]);

    const addAllBtn = el('button', {
      type: 'button',
      class: 'btn btn--primary btn--small',
      text: '← הוסף את כל הקטע',
      onclick: () => {
        if (!fullText) { showToast('אין טקסט להוסיף.', 'error'); return; }
        onAddSource({
          title,
          text: fullText,
          sefariaRef: result.ref,
          sefariaHeRef: result.heRef,
        });
        showToast(`נוסף לדף: ${truncate(title, 40)}`);
      },
    });
    const headActions = el('div', { class: 'result-card__actions' }, [addAllBtn]);

    const list = el('ul', { class: 'segments' });

    segments.forEach((segValue, idx) => {
      const segText = cleanSefariaText(flattenSefariaText(segValue));
      if (!segText) return;
      const segHeLabel = subSectionHeLabel(lastAddressType, heSectionName, idx);
      const segRef = buildSubRef(result.ref, lastAddressType, 1, idx);

      const label = el('div', { class: 'segments__label mixed-content', text: segHeLabel });
      const text = el('div', { class: 'segments__text', text: segText });

      const openBtn = el('button', {
        type: 'button',
        class: 'btn btn--ghost btn--small',
        text: '🔎 פתח',
        title: 'פתח לקריאה והוסף מקורות מקושרים',
        onclick: () => loadRef(segRef, {
          drillFrom: { ref: result.ref, heRef: result.heRef },
        }),
      });
      const addBtn = el('button', {
        type: 'button',
        class: 'btn btn--primary btn--small',
        text: '← הוסף',
        onclick: () => {
          onAddSource({
            title: `${title}, ${segHeLabel}`,
            text: segText,
            sefariaRef: segRef,
            sefariaHeRef: `${result.heRef} ${segHeLabel}`,
          });
          showToast('נוסף לדף.');
        },
      });

      const actions = el('div', { class: 'segments__actions' }, [openBtn, addBtn]);
      list.appendChild(el('li', { class: 'segments__item' }, [label, text, actions]));
    });

    return el('div', { class: 'result-card' }, [head, headActions, list]);
  }

  /* -------------------- multi-section view (depth ≥ 2) -------------------- */

  function renderMultiSection(result, depth) {
    const arr = Array.isArray(result.hebrew) ? result.hebrew : [];
    const title = result.heRef || result.ref;
    const sectionNameIdx = (result.heSectionNames?.length || 0) - depth;
    const heSectionName = (result.heSectionNames || [])[sectionNameIdx] || 'חלק';
    const addressType = (result.addressTypes || [])[sectionNameIdx] || 'Integer';

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: title }),
      el('div', {
        class: 'result-card__category',
        text: `${(result.heCategories || []).join(' • ')} • ${arr.length} ${heSectionName}`,
      }),
    ]);

    const hint = el('div', {
      class: 'browser__hint',
      text: 'בחר חלק כדי לצפות / להוסיף:',
    });

    const grid = el('div', { class: 'nav-grid' });
    arr.forEach((child, idx) => {
      if (child == null || (Array.isArray(child) && child.length === 0)) return;
      const subLabel = subSectionHeLabel(addressType, heSectionName, idx);
      const subRef = buildSubRef(result.ref, addressType, 0, idx);
      const btn = el('button', {
        type: 'button',
        class: 'nav-grid__item mixed-content',
        text: subLabel,
        title: subRef,
        onclick: () => loadRef(subRef, {
          drillFrom: { ref: result.ref, heRef: result.heRef },
        }),
      });
      grid.appendChild(btn);
    });

    return el('div', { class: 'result-card' }, [head, hint, grid]);
  }

  /* -------------------- related sources panel -------------------- */

  // Hebrew category labels we use to group related links. The order
  // here is the order they appear in the UI.
  const CATEGORY_GROUPS = [
    { key: 'Commentary',  he: 'פרשנות',     icon: '📖' },
    { key: 'Targum',      he: 'תרגומים',    icon: '🔄' },
    { key: 'Midrash',     he: 'מדרשים',     icon: '📚' },
    { key: 'Talmud',      he: 'תלמוד',      icon: '🎓' },
    { key: 'Mishnah',     he: 'משנה',       icon: '📜' },
    { key: 'Halakhah',    he: 'הלכה',       icon: '⚖️' },
    { key: 'Kabbalah',    he: 'קבלה',       icon: '✨' },
    { key: 'Chasidut',    he: 'חסידות',     icon: '🕯' },
    { key: 'Liturgy',     he: 'ליטורגיה',   icon: '🕊' },
    { key: 'Musar',       he: 'מוסר',       icon: '📿' },
    { key: 'Philosophy',  he: 'מחשבה',      icon: '💭' },
    { key: 'Other',       he: 'אחר',        icon: '📎' },
  ];

  async function loadRelatedInto(ref, container) {
    try {
      container.dataset.state = 'loading';
      const data = await fetchRelated(ref);
      const links = Array.isArray(data?.links) ? data.links : [];
      const groups = groupLinks(links);
      renderRelated(container, groups, ref);
      container.dataset.state = 'ready';
    } catch (err) {
      console.warn('[browser] related fetch failed:', err);
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'related__head related__head--error', text: 'לא הצלחנו לטעון מקורות מקושרים.' }));
      container.dataset.state = 'error';
    }
  }

  function groupLinks(links) {
    const buckets = new Map();
    for (const link of links) {
      const cat = link.category || link.type || 'Other';
      const groupDef = CATEGORY_GROUPS.find((g) => g.key === cat) || CATEGORY_GROUPS[CATEGORY_GROUPS.length - 1];
      const key = groupDef.key;
      if (!buckets.has(key)) buckets.set(key, { def: groupDef, items: [] });
      buckets.get(key).items.push(link);
    }
    // Order by CATEGORY_GROUPS, drop empties.
    return CATEGORY_GROUPS
      .map((g) => buckets.get(g.key))
      .filter(Boolean);
  }

  function renderRelated(container, groups, parentRef) {
    container.innerHTML = '';
    if (groups.length === 0) {
      container.appendChild(el('div', {
        class: 'related__head',
        text: 'אין מקורות מקושרים זמינים למקור זה.',
      }));
      return;
    }

    const head = el('div', { class: 'related__head' }, [
      el('span', { text: 'מקורות מקושרים' }),
      el('span', {
        class: 'related__count',
        text: `${groups.reduce((sum, g) => sum + g.items.length, 0)} סך הכל`,
      }),
    ]);
    container.appendChild(head);

    for (const group of groups) {
      const details = el('details', { class: 'related-group' });
      const summary = el('summary', { class: 'related-group__summary' }, [
        el('span', { text: `${group.def.icon} ${group.def.he}` }),
        el('span', { class: 'related-group__count', text: `${group.items.length}` }),
      ]);
      details.appendChild(summary);

      // Group-level quick-add: stash all (up to a sane cap to avoid abuse).
      const addAll = el('button', {
        type: 'button',
        class: 'btn btn--ghost btn--small related-group__add-all',
        text: `← הוסף את כל ${group.def.he}`,
        onclick: () => addAllInGroup(group, parentRef),
      });
      details.appendChild(addAll);

      const list = el('ul', { class: 'related-list' });
      for (const link of group.items) {
        list.appendChild(renderRelatedItem(link));
      }
      details.appendChild(list);
      container.appendChild(details);
    }
  }

  function renderRelatedItem(link) {
    const heTitle = link.heRef || link.heCommentator || link.heCollectiveTitle || link.ref;
    const wrap = el('li', { class: 'related-item', dataset: { ref: link.ref } });

    const head = el('div', { class: 'related-item__head' }, [
      el('span', { class: 'related-item__title mixed-content', text: heTitle }),
      el('div', { class: 'related-item__actions' }, [
        el('button', {
          type: 'button',
          class: 'btn btn--ghost btn--small',
          text: '↕ הרחב',
          onclick: () => toggleRelatedExpansion(wrap, link),
        }),
        el('button', {
          type: 'button',
          class: 'btn btn--primary btn--small',
          text: '← הוסף',
          onclick: () => addRelatedToSheet(link),
        }),
      ]),
    ]);

    const body = el('div', { class: 'related-item__body', hidden: true });
    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  async function toggleRelatedExpansion(wrap, link) {
    const body = wrap.querySelector('.related-item__body');
    if (!body) return;
    if (!body.hidden) { body.hidden = true; return; }
    if (body.dataset.loaded === 'true') { body.hidden = false; return; }
    body.hidden = false;
    body.textContent = 'טוען…';
    try {
      const result = await fetchText(link.ref);
      const txt = cleanSefariaText(flattenSefariaText(result.hebrew)) || cleanSefariaText(flattenSefariaText(result.english));
      body.textContent = txt || '— אין טקסט זמין —';
      body.dataset.loaded = 'true';
      body.dataset.text = txt; // cached for addRelatedToSheet
    } catch (err) {
      console.warn('[browser] related expand failed:', err);
      body.textContent = 'שגיאה בטעינת המקור.';
    }
  }

  async function addRelatedToSheet(link) {
    try {
      // Reuse cached text if the user expanded it first.
      let result;
      let text;
      const cached = document.querySelector(`.related-item[data-ref="${cssEscape(link.ref)}"] .related-item__body[data-loaded="true"]`);
      if (cached?.dataset.text) {
        text = cached.dataset.text;
        result = { ref: link.ref, heRef: link.heRef || link.ref, heCategories: [] };
      } else {
        result = await fetchText(link.ref);
        text = cleanSefariaText(flattenSefariaText(result.hebrew));
      }
      if (!text) { showToast('אין טקסט להוסיף.', 'error'); return; }
      const title = formatMarehMakom(result.heRef || link.heRef, result.heCategories) || result.heRef || link.heRef || link.ref;
      onAddSource({
        title,
        text,
        sefariaRef: result.ref || link.ref,
        sefariaHeRef: result.heRef || link.heRef || link.ref,
      });
      showToast(`נוסף לדף: ${truncate(title, 40)}`);
    } catch (err) {
      console.warn('[browser] add related failed:', err);
      showToast('לא הצלחנו להוסיף את המקור.', 'error');
    }
  }

  async function addAllInGroup(group, parentRef) {
    const items = group.items;
    if (!items.length) return;
    if (items.length > 25 && !confirm(`${items.length} מקורות בקבוצה הזו — בטוח להוסיף את כולם?`)) return;
    showToast(`מוסיף ${items.length} מקורות מ${group.def.he}…`);
    let added = 0;
    for (const link of items) {
      try {
        const result = await fetchText(link.ref);
        const text = cleanSefariaText(flattenSefariaText(result.hebrew));
        if (!text) continue;
        const title = formatMarehMakom(result.heRef, result.heCategories) || result.heRef || link.ref;
        onAddSource({
          title, text,
          sefariaRef: result.ref,
          sefariaHeRef: result.heRef,
        });
        added++;
      } catch (err) {
        console.warn('[browser] add-all skipped:', link.ref, err);
      }
    }
    showToast(`נוספו ${added} מתוך ${items.length} מקורות.`);
  }

  // Tiny CSS.escape polyfill — older Safari needs it for attribute selectors.
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
  }

  return { loadRef };
}
