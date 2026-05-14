// js/ui-browser.js
// Left panel: Sefaria browser.
// Supports drill-down navigation (book → chapter/daf → verse/segment),
// selection-based partial add, and a related-sources panel under each
// leaf segment (commentaries, midrash, etc., grouped by category).

import { $, el, debounce, truncate, textDepth, buildSubRef, subSectionHeLabel,
         numToHebrewLetters, presentHebrewLetters } from './utils.js';
import { cleanSefariaText, flattenSefariaText, formatMarehMakom, parseHeRef, buildSegmentCitation } from './utils.js';
import { lookupName, fetchText, fetchRelated, fetchIndex, fetchIndexFor, SefariaError } from './sefaria-api.js';

/* -------------------- Sefaria TOC (loaded lazily, used for category
   search + disambiguation) -------------------- */

const tocBooks = [];
const tocCategoryMap = new Map();   // 'תלמוד בבלי' / 'Mishnah' → books[]
let tocRawTree = null;              // raw /api/index tree — drives tree-based nav
let tocReady = false;
let tocPromise = null;

function ensureTOC() {
  if (tocReady) return Promise.resolve();
  if (tocPromise) return tocPromise;
  console.log('[TOC] loading /api/index from Sefaria…');
  tocPromise = fetchIndex()
    .then((toc) => {
      const tree = Array.isArray(toc) ? toc
        : (Array.isArray(toc?.tree) ? toc.tree
        : (Array.isArray(toc?.categories) ? toc.categories
        : null));
      if (!tree) {
        console.warn('[TOC] unexpected /api/index shape:', toc);
        tocPromise = null;
        return;
      }
      tocRawTree = tree;
      walkTOC(tree, [], []);
      curateTopLevelCategories();
      tocReady = true;
      console.log(`[TOC] ready — ${tocBooks.length} books, ${tocCategoryMap.size} category-paths.`,
        'sample categories:', [...tocCategoryMap.keys()].filter((k) => /[֐-׿]/.test(k)).slice(0, 8));
    })
    .catch((err) => {
      console.warn('[TOC] load failed — category search disabled:', err);
      tocPromise = null;
    });
  return tocPromise;
}

/* -------------------- Tree-based category navigation --------------------
   Sefaria's /api/index is a nested tree. We render it literally — each
   click drills into the *actual* children of the current node rather
   than into a heuristic groupBy of flat books. This avoids the earlier
   bug where books like "Aggadat Bereshit" or "Shulchan Arukh, הקדמה"
   (which Sefaria models as leaves) were being treated as parent cubes
   by the synthetic grouping logic. */

/** Walk down `pathEn` to find the corresponding tree node. */
function findTreeNodeByPath(pathEn) {
  if (!tocRawTree || !Array.isArray(pathEn) || !pathEn.length) return null;
  let nodes = tocRawTree;
  let node = null;
  for (const seg of pathEn) {
    if (!Array.isArray(nodes)) return null;
    node = nodes.find((n) => n && (n.category === seg || n.title === seg));
    if (!node) return null;
    nodes = node.contents;
  }
  return node;
}

/** Find a tree node by Hebrew label (heCategory or heTitle). */
function findTreeNodeByHeLabel(label) {
  if (!tocRawTree || !label) return null;
  const queue = [...tocRawTree];
  while (queue.length) {
    const node = queue.shift();
    if (!node) continue;
    if (node.heCategory === label || node.heTitle === label) return node;
    if (Array.isArray(node.contents)) queue.push(...node.contents);
  }
  return null;
}

/** Longest common English path prefix across a list of books. */
function commonPathEn(books) {
  if (!books?.length) return [];
  const first = books[0].pathEn;
  let n = first.length;
  for (const b of books.slice(1)) {
    for (let i = 0; i < n; i++) {
      if (b.pathEn[i] !== first[i]) { n = i; break; }
    }
    if (n === 0) break;
  }
  return first.slice(0, n);
}

/** Is this tree node a leaf book (no children, has a title)? */
function isLeafBook(node) {
  if (!node) return false;
  if (Array.isArray(node.contents) && node.contents.length) return false;
  return !!(node.title || node.firstSection);
}

function walkTOC(nodes, pathEn, pathHe) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node) continue;
    if (Array.isArray(node.contents) && node.contents.length) {
      const newEn = [...pathEn, node.category || node.title || ''];
      const newHe = [...pathHe, node.heCategory || node.heTitle || node.category || ''];
      walkTOC(node.contents, newEn, newHe);
      continue;
    }
    // Leaf book — recognized via `title` (most cases) or `firstSection`
    // (complex schema books).
    const enTitle = node.title || node.firstSection;
    if (!enTitle) continue;
    const heTitle = node.heTitle || node.heFirstSection || enTitle;
    const prefix = categoryPrefixHe(pathEn);
    const displayHe = prefix ? `${prefix} ${heTitle}` : heTitle;
    const book = {
      title: enTitle,
      heTitle,
      displayHe,
      pathEn: pathEn.slice(),
      pathHe: pathHe.slice(),
      ref: enTitle,
    };
    tocBooks.push(book);
    for (let i = 1; i <= pathHe.length; i++) {
      addToCategoryMap(pathHe.slice(0, i).join(' '), book);
      addToCategoryMap(pathEn.slice(0, i).join(' '), book);
    }
  }
}

function addToCategoryMap(key, book) {
  if (!key) return;
  if (!tocCategoryMap.has(key)) tocCategoryMap.set(key, []);
  tocCategoryMap.get(key).push(book);
}

/**
 * After walking the TOC, replace the auto-built top-level category
 * entries (e.g. "תלמוד בבלי") with CURATED lists — only the real
 * masechtot, not commentaries, reference works, or minor tractates
 * (Sefaria nests them under תלמוד בבלי and the tree-based nav surfaces
 * that branch naturally — no separate chip needed.)
 */
