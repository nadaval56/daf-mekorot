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
 * Format spec (from the user, 2026-05):
 *   תנ"ך          → "<sefer>, פרק X, פסוק Y"
 *   משנה           → "<masechet>, פרק X משנה Y"
 *   תלמוד בבלי     → "<masechet>, דף X עמוד א/ב"
 *   תלמוד ירושלמי   → "ירושלמי, <masechet>, פרק X הלכה Y"
 *   משנה תורה       → 'הלכות <topic> לרמב"ם, פרק X הלכה Y'
 *
 * Hebrew letter locators keep gershayim only when they're multi-letter
 * (so "פרק א" not "פרק א׳", but "פרק י״ב").
 */
export function formatMarehMakom(heRef, heCategories) {
  if (!heRef) return '';
  const parsed = parseHeRef(heRef, heCategories);
  if (parsed) {
    const out = formatParsed(parsed);
    if (out) return out;
  }
  return String(heRef).trim();
}

/* --------------------------------------------------------------
   Citation parsing / formatting internals.
   -------------------------------------------------------------- */

/**
 * Parse a Sefaria heRef + heCategories into { kind, book, levels[] }
 * for downstream formatting. Returns null if the structure isn't
 * recognized — caller should fall back to the raw heRef.
 *
 * The book name is preferentially looked up via heCategories (where
 * Sefaria stores the canonical Hebrew book name), so compound names
 * like "מלכים א" or "הלכות תפלה וברכת כהנים" don't get split apart by
 * naive whitespace tokenization.
 */
export function parseHeRef(heRef, heCategories) {
  if (!heRef) return null;
  const ref = String(heRef).trim();
  const cats = Array.isArray(heCategories) ? heCategories : [];

  const kind = inferKind(ref, cats);
  if (!kind) return null;

  // ── Two recursive kinds: targum and commentary use an "inner" base ref.

  if (kind === 'targum') {
    // heRef shape: "<translator> <tanakh-style ref>"
    // The translator name is a category in `cats` (e.g. "אונקלוס", "יונתן").
    for (const c of cats) {
      if (!c || c === 'תרגום' || c === 'תנ"ך' || c === 'תנ״ך') continue;
      if (ref.startsWith(c + ' ')) {
        const rest = ref.slice(c.length + 1).trim();
        const innerCats = cats.filter((x) => x !== c && x !== 'תרגום').concat(['תנ"ך']);
        const inner = parseHeRef(rest, innerCats);
        if (inner) return { kind: 'targum', translator: c, inner };
      }
    }
    return null;
  }

  if (kind === 'commentary') {
    const m = ref.match(/^(.+?)\s+על\s+(.+)$/);
    if (m) {
      const commentator = m[1].trim();
      const baseRef = m[2].trim();
      // Recurse on the base; drop the commentary-specific cats so the inner
      // parse picks Tanakh/Talmud/etc. correctly.
      const innerCats = cats.filter((c) => c !== commentator && c !== 'פרשנות');
      let inner = parseHeRef(baseRef, innerCats);
      if (inner) {
        // For commentaries on Tanakh, drop the trailing comment-number level
        // (e.g. "רש״י על בראשית א:א:א" — the last "א" is the 1st Rashi on
        // verse 1:1; users want "רש"י על בראשית, פרק א, פסוק א").
        if (inner.kind === 'tanakh' && inner.levels.length > 2) {
          inner = { ...inner, levels: inner.levels.slice(0, 2) };
        }
        return { kind: 'commentary', commentator, inner };
      }
    }
    return { kind: 'commentary_raw', book: ref, levels: [] };
  }

  // ── Flat kinds: book + locator.

  const stripped = stripKindPrefix(ref, kind);
  let book = inferBookFromCategories(stripped, cats);
  if (!book) {
    // Fallback: split at the first whitespace. Works for non-compound book
    // names; misses compounds like "מלכים א" without category help — which
    // is OK because in practice heCategories carry the canonical book name.
    if (kind === 'bavli') {
      // Bavli needs special handling — the daf+amud combo is itself
      // space-separated, so first-word splitting eats "סוכה" cleanly and
      // parseBavliLevels takes care of the rest.
      const m = stripped.match(/^(\S+)\s+(.+)$/);
      book = m ? m[1] : stripped;
    } else {
      const m = stripped.match(/^(\S+)\s+(.+)$/);
      book = m ? m[1] : stripped;
    }
  }
  let rest = stripped.startsWith(book) ? stripped.slice(book.length).trim() : '';
  rest = rest.replace(/^[,:׃]\s*/, '');

  let levels;
  if (kind === 'bavli') {
    levels = parseBavliLevels(rest);
  } else {
    levels = rest ? splitLocator(rest) : [];
  }
  return { kind, book, levels };
}

