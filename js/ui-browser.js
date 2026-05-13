// js/ui-browser.js
// Left panel: Sefaria browser — search autocomplete + fetch & display.

import { $, el, debounce, truncate } from './utils.js';
import { cleanSefariaText, flattenSefariaText, formatMarehMakom } from './utils.js';
import { lookupName, fetchText, SefariaError } from './sefaria-api.js';

export function initBrowser({ onAddSource, showToast }) {
  const form = $('[data-role="search-form"]');
  const input = $('[data-role="search-input"]');
  const suggestionsBox = $('[data-role="suggestions"]');
  const emptyBox = $('[data-role="browser-empty"]');
  const loadingBox = $('[data-role="browser-loading"]');
  const resultBox = $('[data-role="browser-result"]');

  let activeLookup = null;
  let activeFetch = null;

  /** Render the autocomplete suggestions list. */
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
          loadRef(item.ref);
        },
      });
      suggestionsBox.appendChild(btn);
    }
    suggestionsBox.hidden = false;
  }

  /** Debounced autocomplete on input. */
  const onType = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      renderSuggestions([]);
      return;
    }
    if (activeLookup) activeLookup.abort();
    activeLookup = new AbortController();
    try {
      const items = await lookupName(q, { signal: activeLookup.signal });
      renderSuggestions(items.slice(0, 8));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      // Autocomplete is best-effort; don't toast on every keystroke.
      console.warn('[browser] lookup failed:', err);
      renderSuggestions([]);
    }
  }, 220);

  input.addEventListener('input', onType);
  input.addEventListener('focus', () => {
    if (suggestionsBox.children.length) suggestionsBox.hidden = false;
  });
  // Hide suggestions when clicking elsewhere.
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
    loadRef(q);
  });

  /** Fetch a ref and render the result card. */
  async function loadRef(refOrName) {
    setLoading(true);
    if (activeFetch) activeFetch.abort();
    activeFetch = new AbortController();

    try {
      // If the user typed a Hebrew name we may need a name lookup first
      // to resolve it into a canonical ref. We try fetchText directly —
      // Sefaria's text endpoint is forgiving — and fall back to name lookup
      // on 404.
      let result;
      try {
        result = await fetchText(refOrName, { signal: activeFetch.signal });
      } catch (err) {
        if (err instanceof SefariaError && err.code === 'not_found') {
          const candidates = await lookupName(refOrName, { signal: activeFetch.signal });
          if (!candidates.length) throw err;
          result = await fetchText(candidates[0].ref, { signal: activeFetch.signal });
        } else {
          throw err;
        }
      }
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

  function renderResult(result) {
    emptyBox.hidden = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '';

    const heText = cleanSefariaText(flattenSefariaText(result.hebrew));
    const title = formatMarehMakom(result.heRef, result.heCategories) || result.heRef || result.ref;
    const category = (result.heCategories || []).join(' • ');

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: title }),
      el('div', { class: 'result-card__category', text: category }),
    ]);

    const body = el('div', { class: 'result-card__body', text: heText || '— אין טקסט עברי זמין למקור זה —' });

    const addBtn = el('button', {
      type: 'button',
      class: 'btn btn--primary btn--small',
      text: '← הוסף לדף',
      onclick: () => {
        if (!heText) {
          showToast('אין טקסט להוסיף.', 'error');
          return;
        }
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
        } catch {
          showToast('העתקה נכשלה.', 'error');
        }
      },
    });

    const sefariaLink = el('a', {
      href: `https://www.sefaria.org/${encodeURI(result.ref)}`,
      target: '_blank',
      rel: 'noopener',
      class: 'btn btn--ghost btn--small',
      text: '↗ פתח בספריא',
    });

    const actions = el('div', { class: 'result-card__actions' }, [addBtn, copyBtn, sefariaLink]);

    const card = el('div', { class: 'result-card' }, [head, body, actions]);
    resultBox.appendChild(card);
  }

  return { loadRef };
}