function curateTopLevelCategories() {
  const set = (heKey, enKey, books) => {
    if (!books.length) return;
    tocCategoryMap.set(heKey, books);
    if (enKey) tocCategoryMap.set(enKey, books);
  };

  // Tanakh — strict 24-book list (only Tanakh/Torah|Prophets|Writings/<book>).
  // Book leaves have pathEn = [<top>, <division>] (parent path only —
  // the book's own title is NOT in pathEn), so the length is 2 not 3.
  const TANAKH_DIV = new Set(['Torah', 'Prophets', 'Writings']);
  const tanakhBooks = tocBooks.filter((b) =>
    b.pathEn[0] === 'Tanakh' && TANAKH_DIV.has(b.pathEn[1]) && b.pathEn.length === 2
  );
  set('תנ"ך', 'Tanakh', tanakhBooks);
  set('תנ״ך', null, tanakhBooks);

  // Tanakh commentary — Sefaria's TOC layout varies. The path may use
  // "Commentary", "Modern Commentary", "Quoting Commentary", or the
  // commentaries may sit at top level (e.g. just "Rashi"). We try the
  // path-based filters first; if nothing matches, fall back to a title
  // heuristic — books under Tanakh whose Hebrew title contains "על"
  // (the "<commentator> על <book>" pattern).
  let tanakhCommentary = tocBooks.filter((b) =>
    b.pathEn[0] === 'Tanakh' &&
    b.pathEn.some((p) => /Commentary/i.test(p))
  );
  if (!tanakhCommentary.length) {
    tanakhCommentary = tocBooks.filter((b) =>
      b.pathEn[0] === 'Tanakh' && / על /.test(b.heTitle || '')
    );
  }
  console.log(`[TOC] Tanakh commentary: ${tanakhCommentary.length} books`);
  set('פרשנות תנ"ך', 'Tanakh Commentary', tanakhCommentary);
  set('פרשנות תנ״ך', null, tanakhCommentary);

  // For diagnostics: what's actually under Tanakh in this TOC?
  const tanakhSubs = new Set();
  for (const b of tocBooks) {
    if (b.pathEn[0] === 'Tanakh' && b.pathEn[1]) tanakhSubs.add(b.pathEn[1]);
  }
  console.log('[TOC] Tanakh sub-categories present:', [...tanakhSubs]);

  // Mishnah — only the 6 sedarim's masechtot (Mishnah/Seder X/<Masechet>).
  const MISHNAH_SEDERS = new Set([
    'Seder Zeraim', 'Seder Moed', 'Seder Nashim',
    'Seder Nezikin', 'Seder Kodashim', 'Seder Tahorot',
  ]);
  const mishnahBooks = tocBooks.filter((b) =>
    b.pathEn[0] === 'Mishnah' &&
    MISHNAH_SEDERS.has(b.pathEn[1]) &&
    b.pathEn.length === 2
  );
  set('משנה', 'Mishnah', mishnahBooks);

  // Mishnah commentary — same multi-strategy as Tanakh commentary.
  let mishnahCommentary = tocBooks.filter((b) =>
    b.pathEn[0] === 'Mishnah' && b.pathEn.some((p) => /Commentary/i.test(p))
  );
  if (!mishnahCommentary.length) {
    mishnahCommentary = tocBooks.filter((b) =>
      b.pathEn[0] === 'Mishnah' && / על /.test(b.heTitle || '')
    );
  }
  console.log(`[TOC] Mishnah commentary: ${mishnahCommentary.length} books`);
  set('פרשנות משנה', 'Mishnah Commentary', mishnahCommentary);

  // Talmud Bavli — only the standard masechtot under Talmud/Bavli/Seder X.
  const bavliMain = tocBooks.filter((b) =>
    b.pathEn[0] === 'Talmud' && b.pathEn[1] === 'Bavli' &&
    typeof b.pathEn[2] === 'string' && b.pathEn[2].startsWith('Seder ')
  );
  set('תלמוד בבלי', 'Talmud Bavli', bavliMain);

  // Talmud Yerushalmi — same shape.
  const yerushalmiMain = tocBooks.filter((b) =>
    b.pathEn[0] === 'Talmud' && b.pathEn[1] === 'Yerushalmi' &&
    typeof b.pathEn[2] === 'string' && b.pathEn[2].startsWith('Seder ')
  );
  set('תלמוד ירושלמי', 'Talmud Yerushalmi', yerushalmiMain);

  // (Minor Tractates were once a synthetic top-level chip but it
  // duplicated the same node that's already a child of "תלמוד בבלי"
  // in the tree-based nav, so it was removed.)

  // Halakhah / Mussar / Kabbalah / Chasidut / Midrash / Liturgy /
  // Jewish Thought — let everything under each top category show.
  const HE_TOP = {
    'הלכה': 'Halakhah',
    'מוסר': 'Musar',
    'קבלה': 'Kabbalah',
    'חסידות': 'Chasidut',
    'מדרש': 'Midrash',
    'ליטורגיה': 'Liturgy',
    'מחשבת ישראל': 'Jewish Thought',
    'תוספתא': 'Tosefta',
    'שאלות ותשובות': 'Responsa',
  };
  for (const [he, en] of Object.entries(HE_TOP)) {
    const books = tocBooks.filter((b) => b.pathEn[0] === en);
    if (books.length) set(he, en, books);
  }
}

function categoryPrefixHe(pathEn) {
  if (pathEn[0] === 'Mishnah') return 'משנה';
  if (pathEn[0] === 'Talmud' && pathEn[1] === 'Bavli') return 'תלמוד בבלי';
  if (pathEn[0] === 'Talmud' && pathEn[1] === 'Yerushalmi') return 'תלמוד ירושלמי';
  return '';
}

/**
 * Local TOC search. Returns a mix of {type:'category', label, books}
 * (a category like "תלמוד בבלי" — click → grid of masechtot) and
 * {type:'ref', label, ref} (a specific book).
 */
function searchLocalTOC(query) {
  const q = query.trim();
  if (!q || !tocReady) return [];
  const out = [];
  const seen = new Set();

  // 1. Exact category name → category navigator.
  if (tocCategoryMap.has(q)) {
    out.push({ type: 'category', label: q, books: tocCategoryMap.get(q) });
  }

  // 2. Composite "<category> <book>" e.g. "תלמוד בבלי סוכה" → direct ref.
  const parts = q.split(/\s+/);
  for (let i = parts.length - 1; i > 0; i--) {
    const catKey = parts.slice(0, i).join(' ');
    const bookKey = parts.slice(i).join(' ');
    const cands = tocCategoryMap.get(catKey);
    if (!cands) continue;
    for (const book of cands) {
      if (book.heTitle === bookKey && !seen.has(book.ref)) {
        seen.add(book.ref);
        out.push({ type: 'ref', label: book.displayHe, ref: book.ref });
      }
    }
  }

  // 3. Exact book name → all matches across categories (disambiguation).
  for (const book of tocBooks) {
    if (book.heTitle === q && !seen.has(book.ref)) {
      seen.add(book.ref);
      out.push({ type: 'ref', label: book.displayHe, ref: book.ref });
    }
  }

  // 4. Prefix matches.
  if (out.length < 10) {
    for (const book of tocBooks) {
      if (out.length >= 10) break;
      if (seen.has(book.ref)) continue;
      if (book.heTitle.startsWith(q) || book.displayHe.startsWith(q)) {
        seen.add(book.ref);
        out.push({ type: 'ref', label: book.displayHe, ref: book.ref });
      }
    }
  }

  return out;
}

/**
 * Hebrew name for the segmentation unit at depth N (1 = bottom-most leaf
 * unit, 2 = one level up, ...). Used as a fallback when Sefaria's response
 * doesn't surface heSectionNames — so a Tanakh book listing chapters
 * defaults to "פרק", a Mishnah perek listing segments defaults to "משנה",
 * etc., never to a hard-coded "פסוק".
 */
function defaultSegNameFor(kindOrParsed, depth = 1) {
  const tables = {
    tanakh:     ['פסוק', 'פרק'],
    mishnah:    ['משנה', 'פרק'],
    bavli:      ['שורה', 'עמוד', 'דף'],
    yerushalmi: ['הלכה', 'פרק'],
    rambam:     ['הלכה', 'פרק'],
    shulchan:   ['סעיף', 'סימן'],
    tur:        ['סעיף', 'סימן'],
  };
  const kind = typeof kindOrParsed === 'string' ? kindOrParsed : kindOrParsed?.kind;
  if (!kind) return 'חלק';
  const table = tables[kind];
  if (!table) return 'חלק';
  return table[depth - 1] || table[table.length - 1] || 'חלק';
}