function inferKind(ref, cats) {
  if (
    cats.includes('משנה תורה') ||
    cats.some((c) => /רמב״ם|רמב"ם/.test(c)) ||
    /^(?:משנה תורה|רמב״ם|רמב"ם)\s*,?\s*הלכות/.test(ref)
  ) return 'rambam';
  if (cats.includes('שולחן ערוך')) return 'shulchan';
  if (cats.includes('טור')) return 'tur';
  if (cats.includes('ירושלמי') || /^(?:תלמוד\s+)?ירושלמי/.test(ref)) return 'yerushalmi';
  if (cats.includes('בבלי') || (cats.includes('תלמוד') && !cats.includes('ירושלמי') && !cats.includes('משנה'))) return 'bavli';
  if (cats.includes('משנה')) return 'mishnah';
  if (cats.includes('תרגום')) return 'targum';
  if (cats.includes('פרשנות') || /\s+על\s+/.test(ref)) return 'commentary';
  if (cats.includes('תנ"ך') || cats.includes('תנ״ך') || cats.includes('תנך')) return 'tanakh';
  return null;
}

function stripKindPrefix(ref, kind) {
  switch (kind) {
    case 'rambam':
      return ref.replace(/^(?:משנה תורה|רמב״ם|רמב"ם)\s*,?\s*/, '');
    case 'shulchan':
      return ref.replace(/^שולחן ערוך\s*,?\s*/, '');
    case 'tur':
      return ref.replace(/^טור\s*,?\s*/, '');
    case 'yerushalmi':
      return ref.replace(/^(?:תלמוד\s+ירושלמי|ירושלמי)\s*,?\s*/, '');
    case 'bavli':
      return ref.replace(/^(?:תלמוד\s+בבלי|בבלי)\s*,?\s*/, '');
    case 'mishnah':
      return ref.replace(/^משנה\s+/, '');
    default:
      return ref;
  }
}

/**
 * Pick the longest Hebrew category that appears at the start of `text`.
 * Handles "מסכת X" / "משנה X" / "הלכות X" category names by also trying
 * the suffix after the prefix word.
 */
function inferBookFromCategories(text, cats) {
  let best = null;
  const candidates = [];
  for (const c of cats) {
    if (!c || !/[֐-׿]/.test(c)) continue;
    candidates.push(c);
    const stripped = c.replace(/^(?:מסכת|פרק|משנה|הלכות)\s+/, '').trim();
    if (stripped && stripped !== c) candidates.push(stripped);
  }
  for (const cand of candidates) {
    if (text === cand || text.startsWith(cand + ' ') ||
        text.startsWith(cand + ',') || text.startsWith(cand + ':') ||
        text.startsWith(cand + '׃')) {
      if (!best || cand.length > best.length) best = cand;
    }
  }
  return best;
}

/**
 * Bavli's daf+amud is space-separated, the optional line is colon-separated.
 *   "ב׳ א:ה׳" → ["ב׳", "א", "ה׳"]
 *   "ב׳ א"   → ["ב׳", "א"]
 *   "ב׳"     → ["ב׳"]
 *   ""       → []
 */
function parseBavliLevels(rest) {
  const r = (rest || '').trim();
  if (!r) return [];
  const colonIdx = r.search(/[:׃]/);
  const head = colonIdx >= 0 ? r.slice(0, colonIdx).trim() : r;
  const tail = colonIdx >= 0 ? r.slice(colonIdx + 1).trim() : '';
  const headParts = head.split(/\s+/).filter(Boolean);
  const out = [...headParts];
  if (tail) out.push(...splitLocator(tail));
  return out;
}

/** Format a parsed citation back to Hebrew per the user's spec. */
export function formatParsed(parsed) {
  if (!parsed) return '';
  const { kind } = parsed;

  // Recursive kinds first (use parsed.inner / parsed.translator / parsed.commentator).
  if (kind === 'targum') {
    const inner = formatParsed(parsed.inner) || parsed.inner?.book || '';
    return `תרגום ${parsed.translator} על ${inner}`;
  }
  if (kind === 'commentary') {
    const inner = formatParsed(parsed.inner) || parsed.inner?.book || '';
    return `${parsed.commentator} על ${inner}`;
  }
  if (kind === 'commentary_raw') return parsed.book;

  const { book } = parsed;
  const lv = (parsed.levels || []).map(presentHebrewLetters);
  switch (kind) {
    case 'tanakh': {
      if (!lv.length) return book;
      if (lv.length === 1) return `${book}, פרק ${lv[0]}`;
      if (lv.length === 2) return `${book}, פרק ${lv[0]}, פסוק ${lv[1]}`;
      return `${book}, פרק ${lv[0]}, פסוק ${lv[1]} (${lv.slice(2).join(':')})`;
    }
    case 'mishnah': {
      if (!lv.length) return book;
      if (lv.length === 1) return `${book}, פרק ${lv[0]}`;
      return `${book}, פרק ${lv[0]} משנה ${lv[1]}`;
    }
    case 'bavli': {
      if (!lv.length) return book;
      if (lv.length === 1) return `${book}, דף ${lv[0]}`;
      if (lv.length === 2) return `${book}, דף ${lv[0]} עמוד ${lv[1]}`;
      return `${book}, דף ${lv[0]} עמוד ${lv[1]}, שורה ${lv[2]}`;
    }
    case 'yerushalmi': {
      // Per spec: "ירושלמי <masechet>, פרק X הלכה Y" — single comma after masechet.
      if (!lv.length) return `ירושלמי ${book}`;
      if (lv.length === 1) return `ירושלמי ${book}, פרק ${lv[0]}`;
      if (lv.length === 2) return `ירושלמי ${book}, פרק ${lv[0]} הלכה ${lv[1]}`;
      return `ירושלמי ${book}, פרק ${lv[0]} הלכה ${lv[1]}, שורה ${lv[2]}`;
    }
    case 'rambam': {
      // Category names include the "הלכות " prefix; strip so we don't double it.
      const topic = book.replace(/^הלכות\s+/, '');
      if (!lv.length) return `הלכות ${topic} לרמב"ם`;
      if (lv.length === 1) return `הלכות ${topic} לרמב"ם, פרק ${lv[0]}`;
      return `הלכות ${topic} לרמב"ם, פרק ${lv[0]} הלכה ${lv[1]}`;
    }
    case 'shulchan': {
      if (!lv.length) return `שולחן ערוך, ${book}`;
      if (lv.length === 1) return `שולחן ערוך, ${book}, סימן ${lv[0]}`;
      return `שולחן ערוך, ${book}, סימן ${lv[0]} סעיף ${lv[1]}`;
    }
    case 'tur': {
      if (!lv.length) return `טור, ${book}`;
      if (lv.length === 1) return `טור, ${book}, סימן ${lv[0]}`;
      return `טור, ${book}, סימן ${lv[0]} סעיף ${lv[1]}`;
    }
  }
  return book;
}

/**
 * Build the citation for one sub-segment given the parent's parsed
 * citation. Used when adding a single segment (verse / line / halacha)
 * from the section view — the parent's heRef doesn't include the new
 * sub-level so we extend `levels` (recursing into inner parses when the
 * parent is a commentary/targum) and re-format.
 */
export function buildSegmentCitation(parentParsed, segIndex, segAddressType) {
  const extended = extendParsedWithSeg(parentParsed, segIndex, segAddressType);
  return extended ? formatParsed(extended) : null;
}

function extendParsedWithSeg(parsed, segIndex, segAddressType) {
  if (!parsed) return null;
  if (parsed.kind === 'targum' || parsed.kind === 'commentary') {
    const inner = extendParsedWithSeg(parsed.inner, segIndex, segAddressType);
    return inner ? { ...parsed, inner } : null;
  }
  const levels = [...(parsed.levels || [])];
  if (parsed.kind === 'bavli' && segAddressType === 'Talmud') {
    // Drilling from whole tractate into an amud: contributes daf+amud (2 levels).
    const daf = numToHebrewLetters(2 + Math.floor(segIndex / 2));
    const amud = segIndex % 2 === 0 ? 'א' : 'ב';
    levels.push(presentHebrewLetters(daf), amud);
  } else {
    levels.push(numToHebrewLetters(segIndex + 1));
  }
  return { ...parsed, levels };
}

/**
 * Split a locator like "א׳:ה׳" → ["א׳", "ה׳"].
 * Range syntax ("א׳-ה׳") is preserved as a single string for the level.
 */
function splitLocator(locator) {
  return String(locator).split(/[:׃]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Render a Hebrew numeral string with idiomatic gershayim:
 *   single letter        → no gershayim   ("א")
 *   multi-letter number  → gershayim before last char ("ט״ו", "י״ב")
 *   non-numeric / mixed  → return as-is
 */
export function presentHebrewLetters(s) {
  const stripped = String(s || '').replace(/[׳״''""]/g, '').trim();
  if (!stripped) return '';
  // Heuristic: a numeral is up to ~4 Hebrew letters from the standard set.
  if (!/^[אבגדהוזחטיכלמנסעפצקרשתךםןףץ]{1,4}$/.test(stripped)) return s;
  if (stripped.length === 1) return stripped;
  return stripped.slice(0, -1) + '״' + stripped.slice(-1);
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

/* --------------------------------------------------------------
   Sefaria structural helpers — depth detection & sub-ref naming.
   -------------------------------------------------------------- */

/**
 * Recursive depth of a Sefaria text value.
 *   "..."             → 0  (leaf segment)
 *   ["a", "b"]        → 1  (one section / chapter / daf)
 *   [["a", "b"], ...] → 2  (multi-section / whole book)
 */
export function textDepth(value) {
  if (typeof value === 'string') return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    return 1 + textDepth(value[0]);
  }
  return 0;
}

/**
 * Convert a 0-indexed daf/amud position to Hebrew label.
 *   0 → "ב ע״א", 1 → "ב ע״ב", 2 → "ג ע״א", ...
 */
export function talmudHeLabel(index) {
  const dafNum = 2 + Math.floor(index / 2);
  const sideHe = index % 2 === 0 ? 'ע״א' : 'ע״ב';
  return `${numToHebrewLetters(dafNum)} ${sideHe}`;
}

/** Convert a 0-indexed daf/amud position to Sefaria's English suffix: "2a", "2b". */
export function talmudEnLabel(index) {
  const dafNum = 2 + Math.floor(index / 2);
  const side = index % 2 === 0 ? 'a' : 'b';
  return `${dafNum}${side}`;
}

/**
 * Construct the Hebrew label for one sub-section, given the parent's
 * addressTypes/heSectionNames at that depth and the 0-based index.
 */
export function subSectionHeLabel(addressType, heSectionName, index) {
  if (addressType === 'Talmud') return talmudHeLabel(index);
  const name = heSectionName || 'חלק';
  return `${name} ${numToHebrewLetters(index + 1)}`;
}

/**
 * Construct a sub-ref string that Sefaria can re-resolve.
 *   parent = "Genesis"     , addressType="Perek"   → "Genesis 5"
 *   parent = "Genesis 1"   , addressType="Pasuk"   → "Genesis 1:5"
 *   parent = "Sukkah"      , addressType="Talmud"  → "Sukkah 4a"
 *   parent = "Sukkah 2a"   , addressType="Integer" → "Sukkah 2a:5"
 * Heuristic: the *first* address inside a book is space-separated, all
 * deeper ones are colon-separated.
 */
export function buildSubRef(parentRef, addressType, parentDepth, index) {
  let value;
  if (addressType === 'Talmud') value = talmudEnLabel(index);
  else value = String(index + 1);
  const sep = parentDepth >= 1 ? ':' : ' ';
  return `${parentRef}${sep}${value}`;
}

/**
 * Crude integer-to-Hebrew-letters used for chapter/verse labels.
 * Good enough for 1..999 which covers everything in Tanakh & Talmud.
 */
export function numToHebrewLetters(n) {
  if (!Number.isFinite(n) || n <= 0) return String(n);
  const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
  const TENS     = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const ONES     = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  let num = Math.floor(n);
  let out = '';
  if (num >= 1000) { out += numToHebrewLetters(Math.floor(num / 1000)) + "'"; num %= 1000; }
  out += HUNDREDS[Math.floor(num / 100)] || '';
  num %= 100;
  // The combinations 15 & 16 are written ט"ו / ט"ז to avoid spelling Hashem.
  if (num === 15) out += 'טו';
  else if (num === 16) out += 'טז';
  else {
    out += TENS[Math.floor(num / 10)] || '';
    out += ONES[num % 10] || '';
  }
  // Add gershayim/geresh for traditional rendering
  if (out.length > 1) {
    out = out.slice(0, -1) + '״' + out.slice(-1);
  } else if (out.length === 1) {
    out = out + '׳';
  }
  return out;
}
