// js/sefaria-api.js
// Thin client for Sefaria's public API.
// Docs: https://developers.sefaria.org/
// CORS is open; we hit the public endpoints directly from the browser.

const BASE = 'https://www.sefaria.org/api';

// Simple in-memory cache. Same ref => same text, so caching is safe.
const cache = new Map();

async function fetchJSON(url, { signal } = {}) {
  if (cache.has(url)) return cache.get(url);
  let response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new SefariaError('network', 'תקלה ברשת — בדוק את החיבור ונסה שוב.', { cause: err });
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new SefariaError('not_found', 'המקור לא נמצא. נסה ניסוח אחר או חפש בשם המלא.');
    }
    throw new SefariaError('server', `שגיאה משרת ספריא (${response.status}).`);
  }
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new SefariaError('parse', 'תשובה לא תקינה משרת ספריא.', { cause: err });
  }
  cache.set(url, data);
  return data;
}

export class SefariaError extends Error {
  constructor(code, message, opts = {}) {
    super(message, opts);
    this.name = 'SefariaError';
    this.code = code;
  }
}

/**
 * Autocomplete / name lookup. Returns suggestions for free-text queries
 * in Hebrew or English (e.g. "בראשית", "Genesis", "סוכה ב").
 *
 * Sefaria's /api/name/<query> returns an object with:
 *   { lang, type, completions: [...], completion_objects: [...], ref?, url? }
 * We normalize to a list of { label, ref, type }.
 */
export async function lookupName(query, { signal } = {}) {
  const q = (query || '').trim();
  if (!q) return [];
  const url = `${BASE}/name/${encodeURIComponent(q)}?limit=10`;
  const data = await fetchJSON(url, { signal });
  const out = [];

  if (Array.isArray(data?.completion_objects) && data.completion_objects.length) {
    for (const item of data.completion_objects) {
      out.push({
        label: item.title || item.key || item.completion || '',
        ref: item.key || item.title || '',
        type: item.type || data.type || 'ref',
      });
    }
  } else if (Array.isArray(data?.completions)) {
    for (const c of data.completions) {
      out.push({ label: c, ref: c, type: data.type || 'ref' });
    }
  }

  // If the API resolved the input itself, surface it as the first suggestion.
  if (data?.ref && !out.find((o) => o.ref === data.ref)) {
    out.unshift({ label: data.heRef || data.ref, ref: data.ref, type: 'ref' });
  }

  return out;
}

/**
 * Fetch a text by ref. Returns a normalized shape regardless of v3 quirks:
 *   {
 *     ref, heRef,
 *     categories, heCategories,
 *     hebrew: string|string[]|string[][],   // raw structured text — preserve depth
 *     english: string|string[]|string[][],
 *     primaryCategory,
 *     sectionNames, heSectionNames, addressTypes,
 *     book,
 *     raw,
 *   }
 */
export async function fetchText(ref, { signal } = {}) {
  if (!ref) throw new SefariaError('bad_input', 'יש לציין מקור.');
  const r = encodeURIComponent(ref);
  const url = `${BASE}/v3/texts/${r}?version=hebrew&version=english&return_format=text_only`;
  const data = await fetchJSON(url, { signal });

  const versions = Array.isArray(data?.versions) ? data.versions : [];
  const heVersion = versions.find((v) => v.language === 'he' || v.actualLanguage === 'he');
  const enVersion = versions.find((v) => v.language === 'en' || v.actualLanguage === 'en');

  return {
    ref: data?.ref || ref,
    heRef: data?.heRef || data?.ref || ref,
    book: data?.book || '',
    categories: data?.categories || [],
    heCategories: data?.heCategories || [],
    sectionNames: data?.sectionNames || [],
    heSectionNames: data?.heSectionNames || [],
    addressTypes: data?.addressTypes || [],
    sections: Array.isArray(data?.sections) ? data.sections : [],
    toSections: Array.isArray(data?.toSections) ? data.toSections : [],
    next: refOf(data?.next),
    prev: refOf(data?.prev),
    hebrew: heVersion?.text ?? data?.he ?? '',
    english: enVersion?.text ?? data?.text ?? '',
    primaryCategory: data?.primary_category || (data?.categories || [])[0] || '',
    raw: data,
  };
}

/** Sefaria's next/prev fields are sometimes a string, sometimes an object. */
function refOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.ref || value.url || null;
  return null;
}

/**
 * Fetch index (TOC) for a specific book. Returns schema info — sectionNames,
 * addressTypes, lengths — used by the browser UI to label drill-down items.
 */
export async function fetchIndexFor(title, { signal } = {}) {
  if (!title) throw new SefariaError('bad_input', 'יש לציין שם ספר.');
  const url = `${BASE}/v2/index/${encodeURIComponent(title)}`;
  const data = await fetchJSON(url, { signal });
  // The schema can be a JaggedArrayNode (simple) or a SchemaNode (complex,
  // e.g. Mishneh Torah with hilkhot subdivisions). For now we handle simple
  // and surface enough info that the UI can degrade gracefully on complex.
  const schema = data?.schema || {};
  return {
    title: data?.title || title,
    heTitle: data?.heTitle || schema.heTitle || '',
    sectionNames: schema.sectionNames || [],
    heSectionNames: schema.heSectionNames || [],
    addressTypes: schema.addressTypes || [],
    lengths: schema.lengths || [],
    depth: schema.depth ?? (schema.sectionNames?.length || 0),
    isComplex: !!data?.has_children || schema.nodeType === 'SchemaNode',
    categories: data?.categories || [],
    raw: data,
  };
}

/**
 * Fetch related links for a ref. Returns the raw {links, sheets, ...}.
 * The /api/related/ endpoint groups everything related to a ref: links,
 * sheets, notes, web pages. We only care about links here.
 */
export async function fetchRelated(ref, { signal } = {}) {
  if (!ref) throw new SefariaError('bad_input', 'יש לציין מקור.');
  const url = `${BASE}/related/${encodeURIComponent(ref)}`;
  return fetchJSON(url, { signal });
}

/**
 * Fetch the full Sefaria index (table of contents). Heavy, so we cache
 * the promise itself — repeated callers share one in-flight request.
 */
let indexPromise = null;
export function fetchIndex({ signal } = {}) {
  if (!indexPromise) {
    indexPromise = fetchJSON(`${BASE}/index`, { signal }).catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/** Clear in-memory caches — used by tests or manual reset. */
export function _clearCache() {
  cache.clear();
  indexPromise = null;
}