/**
 * Reliable kind detection using Sefaria's stable ENGLISH categories
 * (`Tanakh`, `Talmud`, `Bavli`, `Mishnah`, `Halakhah`, `Mishneh Torah`,
 * `Shulchan Arukh`, `Tur`, `Commentary`, `Targum`). Hebrew categories
 * vary in spelling/encoding across responses; English is consistent.
 */
function detectKind(result) {
  const cats = result?.categories || [];
  if (cats.includes('Tanakh')) {
    if (cats.includes('Commentary')) return 'commentary';
    if (cats.includes('Targum')) return 'targum';
    return 'tanakh';
  }
  if (cats.includes('Talmud')) {
    if (cats.includes('Yerushalmi')) return 'yerushalmi';
    return 'bavli';
  }
  if (cats.includes('Mishnah')) return 'mishnah';
  if (cats.includes('Halakhah')) {
    if (cats.includes('Mishneh Torah') || cats.some((c) => /Rambam/i.test(c))) return 'rambam';
    if (cats.includes('Shulchan Arukh')) return 'shulchan';
    if (cats.includes('Tur')) return 'tur';
  }
  if (cats.includes('Commentary')) return 'commentary';
  if (cats.includes('Targum')) return 'targum';
  return null;
}

/**
 * Pick the best Hebrew display title from a Sefaria text response or
 * related-link object. We use `formatMarehMakom` when possible, then
 * fall through Hebrew-only fields. We deliberately AVOID falling back
 * to the English `ref` — English titles must not leak into the sheet.
 */
