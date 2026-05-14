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
  text = decodeHTMLEntities(text);
  // Parsha break markers in Tanakh ({פ}=open, {ס}=closed, {ש}/{ר}=others).
  text = text.replace(/\{[פסשרת]\}/g, ' ');
  text = removeTeamim(text);
  // Collapse runs of whitespace including non-breaking + thin spaces.
  text = text.replace(/[\s  -​]+/g, ' ').trim();
  return text;
}

/**
 * Decode the common HTML entities Sefaria leaves in its text: &nbsp;,
 * &thinsp;, &amp; / &lt; / &gt; / &quot;, plus numeric &#NN; / &#xNN;.
 * Not a complete entity decoder — but covers everything we've seen.
 */
export function decodeHTMLEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/gi,    ' ')
    .replace(/&thinsp;/gi,  ' ')
    .replace(/&ensp;/gi,    ' ')
    .replace(/&emsp;/gi,    ' ')
    .replace(/&zwj;/gi,     '')
    .replace(/&zwnj;/gi,    '')
    .replace(/&shy;/gi,     '')
    .replace(/&amp;/gi,     '&')
    .replace(/&lt;/gi,      '<')
    .replace(/&gt;/gi,      '>')
    .replace(/&quot;/gi,    '"')
    .replace(/&apos;/gi,    "'")
    .replace(/&#(\d+);/g,            (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g,   (_, n) => String.fromCharCode(parseInt(n, 16)));
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
      // Always prefix with "משנה" so a Mishnah tractate doesn't share a
      // bare display name with the Bavli/Yerushalmi tractate of the same
      // word (e.g. "ברכות" → "משנה ברכות").
      if (!lv.length) return `משנה ${book}`;
      if (lv.length === 1) return `משנה ${book}, פרק ${lv[0]}`;
      return `משנה ${book}, פרק ${lv[0]} משנה ${lv[1]}`;
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
      if (!lv.length) return `משנה תורה לרמב"ם, הלכות ${topic}`;
      if (lv.length === 1) return `משנה תורה לרמב"ם, הלכות ${topic}, פרק ${lv[0]}`;
      return `משנה תורה לרמב"ם, הלכות ${topic}, פרק ${lv[0]}, הלכה ${lv[1]}`;
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
    // Sefaria stores Bavli with placeholders for daf 1 at indices 0,1;
    // real daf 2 sits at indices 2,3, so the mapping is i/2 + 1.
    const daf = numToHebrewLetters(1 + Math.floor(segIndex / 2));
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

/**
 * Replace divine-name letter sequences with their traditional "kinnui"
 * dashed variants (e.g. יהוה → י-הוה). Preserves any nikud / cantillation
 * sandwiched between the bare letters. Idempotent — running twice yields
 * the same output because the second pass can no longer match the
 * dash-separated form.
 */
export function applyHashemKinnui(text) {
  if (!text) return text;
  const N = '[֑-ׇ]*';            // any combining nikud / te'amim
  let t = String(text);
  // Order matters: do the longer names first so אלהים doesn't get
  // caught by the bare-אל rule.
  t = t.replace(new RegExp(`(י${N})(ה${N}ו${N}ה)`, 'g'),                      '$1-$2');
  t = t.replace(new RegExp(`(א${N})(ל${N}ה${N}י${N}ם)`, 'g'),                  '$1-$2');
  // אלהי (construct form, e.g. "אלהי ישראל") — same א-ל-ה-י pattern
  // but with no ם at the end. Lookahead stops matches inside longer
  // words like אלהיכם / אלהיכן / אלעזר.
  t = t.replace(new RegExp(`(א${N})(ל${N}ה${N}י)(?!${N}[א-ת])`, 'g'),           '$1-$2');
  // אדני — same consonants as the architectural-sockets word
  // (אַדְנֵי כֶסֶף, אֲדָנִים) and as the personal name אדניה(ו). Match
  // ONLY the two unambiguous forms:
  //   (a) Pointed divine vocalization — alef with chataf-patach (אֲ),
  //       which never occurs on the sockets-word or the name.
  //   (b) Bare unpointed "אדני" as a standalone word (no neighbouring
  //       Hebrew letters), where there's no nikud to disambiguate.
  // Both stop before any following Hebrew letter so אדניה/אדניהו stay.
  t = t.replace(new RegExp(`(אֲ${N})(ד${N}נ${N}י)(?!${N}[א-ת])`, 'g'),  '$1-$2');
  t = t.replace(/(?<![א-ת])אדני(?![א-ת])/g,                              'א-דני');
  t = t.replace(new RegExp(`(צ${N}ב${N}א${N})(ו${N}ת)`, 'g'),                   '$1-$2');
  // אל — disambiguate divine "אֵל" (with tsere) from the preposition
  // "אֶל" (with segol = "to / towards"). With nikud the difference is
  // unambiguous; without nikud the user accepts a transform.
  const PREFIX = '[בהוכלמש]';
  // (a) Pointed divine: tsere required immediately after the alef.
  t = t.replace(
    new RegExp(`(?<![א-ת]${N})((?:${PREFIX}${N}){0,3})(אֵ${N})(ל)(?!${N}[א-ת])`, 'g'),
    '$1$2-$3'
  );
  // (b) Unpointed bare/prefixed "אל" — no nikud on the alef or lamed.
  //     Hebrew-letter lookbehind/ahead still keeps ישראל / אלעזר safe.
  t = t.replace(
    new RegExp(`(?<![א-ת])((?:${PREFIX}){0,3})(א)(ל)(?![א-ת])`, 'g'),
    '$1$2-$3'
  );

  // שדי → שד-י. Word boundary required. (Unpointed false positive on
  // "שָׂדִי" = my field is theoretically possible but rare in practice.)
  t = t.replace(
    new RegExp(`(?<![א-ת]${N})(ש${N}ד${N})(י)(?!${N}[א-ת])`, 'g'),
    '$1-$2'
  );

  // "אהיה אשר אהיה" → "אהי-ה אשר אהי-ה" — only as the complete phrase
  // so we don't dash the common verb "אהיה" outside this divine name.
  // The capture groups end after the yod's nikud, so the dash sits
  // cleanly between yod (with any nikud) and the bare final ה.
  t = t.replace(
    new RegExp(`(א${N}ה${N}י${N})(ה${N}\\s+א${N}ש${N}ר${N}\\s+א${N}ה${N}י${N})(ה)`, 'g'),
    '$1-$2-$3'
  );

  return t;
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
 * Convert a 0-indexed amud position (within Sefaria's Bavli array, where
 * indices 0 and 1 are placeholders for the non-existent daf 1) to a
 * Hebrew label. So index 0 → "א ע״א" (placeholder, never shown), index 2
 * → "ב ע״א" (= 2a, the real first daf), etc.
 */
export function talmudHeLabel(index) {
  const dafNum = 1 + Math.floor(index / 2);
  const sideHe = index % 2 === 0 ? 'ע״א' : 'ע״ב';
  return `${numToHebrewLetters(dafNum)} ${sideHe}`;
}

/**
 * Convert a 0-indexed amud position to Sefaria's English daf suffix
 * (e.g. index 2 → "2a", 3 → "2b", 4 → "3a"). Indices 0 and 1 map to
 * the empty "1a"/"1b" placeholder, in line with Sefaria's data shape.
 */
export function talmudEnLabel(index) {
  const dafNum = 1 + Math.floor(index / 2);
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
  // Strip gershayim from single-letter Hebrew numerals — "משנה א" reads
  // cleaner than "משנה א׳"; multi-letter numerals keep gershayim
  // (e.g. "משנה י״ב") via presentHebrewLetters.
  return `${name} ${presentHebrewLetters(numToHebrewLetters(index + 1))}`;
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
