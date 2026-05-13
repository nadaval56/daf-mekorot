// js/utils.js
// Hebrew text helpers + small DOM/formatting utilities.
// No external dependencies — used everywhere.

/**
 * Hebrew cantillation marks (te'amim) range: U+0591–U+05AF
 * plus a few stragglers (U+05BD meteg, U+05BF rafe, U+05C0 paseq,
 * U+05C3 sof pasuq, U+05C6 nun hafukha).
 * Vowels (nikud) are intentionally preserved.
 */
const TEAMIM_RE = /[֑-ֽֿ֯׀׃׆]/g;

export function removeTeamim(text) {
  if (!text) return '';
  return String(text).replace(TEAMIM_RE, '');
}

/**
 * Remove all nikud + te'amim — for "naked" text comparisons.
 * Range covers all combining Hebrew marks.
 */
export function stripAllNikud(text) {
  if (!text) return '';
  return String(text).replace(/[֑-ׇ]/g, '');
}

/**
 * Sefaria text fields sometimes contain inline HTML (<b>, <i>, <sup>, <small>).
 * For this MVP we strip it — later phases may opt to render selectively.
 */
export function stripHTML(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, '');
}

/**
 * Sefaria text fields may also include footnote markers like
 *   <sup class="footnote-marker">1</sup><i class="footnote">...</i>
 * After stripHTML the footnote body remains as inline text. For now we
 * simply remove anything in parentheses that looks like a footnote leftover.
 * Keep this conservative — false positives would lose real content.
 */
export function cleanSefariaText(rawText) {
  if (!rawText) return '';
  let text = stripHTML(String(rawText));
  text = removeTeamim(text);
  // Collapse runs of whitespace.
  text = text.replace(/[ \t ]+/g, ' ').trim();
  return text;
}

/**
 * Sefaria responses sometimes return an array of strings (one per
 * segment / verse) and sometimes a single string. Normalize to a
 * single human-readable string with line breaks between segments.
 */
export function flattenSefariaText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((v) => flattenSefariaText(v)).filter(Boolean).join('\n');
  }
  return String(value);
}

/**
 * Build a Hebrew citation ("מראה מקום") from a Sefaria heRef +
 * heCategories. Falls back to heRef untouched if no rule matches.
 *
 * Examples (illustrative — Sefaria's heRef strings have many shapes):
 *   ("בראשית א׳:א׳",         ["תנ\"ך", "תורה", "בראשית"])
 *     → "בראשית, פרק א פסוק א"
 *   ("סוכה ב׳ א",            ["תלמוד", "בבלי", "סדר מועד", "סוכה"])
 *     → "תלמוד בבלי, מסכת סוכה, דף ב עמוד א"
 *   ("רש״י על בראשית א׳:א׳:א׳", ["תלמוד", ...]) → keep raw heRef
 */
export function formatMarehMakom(heRef, heCategories) {
  if (!heRef) return '';
  const cats = Array.isArray(heCategories) ? heCategories : [];
  const ref = String(heRef).trim();

  // Commentaries: "<commentator> על <base>". We keep them as-is — the
  // raw heRef already reads naturally in Hebrew.
  if (cats.includes('פרשנות') || /\s+על\s+/.test(ref)) {
    return ref;
  }

  // Talmud Bavli: "<masechet> <daf> <amud>"
  if (cats.includes('תלמוד') && cats.includes('בבלי')) {
    const m = ref.match(/^(.+?)\s+([א-ת׳״']+)\s*([אב])\s*$/);
    if (m) {
      const [, masechet, daf, amud] = m;
      return `תלמוד בבלי, מסכת ${masechet.trim()}, דף ${stripGershayim(daf)} עמוד ${amud}`;
    }
  }

  // Talmud Yerushalmi
  if (cats.includes('תלמוד') && cats.includes('ירושלמי')) {
    const m = ref.match(/^(.+?)\s+(.+)$/);
    if (m) return `תלמוד ירושלמי, מסכת ${m[1].trim()}, ${m[2].trim()}`;
  }

  // Mishnah: "משנה <masechet> <perek>:<mishnah>"
  if (cats.includes('משנה')) {
    const m = ref.match(/^משנה\s+(.+?)\s+(.+)$/);
    if (m) {
      const [, masechet, locator] = m;
      const parts = locator.split(/[:׃]/).map((p) => stripGershayim(p.trim()));
      if (parts.length >= 2) {
        return `משנה, מסכת ${masechet.trim()}, פרק ${parts[0]} משנה ${parts[1]}`;
      }
      return `משנה, מסכת ${masechet.trim()}, ${locator}`;
    }
  }

  // Tanakh: "<sefer> <perek>:<pasuk>"
  if (cats.includes('תנ"ך') || cats.includes('תנ״ך') || cats.includes('תנך')) {
    const m = ref.match(/^(.+?)\s+(.+)$/);
    if (m) {
      const [, sefer, locator] = m;
      const parts = locator.split(/[:׃]/).map((p) => stripGershayim(p.trim()));
      if (parts.length === 2) {
        return `${sefer.trim()}, פרק ${parts[0]} פסוק ${parts[1]}`;
      }
      if (parts.length === 1) {
        return `${sefer.trim()}, פרק ${parts[0]}`;
      }
    }
  }

  return ref;
}

/**
 * Strip Hebrew gershayim/geresh used as quotation/abbreviation marks in
 * locator strings (e.g. "א׳" → "א", "ל״ה" → "לה").
 */
function stripGershayim(s) {
  if (!s) return s;
  return String(s).replace(/[׳״''""]/g, '');
}

/* --------------------------------------------------------------
   Small DOM / misc helpers
   -------------------------------------------------------------- */

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function debounce(fn, ms = 250) {
  let t;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function formatDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

export function truncate(text, max = 100) {
  if (!text) return '';
  const t = String(text);
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}