function displayTitleFor(obj) {
  if (!obj) return '';
  const cats = obj.heCategories || (obj.heCategory ? [obj.heCategory] : []);
  if (obj.heRef) {
    const formatted = formatMarehMakom(obj.heRef, cats);
    if (formatted) return formatted;
  }
  return obj.heRef
      || obj.heCommentator
      || obj.heCollectiveTitle
      || obj.heBook
      || obj.heTitle
      || '— מקור ללא שם בעברית —';
}

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

  // Kick off TOC load in the background so the first category-search
  // attempt is fast. Once it's ready, populate the chips row.
  ensureTOC().then(() => renderCategoryChips());

  const chipsBox = $('[data-role="category-chips"]');
  function renderCategoryChips() {
    if (!chipsBox || !tocReady) return;
    // Top-level categories the user typically wants in one click.
    const TOP = [
      'תנ"ך', 'פרשנות תנ"ך',
      'משנה', 'פרשנות משנה',
      'תלמוד בבלי', 'תלמוד ירושלמי',
      'מדרש', 'הלכה', 'קבלה', 'חסידות',
      'מחשבת ישראל', 'מוסר', 'תוספתא', 'ליטורגיה',
    ];
    chipsBox.innerHTML = '';
    for (const cat of TOP) {
      const books = tocCategoryMap.get(cat);
      if (!books?.length) continue;
      chipsBox.appendChild(el('button', {
        type: 'button',
        class: 'category-chip',
        text: cat,
        title: `${books.length} ספרים`,
        onclick: () => {
          navStack.length = 0;
          renderCategoryNav(cat, books);
        },
      }));
    }
  }

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
          if (item.type === 'category') {
            navStack.length = 0;
            renderCategoryNav(item.label, item.books);
          } else {
            loadRef(item.ref, { reset: true });
          }
        },
      });
      suggestionsBox.appendChild(btn);
    }
    suggestionsBox.hidden = false;
  }

  const onType = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { renderSuggestions([]); return; }

    // Make sure local TOC is loading (no-op if already loaded).
    ensureTOC();

    if (activeLookup) activeLookup.abort();
    activeLookup = new AbortController();

    // Sefaria's /api/name and the local TOC are queried in parallel.
    let api = [];
    try {
      api = await lookupName(q, { signal: activeLookup.signal });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn('[browser] lookup failed:', err);
    }

    const local = searchLocalTOC(q);
    // Combine: local matches first (category nodes + disambiguated book
    // names), then API matches we haven't already covered.
    const seen = new Set(local.map((s) => s.ref || `cat:${s.label}`));
    for (const a of api) {
      const key = a.ref || `cat:${a.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      local.push(a);
    }
    renderSuggestions(local.slice(0, 12));
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

    // If the query exactly matches a category, show the category nav.
    if (tocReady && tocCategoryMap.has(q)) {
      navStack.length = 0;
      renderCategoryNav(q, tocCategoryMap.get(q));
      return;
    }

    // If the query exactly matches a book name that appears in MULTIPLE
    // categories (e.g. "סוכה" → Mishnah / Bavli / Yerushalmi), show the
    // disambiguation list instead of going straight to the first hit.
    if (tocReady) {
      const matches = tocBooks.filter((b) => b.heTitle === q);
      if (matches.length > 1) {
        renderSuggestions(matches.map((b) => ({
          type: 'ref', label: b.displayHe, ref: b.ref,
        })));
        return;
      }
      if (matches.length === 1) {
        loadRef(matches[0].ref, { reset: true });
        return;
      }
    }

    loadRef(q, { reset: true });
  });

  /** Top-level category navigation. Prefers Sefaria's raw TOC tree
   *  (so each click drills into the actual children Sefaria defines);
   *  falls back to synthetic book-grouping for categories we built
   *  ourselves (פרשנות תנ"ך / פרשנות משנה). */
  function renderCategoryNav(categoryLabel, books) {
    // 1. Try the literal Sefaria tree first. If the chip's books all
    //    share a common English path prefix, walk to that node and
    //    show its direct children — this gives "Midrash → מדרשי הלכה
    //    → ספרי/ספרא/מכילתא" instead of the older heuristic groupings.
    const path = commonPathEn(books);
    const node = path.length ? findTreeNodeByPath(path) : null;
    if (node && Array.isArray(node.contents) && node.contents.length) {
      renderTreeNode(node, categoryLabel, null);
      return;
    }
    // 2. Synthetic categories (פרשנות תנ"ך etc.) have no tree node;
    //    fall through to grouped book listing.
    renderHierarchicalCategoryNav(categoryLabel, books);
  }

  /** Render the immediate children of a Sefaria TOC node.
   *  Sub-category children become navigation cubes (click drills in);
   *  leaf-book children load via loadRef. Books that ARE also a
   *  category container (rare but happens) get both behaviours. */
  function renderTreeNode(node, label = null, prevCrumb = null) {
    const heLabel = label || node.heCategory || node.heTitle || node.category || node.title || '';
    const contents = Array.isArray(node.contents) ? node.contents : [];

    emptyBox.hidden = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '';

    const crumbs = el('div', { class: 'crumbs' });
    if (prevCrumb) {
      crumbs.appendChild(el('button', {
        type: 'button',
        class: 'crumbs__back',
        text: '→ חזרה',
        onclick: prevCrumb.onClick,
      }));
    }
    crumbs.appendChild(el('span', { class: 'crumbs__current mixed-content', text: heLabel }));
    resultBox.appendChild(crumbs);

    // Empty content shouldn't usually happen — protect against it.
    if (!contents.length) {
      // If the node itself is a book, just load it.
      if (node.title) {
        loadRef(node.title, { reset: true });
        return;
      }
      resultBox.appendChild(el('div', { class: 'browser__error' }, [
        el('div', { text: 'אין תוכן זמין לקטגוריה זו.' }),
      ]));
      return;
    }

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: heLabel }),
      el('div', { class: 'result-card__category', text: `${contents.length} פריטים` }),
    ]);
    const hint = el('div', { class: 'browser__hint', text: 'בחר:' });
    const grid = el('div', { class: 'nav-grid' });

    for (const child of contents) {
      if (!child) continue;
      const isCategory = Array.isArray(child.contents) && child.contents.length > 0;
      const heLabelChild = child.heCategory || child.heTitle || child.category || child.title || '?';
      grid.appendChild(el('button', {
        type: 'button',
        class: 'nav-grid__item mixed-content',
        text: heLabelChild,
        title: child.title || child.category || '',
        onclick: isCategory
          ? () => renderTreeNode(child, null, { onClick: () => renderTreeNode(node, label, prevCrumb) })
          : () => loadRef(child.title || child.firstSection, {
              drillFrom: { ref: '__category__', heRef: heLabel, _isCategory: true, _node: node },
            }),
      }));
    }
    resultBox.appendChild(el('div', { class: 'result-card' }, [head, hint, grid]));
  }

  /** Compute the depth at which the books' paths first diverge.
   *  Returns the path index where books differ (-1 if all identical). */
  function findVariationDepth(books) {
    if (books.length === 0) return -1;
    const ref = books[0].pathEn;
    const maxDepth = Math.max(...books.map((b) => b.pathEn.length));
    for (let d = 0; d < maxDepth; d++) {
      const first = books[0].pathEn[d];
      if (books.some((b) => b.pathEn[d] !== first)) return d;
    }
    return -1;
  }

  /** Group `books` by `book.pathEn[depth]`. Each group records the
   *  Hebrew name (`pathHe[depth]`) and the matching books. */
  function groupByPathSegment(books, depth) {
    const map = new Map();
    for (const book of books) {
      const enKey = book.pathEn[depth] || '__leaf__';
      const heName = book.pathHe[depth] || book.heTitle;
      if (!map.has(enKey)) {
        map.set(enKey, { enKey, heName, books: [] });
      }
      map.get(enKey).books.push(book);
    }
    return [...map.values()];
  }

  /** Generic hierarchical navigator. Groups books by their first
   *  varying path segment; clicking a group recurses. When only one
   *  level remains (all books share a parent), falls through to a
   *  flat list. */
  function renderHierarchicalCategoryNav(categoryLabel, books, prevCrumbs = []) {
    const varDepth = findVariationDepth(books);
    // Show a flat list when there's nothing useful to group by (no
    // variation) or when the set is small enough to scan directly.
    if (varDepth < 0 || books.length <= 6) {
      renderFlatCategoryNav(categoryLabel, books, prevCrumbs[0]);
      return;
    }

    const groups = groupByPathSegment(books, varDepth);
    // If only one group emerged we can't usefully sub-divide — fall
    // through to a flat list of books.
    if (groups.length <= 1) {
      renderFlatCategoryNav(categoryLabel, books, prevCrumbs[0]);
      return;
    }

    emptyBox.hidden = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '';

    const crumbsEl = el('div', { class: 'crumbs' });
    if (prevCrumbs.length) {
      crumbsEl.appendChild(el('button', {
        type: 'button',
        class: 'crumbs__back',
        text: '→ חזרה',
        onclick: prevCrumbs[prevCrumbs.length - 1].onClick,
      }));
    }
    crumbsEl.appendChild(el('span', { class: 'crumbs__current mixed-content', text: categoryLabel }));
    resultBox.appendChild(crumbsEl);

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: categoryLabel }),
      el('div', { class: 'result-card__category', text: `${groups.length} קבוצות • ${books.length} ספרים` }),
    ]);
    const hint = el('div', { class: 'browser__hint', text: 'בחר קבוצה:' });
    const grid = el('div', { class: 'nav-grid' });
    for (const group of groups) {
      grid.appendChild(el('button', {
        type: 'button',
        class: 'nav-grid__item mixed-content',
        text: group.heName,
        title: `${group.books.length} ספרים`,
        onclick: () => renderHierarchicalCategoryNav(
          `${categoryLabel} — ${group.heName}`,
          group.books,
          [...prevCrumbs, { onClick: () => renderHierarchicalCategoryNav(categoryLabel, books, prevCrumbs) }]
        ),
      }));
    }
    resultBox.appendChild(el('div', { class: 'result-card' }, [head, hint, grid]));
  }

  function renderFlatCategoryNav(categoryLabel, books, prevCrumb = null) {
    emptyBox.hidden = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '';

    // Optional back-to-parent crumb (e.g. coming from sedarim nav).
    const crumbs = el('div', { class: 'crumbs' });
    if (prevCrumb) {
      crumbs.appendChild(el('button', {
        type: 'button',
        class: 'crumbs__back',
        text: '→ חזרה',
        onclick: prevCrumb.onClick,
      }));
    }
    crumbs.appendChild(el('span', { class: 'crumbs__current mixed-content', text: categoryLabel }));
    resultBox.appendChild(crumbs);

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: categoryLabel }),
      el('div', { class: 'result-card__category', text: `${books.length} ספרים` }),
    ]);
    const hint = el('div', { class: 'browser__hint', text: 'בחר ספר:' });
    const grid = el('div', { class: 'nav-grid' });
    for (const book of books) {
      grid.appendChild(el('button', {
        type: 'button',
        class: 'nav-grid__item mixed-content',
        text: book.heTitle,
        title: book.ref,
        onclick: () => loadRef(book.ref, {
          drillFrom: { ref: '__category__', heRef: categoryLabel, _books: books, _isCategory: true },
        }),
      }));
    }
    resultBox.appendChild(el('div', { class: 'result-card' }, [head, hint, grid]));
  }

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

      // Many complex-schema books (Zohar, Mishneh Torah, large midrashic
      // works) cause Sefaria's /api/v3/texts/<title> to 500 because there
      // isn't one canonical text — there are nested sub-books. In those
      // cases, fall back to /api/v2/index/<title>, read schema.nodes,
      // and let the user pick a sub-section.
      if (err instanceof SefariaError && (err.code === 'server' || err.code === 'not_found' || err.code === 'parse')) {
        try {
          const idx = await fetchIndexFor(refOrName, { signal: activeFetch.signal });
          if (idx?.isComplex && Array.isArray(idx.nodes) && idx.nodes.length) {
            if (reset) navStack.length = 0;
            else if (drillFrom) navStack.push(drillFrom);
            currentResult = { ref: refOrName, heRef: idx.heTitle || refOrName, heCategories: [] };
            renderComplexBookIndex(refOrName, idx);
            return;
          }
        } catch {
          /* fall through to the inline-error display below */
        }
      }

      const msg = err instanceof SefariaError ? err.message : 'אירעה שגיאה בשליפת המקור.';
      showToast(msg, 'error');
      console.warn('[browser] fetch failed:', err);
      emptyBox.hidden = true;
      resultBox.hidden = false;
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', { class: 'browser__error' }, [
        el('div', { class: 'browser__error-title', text: 'לא הצלחנו לטעון את המקור' }),
        el('div', { class: 'browser__error-ref mixed-content', text: String(refOrName) }),
        el('div', { class: 'browser__error-msg', text: msg }),
        el('div', { class: 'browser__error-hint',
          text: 'יתכן שספר זה דורש בחירת פרק / סעיף ספציפי. נסה חיפוש מפורט יותר.' }),
      ]));
    } finally {
      setLoading(false);
    }
  }

  /** Show the schema-node sub-sections of a complex book (e.g. Zohar's
   *  three parts, Mishneh Torah's books). Each click drills into the
   *  sub-section via a `<book>, <node>` ref. */
  function renderComplexBookIndex(bookRef, idx) {
    emptyBox.hidden = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '';

    resultBox.appendChild(el('div', { class: 'crumbs' }, [
      el('span', { class: 'crumbs__current mixed-content', text: idx.heTitle || bookRef }),
    ]));

    const head = el('div', { class: 'result-card__head' }, [
      el('div', { class: 'result-card__title mixed-content', text: idx.heTitle || bookRef }),
      el('div', { class: 'result-card__category', text: (idx.categories || []).join(' • ') }),
    ]);
    const hint = el('div', { class: 'browser__hint', text: 'הספר מחולק לחלקים — בחר חלק:' });
    const grid = el('div', { class: 'nav-grid' });
    for (const node of idx.nodes) {
      const heTitle = nodeHebrewTitle(node) || node.title || '?';
      const enTitle = node.title || '';
      if (!enTitle) continue;
      const subRef = `${bookRef}, ${enTitle}`;
      grid.appendChild(el('button', {
        type: 'button',
        class: 'nav-grid__item mixed-content',
        text: heTitle,
        title: subRef,
        onclick: () => loadRef(subRef, {
          drillFrom: { ref: bookRef, heRef: idx.heTitle || bookRef },
        }),
      }));
    }
    resultBox.appendChild(el('div', { class: 'result-card' }, [head, hint, grid]));
  }

  /** Extract a Hebrew title from a schema node. Sefaria's index stores
   *  it as `heTitle` directly, or in a `titles[]` array of language
   *  variants. */
  function nodeHebrewTitle(node) {
    if (!node) return '';
    if (node.heTitle) return node.heTitle;
    if (Array.isArray(node.titles)) {
      const heT = node.titles.find((t) => t.lang === 'he');
      if (heT?.text) return heT.text;
    }
    return '';
  }

  function setLoading(on) {
    loadingBox.hidden = !on;
    if (on) {
      emptyBox.hidden = true;
      resultBox.hidden = true;
    }
  }

  /** Top-level render — chooses leaf / block / segments / nav-grid by both
   *  text depth AND citation kind (so a Tanakh chapter renders as a whole
   *  block while a Mishnah chapter splits into mishnayot).
   *  Kind comes from Sefaria's stable English `categories`; the navigation
   *  level comes from `result.sections.length` (also stable). The Hebrew
   *  heRef parsing was unreliable for whole-book / range refs. */
  function renderResult(result) {
    emptyBox.hidden = true;
    resultBox.hidden = false;
    resultBox.innerHTML = '';

    resultBox.appendChild(renderBreadcrumb(result));

    const kind = detectKind(result);
    const sectionDepth = result.sections?.length ?? 0; // 0 = whole book, 1 = chapter/daf, …
    const textD = textDepth(result.hebrew);

    // Bavli: book → daf grid; daf → whole-daf block (both amudim joined);
    // amud → whole-amud block; line → leaf.
    if (kind === 'bavli') {
      if (sectionDepth === 0 && textD >= 2) {
        resultBox.appendChild(renderBavliBookNav(result));
        return;
      }
      if (sectionDepth === 1) {
        resultBox.appendChild(renderBlockView(result, { mode: 'bavli-daf', kind }));
        return;
      }
      if (sectionDepth === 2 && textD >= 1) {
        resultBox.appendChild(renderBlockView(result, { mode: 'bavli-amud', kind }));
        return;
      }
      resultBox.appendChild(renderLeaf(result));
      return;
    }

    // Tanakh: book → chapter grid; chapter → whole-chapter block with
    // inline verse numbers; verse → leaf.
    if (kind === 'tanakh') {
      if (sectionDepth === 1 && textD >= 1) {
        resultBox.appendChild(renderBlockView(result, { mode: 'tanakh-chapter', kind }));
        return;
      }
      if (sectionDepth === 0 && textD >= 2) {
        resultBox.appendChild(renderMultiSection(result, textD, kind));
        return;
      }
      resultBox.appendChild(renderLeaf(result));
      return;
    }

    // Mishnah / Yerushalmi / Mishneh Torah / SA / Tur / Commentary / Targum
    // / unknown: depth-driven (segments for chapter, nav-grid for book).
    if (textD === 0) {
      resultBox.appendChild(renderLeaf(result));
    } else if (textD === 1) {
      resultBox.appendChild(renderSection(result, kind));
    } else {
      resultBox.appendChild(renderMultiSection(result, textD, kind));
    }
  }

  /** Reload a navStack entry. Handles both ref entries and the special
   *  "_isCategory" entry that points back to a category navigator. */
  function reloadStackEntry(entry) {
    if (!entry) return;
    if (entry._isCategory) {
      if (entry._node) renderTreeNode(entry._node, entry.heRef);
      else if (entry._books) renderCategoryNav(entry.heRef, entry._books);
      else if (typeof entry._onBack === 'function') entry._onBack();
    } else {
      loadRef(entry.ref);
    }
  }

  function renderBreadcrumb(result) {
    const crumbs = el('div', { class: 'crumbs' });

    if (navStack.length > 0) {
      const back = el('button', {
        type: 'button',
        class: 'crumbs__back',
        text: '→ חזרה',
        onclick: () => {
          const prev = navStack.pop();
          reloadStackEntry(prev);
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
          reloadStackEntry(item);
        },
      });
      path.appendChild(link);
      path.appendChild(el('span', { class: 'crumbs__sep', text: ' › ' }));
    }
    const current = el('span', {
      class: 'crumbs__current mixed-content',
      text: displayTitleFor(result),
    });
    path.appendChild(current);
    crumbs.appendChild(path);

    return crumbs;
  }

  /* -------------------- shared head/body/actions builders -------------------- */

  /** Card header: prev (right), title centered, next (left). The three
   *  slots are flex/grid columns so they stay on a single row. */
  function buildCardHead(result) {
    const title = displayTitleFor(result);
    const category = (result.heCategories || []).join(' • ');

    const prevSlot = el('div', { class: 'result-card__nav-slot result-card__nav-slot--prev' });
    if (result.prev) {
      prevSlot.appendChild(el('button', {
        type: 'button',
        class: 'btn btn--ghost btn--small',
        text: '→ הקודם',
        title: result.prev,
        onclick: () => loadRef(result.prev),
      }));
    }

    const nextSlot = el('div', { class: 'result-card__nav-slot result-card__nav-slot--next' });
    if (result.next) {
      nextSlot.appendChild(el('button', {
        type: 'button',
        class: 'btn btn--ghost btn--small',
        text: 'הבא ←',
        title: result.next,
        onclick: () => loadRef(result.next),
      }));
    }

    const center = el('div', { class: 'result-card__head-center' }, [
      el('div', { class: 'result-card__title mixed-content', text: title }),
      category ? el('div', { class: 'result-card__category', text: category }) : null,
    ].filter(Boolean));

    return el('div', { class: 'result-card__head' }, [prevSlot, center, nextSlot]);
  }

  /** Selection bar — shown whenever the user highlights text in `body`. */
  function buildSelectionBar(body, title, result) {
    const bar = el('div', { class: 'selection-bar', hidden: true }, [
      el('span', { class: 'selection-bar__hint', text: 'נבחר טקסט:' }),
      el('button', {
        type: 'button',
        class: 'btn btn--primary btn--small',
        text: '→ הוסף קטע נבחר',
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
          bar.hidden = true;
        },
      }),
    ]);
    body.dataset.selectable = 'true';
    body.addEventListener('mouseup', () => updateSelectionBar(body, bar));
    body.addEventListener('keyup', () => updateSelectionBar(body, bar));
    return bar;
  }

  /** Bottom action row: add + copy. */
  function buildActions(title, text, result) {
    const addBtn = el('button', {
      type: 'button',
      class: 'btn btn--primary btn--small',
      text: '→ הוסף לדף',
      onclick: () => {
        if (!text) { showToast('אין טקסט להוסיף.', 'error'); return; }
        onAddSource({
          title,
          text,
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
          await navigator.clipboard.writeText(`${title}\n\n${text}`);
          showToast('הועתק ללוח.');
        } catch { showToast('העתקה נכשלה.', 'error'); }
      },
    });
    return el('div', { class: 'result-card__actions' }, [addBtn, copyBtn]);
  }

  function buildRelatedPanel(ref) {
    const panel = el('div', { class: 'related', dataset: { state: 'idle' } });
    panel.appendChild(el('div', { class: 'related__head', text: 'טוען מקורות מקושרים…' }));
    loadRelatedInto(ref, panel);
    return panel;
  }

  /* -------------------- leaf view -------------------- */

  function renderLeaf(result) {
    const heText = cleanSefariaText(flattenSefariaText(result.hebrew));
    const title = displayTitleFor(result);
    const head = buildCardHead(result);
    const body = el('div', {
      class: 'result-card__body',
      text: heText || '— אין טקסט עברי זמין למקור זה —',
    });
    const selectionBar = buildSelectionBar(body, title, result);
    const actions = buildActions(title, heText, result);
    const actionsTop = buildActions(title, heText, result);
    actionsTop.classList.add('result-card__actions--top');
    const relatedPanel = buildRelatedPanel(result.ref);
    return el('div', { class: 'result-card' }, [head, actionsTop, body, selectionBar, actions, relatedPanel]);
  }

  /* -------------------- block view (Tanakh chapter, Bavli amud/daf) -------------------- */

  function renderBlockView(result, { mode } = {}) {
    const title = displayTitleFor(result);
    const head = buildCardHead(result);
    const segments = result.hebrew;

    const body = el('div', { class: 'result-card__body block-body' });
    let plainText = '';
    // For Tanakh chapter mode, also expose a "paragraph" version (no
    // verse numbers, no line breaks) so the user can add it via an
    // alternate button.
    let plainTextParagraph = '';

    if (mode === 'tanakh-chapter') {
      const verses = (Array.isArray(segments) ? segments : []).map((s, i) => ({
        label: presentHebrewLetters(numToHebrewLetters(i + 1)),
        text: cleanSefariaText(flattenSefariaText(s)),
      })).filter((v) => v.text);
      for (const v of verses) {
        body.appendChild(el('div', { class: 'block-body__line' }, [
          el('span', { class: 'block-body__num', text: v.label }),
          el('span', { class: 'block-body__text', text: ' ' + v.text }),
        ]));
      }
      plainText = verses.map((v) => `${v.label} ${v.text}`).join('\n');
      // Paragraph mode: continuous flow with a period at the end of each
      // verse if it doesn't already end in one (Sefaria texts usually
      // end with sof-pasuq ׃, kept inline).
      plainTextParagraph = verses
        .map((v) => /[.?!׃:]$/.test(v.text) ? v.text : `${v.text}.`)
        .join(' ');
    } else if (mode === 'bavli-daf') {
      // segments may be depth-2 ([amudA lines, amudB lines]) for "Sukkah 2",
      // or depth-1 if Sefaria returned the daf flattened. Handle both.
      const arr = Array.isArray(segments) ? segments : [];
      const isTwoAmudim = arr.length > 0 && Array.isArray(arr[0]);
      const amudA = isTwoAmudim ? (arr[0] || []) : arr;
      const amudB = isTwoAmudim ? (arr[1] || []) : [];
      const textA = cleanSefariaText(amudA.map(flattenSefariaText).join(' '));
      const textB = cleanSefariaText(amudB.map(flattenSefariaText).join(' '));
      if (textA) {
        body.appendChild(el('div', { class: 'block-body__amud' }, [
          el('span', { class: 'block-body__amud-label', text: 'עמוד א' }),
          el('span', { class: 'block-body__text', text: ' ' + textA }),
        ]));
      }
      if (textB) {
        body.appendChild(el('div', { class: 'block-body__amud' }, [
          el('span', { class: 'block-body__amud-label', text: 'עמוד ב' }),
          el('span', { class: 'block-body__text', text: ' ' + textB }),
        ]));
      }
      plainText = [textA && `עמוד א: ${textA}`, textB && `עמוד ב: ${textB}`].filter(Boolean).join('\n\n');
    } else if (mode === 'bavli-amud') {
      // segments is depth-1: array of lines. Concatenate to one paragraph.
      const lines = Array.isArray(segments) ? segments : [];
      plainText = cleanSefariaText(lines.map(flattenSefariaText).join(' '));
      body.textContent = plainText || '— אין טקסט עברי זמין —';
    } else {
      plainText = cleanSefariaText(flattenSefariaText(segments));
      body.textContent = plainText || '— אין טקסט עברי זמין —';
    }

    const selectionBar = buildSelectionBar(body, title, result);
    const actions = buildActions(title, plainText, result);
    // Tanakh chapters: add a secondary button that adds the chapter as
    // one paragraph (no verse numbers, continuous flow).
    if (mode === 'tanakh-chapter' && plainTextParagraph) {
      actions.appendChild(el('button', {
        type: 'button',
        class: 'btn btn--ghost btn--small',
        text: '→ הוסף כפסקה (ללא מספרי פסוקים)',
        onclick: () => {
          onAddSource({
            title,
            text: plainTextParagraph,
            sefariaRef: result.ref,
            sefariaHeRef: result.heRef,
          });
          showToast(`נוסף לדף: ${truncate(title, 40)}`);
        },
      }));
    }
    // Mirror the action row at the top of the card too — for long
    // texts it saves scrolling all the way down to the add button.
    const actionsTop = buildActions(title, plainText, result);
    actionsTop.classList.add('result-card__actions--top');
    const relatedPanel = buildRelatedPanel(result.ref);
    return el('div', { class: 'result-card' }, [head, actionsTop, body, selectionBar, actions, relatedPanel]);
  }

  /* -------------------- Bavli book nav (daf-level grid) -------------------- */

  function renderBavliBookNav(result) {
    const arr = Array.isArray(result.hebrew) ? result.hebrew : [];
    // Sefaria stores Bavli arrays with placeholders for daf 1 at indices
    // 0 (="1a") and 1 (="1b") — the page traditionally has no content in
    // Bavli (the tractate begins at daf 2). So daf N's amudim sit at
    // arr[(N-1)*2] and arr[(N-1)*2 + 1]; daf 1's entries are empty and
    // filtered out by the hasA/hasB check below.
    const numDapim = Math.ceil(arr.length / 2);
    const head = buildCardHead(result);
    const hint = el('div', { class: 'browser__hint', text: 'בחר דף:' });
    const grid = el('div', { class: 'nav-grid' });
    for (let i = 0; i < numDapim; i++) {
      const hasA = arr[i * 2] && (Array.isArray(arr[i * 2]) ? arr[i * 2].length : true);
      const hasB = arr[i * 2 + 1] && (Array.isArray(arr[i * 2 + 1]) ? arr[i * 2 + 1].length : true);
      if (!hasA && !hasB) continue;
      const dafNum = i + 1;
      const dafHe = presentHebrewLetters(numToHebrewLetters(dafNum));
      const subRef = `${result.ref} ${dafNum}`;
      grid.appendChild(el('button', {
        type: 'button',
        class: 'nav-grid__item mixed-content',
        text: `דף ${dafHe}`,
        title: subRef,
        onclick: () => loadRef(subRef, {
          drillFrom: { ref: result.ref, heRef: result.heRef },
        }),
      }));
    }
    return el('div', { class: 'result-card' }, [head, hint, grid]);
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

  function renderSection(result, kind = null) {
    const segments = Array.isArray(result.hebrew) ? result.hebrew : [];
    const title = displayTitleFor(result);
    const parsed = parseHeRef(result.heRef, result.heCategories);
    const effectiveKind = kind || parsed?.kind || null;
    const heSectionName = (result.heSectionNames || []).slice(-1)[0] || defaultSegNameFor(effectiveKind, 1);
    const lastAddressType = (result.addressTypes || []).slice(-1)[0] || 'Integer';

    // Combined text (entire section) for the "add all" button.
    const fullText = segments
      .map((s, i) => `${subSectionHeLabel(lastAddressType, heSectionName, i)}. ${cleanSefariaText(flattenSefariaText(s))}`)
      .filter(Boolean)
      .join('\n');

    const head = buildCardHead(result);

    const addAllBtn = el('button', {
      type: 'button',
      class: 'btn btn--primary btn--small',
      text: '→ הוסף את כל הקטע',
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
      const segTitle = buildSegmentCitation(parsed, idx, lastAddressType) || `${title}, ${segHeLabel}`;
      const addBtn = el('button', {
        type: 'button',
        class: 'btn btn--primary btn--small',
        text: '→ הוסף',
        onclick: () => {
          onAddSource({
            title: segTitle,
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

  function renderMultiSection(result, depth, kind = null) {
    const arr = Array.isArray(result.hebrew) ? result.hebrew : [];
    const parsed = parseHeRef(result.heRef, result.heCategories);
    const effectiveKind = kind || parsed?.kind || null;
    const sectionNameIdx = (result.heSectionNames?.length || 0) - depth;
    const heSectionName = (result.heSectionNames || [])[sectionNameIdx] || defaultSegNameFor(effectiveKind, depth);
    const addressType = (result.addressTypes || [])[sectionNameIdx] || 'Integer';

    const head = buildCardHead(result);
    const hint = el('div', {
      class: 'browser__hint',
      text: `בחר ${heSectionName} כדי לצפות / להוסיף:`,
    });

    const grid = el('div', { class: 'nav-grid' });
    // We intentionally DO NOT skip apparently-empty children here:
    // Sefaria's v3 response can leave the top level of a complex book
    // sparse (e.g. Mishnah Bikkurim shows only chapter 4 because the
    // first three chapters are nested under a sub-schema). The user
    // can still click through and we'll surface any errors inline.
    arr.forEach((child, idx) => {
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

      const addAll = el('button', {
        type: 'button',
        class: 'btn btn--ghost btn--small related-group__add-all',
        text: `→ הוסף את כל ${group.def.he}`,
        onclick: () => addAllInGroup(group, parentRef),
      });
      details.appendChild(addAll);

      const list = el('ul', { class: 'related-list' });
      // For commentaries, fold the same commentator's sub-comment refs into
      // one aggregate row — much easier to scan, and "↕ הרחב" then yields the
      // full commentary on the verse instead of a single sub-comment.
      const rows = group.def.key === 'Commentary'
        ? groupByCommentator(group.items).map(renderCommentaryAggregate)
        : group.items.map((link) => renderCommentaryAggregate({ items: [link] }));
      for (const row of rows) list.appendChild(row);
      details.appendChild(list);
      container.appendChild(details);
    }
  }

  /**
   * Aggregate consecutive related-links by the same commentator/collective
   * title. Each output item has { heName, items }; aggregates of length > 1
   * collapse to a single row whose expand/add use the common parent ref.
   */
  function groupByCommentator(items) {
    const order = [];
    const map = new Map();
    for (const item of items) {
      const key = item.heCommentator || item.commentator || item.heCollectiveTitle || item.collectiveTitle || item.heRef || item.ref;
      if (!map.has(key)) {
        const group = {
          key,
          heName: item.heCommentator || item.heCollectiveTitle || item.heRef || key,
          items: [],
        };
        map.set(key, group);
        order.push(group);
      }
      map.get(key).items.push(item);
    }
    return order;
  }

  /**
   * Strip the trailing ":<n>" sub-comment from a commentary ref to find the
   * shared parent (e.g. "Rashi on Genesis 1:1:1" → "Rashi on Genesis 1:1").
   * Returns null if the refs don't share a common parent.
   */
  function commonParentRef(items) {
    if (!items?.length) return null;
    if (items.length === 1) return items[0].ref;
    const parents = items.map((it) => String(it.ref || '').replace(/:\d+$/, ''));
    return parents.every((p) => p === parents[0]) ? parents[0] : items[0].ref;
  }

  /** Build a richer title for a related-item row. The /api/related/
   *  endpoint sometimes returns just the parent-text's heRef (e.g.
   *  "בראשית") for a commentary like מי השילוח — without the work
   *  name. We prepend `heCommentator` / `heCollectiveTitle` when it's
   *  missing from the heRef itself. */
  function enrichItemTitle(link) {
    const heRef = link.heRef || '';
    const heCats = link.heCategories || (link.heCategory ? [link.heCategory] : []);
    const formatted = heRef ? (formatMarehMakom(heRef, heCats) || heRef) : '';

    // Find the Hebrew work name. Sefaria's /api/related/ links don't
    // always populate heCommentator / heCollectiveTitle, so when those
    // are missing we extract the work name from the English ref (the
    // first comma-separated segment is always the title in Sefaria's
    // ref format, e.g. "Mei HaShiloach, Bereshit, Bereshit 1") and
    // look it up in our local TOC to translate to Hebrew.
    let work = link.heCommentator || link.heCollectiveTitle || link.heBook || '';
    if (!work && link.ref) {
      const enWork = String(link.ref).split(',')[0].trim();
      if (enWork) {
        const tocEntry = tocBooks.find((b) => b.title === enWork || b.heTitle === enWork);
        work = tocEntry ? tocEntry.heTitle : enWork;
      }
    }

    const base = formatted || heRef || link.ref || '';
    if (work && base && !base.includes(work)) return `${work}, ${base}`;
    return base || work || '';
  }

  function renderCommentaryAggregate(group) {
    const items = group.items;
    const isAggregate = items.length > 1;
    const parentRef = commonParentRef(items);
    const primary = items[0];
    // Display title: prefer formatted heRef of the parent for aggregates,
    // else the single item's heRef. If Sefaria's /api/related/ returns a
    // bare heRef (e.g. "בראשית" for "Mei HaShiloach on Genesis"), prepend
    // the commentator/work name so the user knows which work it belongs to.
    const aggTitle = isAggregate
      ? `${group.heName || primary.heCommentator || primary.heRef} (${items.length} הערות)`
      : enrichItemTitle(primary);

    const wrap = el('li', { class: 'related-item', dataset: { ref: parentRef } });

    const openBtn = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--small',
      text: '🔎 פתח',
      title: 'פתח כמקור הראשי וצפה במקורות המקושרים אליו',
      onclick: () => {
        const target = parentRef || primary.ref;
        loadRef(target, {
          drillFrom: currentResult ? { ref: currentResult.ref, heRef: currentResult.heRef } : null,
        });
      },
    });

    const expandBtn = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--small related-item__expand',
      text: '↕ הרחב',
      onclick: () => toggleAggregateExpansion(wrap, group),
    });

    const addBtn = el('button', {
      type: 'button',
      class: 'btn btn--primary btn--small',
      text: '→ הוסף',
      onclick: () => addAggregateToSheet(group),
    });

    const head = el('div', { class: 'related-item__head' }, [
      el('span', { class: 'related-item__title mixed-content', text: aggTitle }),
      el('div', { class: 'related-item__actions' }, [expandBtn, openBtn, addBtn]),
    ]);

    const body = el('div', { class: 'related-item__body', hidden: true });
    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  async function toggleAggregateExpansion(wrap, group) {
    const body = wrap.querySelector('.related-item__body');
    const btn = wrap.querySelector('.related-item__expand');
    if (!body) return;
    if (!body.hidden) {
      body.hidden = true;
      if (btn) btn.textContent = '↕ הרחב';
      return;
    }
    if (body.dataset.loaded === 'true') {
      body.hidden = false;
      if (btn) btn.textContent = '↕ כווץ';
      return;
    }
    body.hidden = false;
    if (btn) btn.textContent = '↕ כווץ';
    body.textContent = 'טוען…';
    try {
      const parentRef = commonParentRef(group.items);
      const result = await fetchText(parentRef);
      const text = cleanSefariaText(flattenSefariaText(result.hebrew)) ||
                   cleanSefariaText(flattenSefariaText(result.english));
      // Render an explicit citation header inside the expanded body so
      // the user can tell which work and which reference this snippet
      // belongs to (e.g. "אור לשמים, לך לך, ה'" instead of just "לך לך").
      body.textContent = '';
      const fullCitation = displayTitleFor(result);
      if (fullCitation) {
        body.appendChild(el('div', { class: 'related-item__sub-ref mixed-content', text: fullCitation }));
      }
      body.appendChild(el('div', { class: 'related-item__sub-text', text: text || '— אין טקסט זמין —' }));
      body.dataset.loaded = 'true';
      body.dataset.text = text;
      body.dataset.ref = result.ref || parentRef;
      body.dataset.heRef = result.heRef || '';
    } catch (err) {
      console.warn('[browser] aggregate expand failed:', err);
      body.textContent = 'שגיאה בטעינת המקור.';
      if (btn) btn.textContent = '↕ הרחב';
    }
  }

  async function addAggregateToSheet(group) {
    try {
      const parentRef = commonParentRef(group.items);
      // If user already expanded, reuse cached text.
      const cachedBody = document.querySelector(
        `.related-item[data-ref="${cssEscape(parentRef)}"] .related-item__body[data-loaded="true"]`
      );
      let result;
      let text;
      if (cachedBody?.dataset.text) {
        text = cachedBody.dataset.text;
        result = {
          ref: cachedBody.dataset.ref || parentRef,
          heRef: cachedBody.dataset.heRef || group.items[0]?.heRef || parentRef,
          heCategories: group.items[0]?.heCategory ? [group.items[0].heCategory] : [],
        };
      } else {
        result = await fetchText(parentRef);
        text = cleanSefariaText(flattenSefariaText(result.hebrew));
      }
      if (!text) { showToast('אין טקסט להוסיף.', 'error'); return; }
      const title = displayTitleFor(result);
      onAddSource({
        title,
        text,
        sefariaRef: result.ref || parentRef,
        sefariaHeRef: result.heRef || group.items[0]?.heRef || parentRef,
      });
      showToast(`נוסף לדף: ${truncate(title, 40)}`);
    } catch (err) {
      console.warn('[browser] add aggregate failed:', err);
      showToast('לא הצלחנו להוסיף את המקור.', 'error');
    }
  }

  async function addAllInGroup(group, parentRef) {
    // For Commentary, add one card per commentator (aggregated). For others,
    // add one card per individual link.
    const isCommentary = group.def.key === 'Commentary';
    const items = isCommentary ? groupByCommentator(group.items) : group.items.map((l) => ({ items: [l] }));
    if (!items.length) return;
    if (items.length > 25 && !confirm(`${items.length} מקורות בקבוצה הזו — בטוח להוסיף את כולם?`)) return;
    showToast(`מוסיף ${items.length} מקורות מ${group.def.he}…`);
    let added = 0;
    for (const g of items) {
      try {
        const ref = commonParentRef(g.items);
        const result = await fetchText(ref);
        const text = cleanSefariaText(flattenSefariaText(result.hebrew));
        if (!text) continue;
        const title = displayTitleFor(result);
        onAddSource({
          title, text,
          sefariaRef: result.ref,
          sefariaHeRef: result.heRef,
        });
        added++;
      } catch (err) {
        console.warn('[browser] add-all skipped:', g.items[0]?.ref, err);
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
