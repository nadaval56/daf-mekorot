# דף מקורות — מדריך פיתוח עבור Claude

> **קרא את הקובץ הזה לפני שאתה משנה קוד.** הוא מתעדכן ושומר על הלקחים שהצטברו תוך כדי עבודה.
> פרויקט: `daf-mekorot` • אירוח: GitHub Pages (`main` → אוטומטי) • ענף פיתוח: `claude/torah-resources-page-Iqkrw`.

---

## 1. סקירה כללית

כלי web סטטי לבניית **דפי מקורות** לשיעורי תורה, עם אינטגרציה ל-API של [ספריא](https://www.sefaria.org). קהל היעד: מורי שיעורי שבת ומחנכים בחינוך תורני.

עיקרון מנחה: דף מודפס יפה וקריא, RTL מושלם, זרימת עבודה מהירה מצפייה אל בנייה. **שום build process** — HTML/CSS/Vanilla JS בלבד.

---

## 2. מחסנית טכנולוגית

- **Frontend בלבד:** HTML5, CSS3, JS Vanilla עם ES modules.
- **API:** Sefaria public API (CORS פתוח). אנדפויינטים בשימוש:
  - `/api/v3/texts/<ref>?version=hebrew&version=english&return_format=text_only` — טקסט.
  - `/api/v2/index/<title>` — schema של ספר (לטיפול ב-complex schema).
  - `/api/related/<ref>` — מקורות מקושרים.
  - `/api/name/<query>` — autocomplete.
  - `/api/index` — עץ ה-TOC המלא (נטען פעם אחת ב-init).
- **שמירה:** `localStorage` בלבד.
- **פונטים:** Google Fonts (Frank Ruhl Libre, David Libre, Bellefair, Heebo).
- **בניית עץ ניווט:** מבוסס literally על `/api/index` של ספריא, **לא** על קיבוץ heuristic של ספרים שטוחים. ראה סעיף 4.

---

## 3. ארכיטקטורה ומבנה קבצים

תצוגת ראשי = **Split View** דו-פאנלי. ימני = דף המקורות (`ui-sheet.js`). שמאלי = דפדפן ספריא (`ui-browser.js`).

```
/
├── index.html                # שלד DOM
├── css/
│   ├── main.css             # layout + עיצוב מסך
│   ├── rtl.css              # התאמות RTL
│   ├── print.css            # @media print (PDF)
│   └── fonts.css            # פונטים
├── js/
│   ├── app.js               # אתחול, wiring, modals (הגדרות + ספרייה)
│   ├── sefaria-api.js       # client + cache + complex-schema fallback
│   ├── sources.js           # מודל Sheet (CRUD), observable
│   ├── storage.js           # localStorage layer
│   ├── ui-sheet.js          # פאנל ימני: כרטיסים, גרירה, בס"ד dropdown
│   ├── ui-browser.js        # פאנל שמאלי: עץ + chips + related + selection
│   ├── export.js            # window.print() + ייצוא JSON
│   └── utils.js             # text helpers + Hashem-kinnui + formatMarehMakom
├── assets/favicon.svg
├── CLAUDE.md                # קובץ זה
└── README.md
```

**עקרון:** קובץ JS אחד לכל אחריות. מונע context bloat ומקל איתור באגים.

---

## 4. ניווט בקטגוריות — שיעורים שלמדנו בדם

זה ה-section החשוב ביותר. **קרא לפני שאתה נוגע ב-`ui-browser.js`.**

### 4.1 השיטה: לכת אחרי עץ ה-TOC של ספריא literally

עץ הניווט (chips → קוביות תת-קטגוריה → ספרים) **חייב לעקוב אחרי המבנה ש-`/api/index` מחזיר**. כל לחיצה מציגה את ה-`contents` הישיר של הצומת הנוכחי — בלי המצאות.

האימפלמנטציה:
- `tocRawTree` — שמירה של העץ הגולמי כפי שספריא החזירה.
- `findTreeNodeByPath(pathEn)` — הולך לפי `category` segments.
- `commonPathEn(books)` — מוצא prefix משותף של books מ-curated chip → ככה ה-chip יודע איזה צומת לפתוח.
- `renderTreeNode(node, label, prevCrumb)` — מציג את `node.contents` כקוביות. צומת עם `contents` → drilldown. עלה (book) → `loadRef(title)`.

**אל תעשה:**
- ❌ אל תכתוב אלגוריתם heuristic מסוג "find variation depth + group by path segment". זה ניסיתי, וזה יצר קוביות-אב מזויפות כמו "אגדת בראשית" מקבצת אליה ספרים שאינם תחתיה, "שולחן ערוך הקדמה" מקבצת את כל השו"ע, "הערות שוליים על מכילתא" מקבצת מדרשי הלכה. הקטגוריות שספריא הגדירה הן הקטגוריות. אם משהו נראה "מעניין לקבץ", זה כמעט תמיד טעות.
- ❌ אל תניח ש-`pathEn.length === N` קבוע. ספרים תחת `Tanakh/Torah/Genesis` יקבלו `pathEn = ['Tanakh', 'Torah']` (אורך 2 — נתיב ההורה, **לא כולל** את שם הספר). פרשנים תחת `Tanakh/Commentary/Rashi/Rashi on Genesis` יקבלו `pathEn = ['Tanakh', 'Commentary', 'Rashi']` (אורך 3). ה-filter ל-24 ספרי תנ"ך הוא `pathEn.length === 2 && pathEn[1] in {Torah, Prophets, Writings}`.

### 4.2 קטגוריות synthetic

קטגוריות שאין להן צומת ב-TOC של ספריא ושאני בכל זאת רוצה להציג כ-chip:

| chip | תוכן | איך בנוי |
|------|------|----------|
| `פרשנות תנ"ך` | רש"י, רמב"ן, רד"ק, וכו' | filter על `pathEn.some(p => /Commentary/i.test(p))`. fallback: `heTitle` מכיל ` על `. |
| `פרשנות משנה` | ברטנורא, יכין, בועז, וכו' | אותו דבר עבור Mishnah. |

לאחר הסינון, ה-chip מקבל את `books` שלו. אם `commonPathEn` של ה-books מצביעה על צומת ב-`tocRawTree`, ה-tree-nav נכנס לתפקיד. אחרת, fallback ל-`renderHierarchicalCategoryNav` (קיבוץ לפי commentator).

**ברירת מחדל:** אם אפשר tree-based — תמיד עדיף.

### 4.3 כפתור חזרה — שמור את ה-chain

כשמלחיצים על קוביית-ספר בתוך עץ, `drillFrom` חייב להכיל:
```js
{ ref: '__category__', heRef, _isCategory: true, _node, _label, _prevCrumb }
```

`_prevCrumb` שומר את שרשרת ה-back של הרמות מעל. `reloadStackEntry` מעביר אותה חזרה ל-`renderTreeNode`. ככה הכפתור "→ חזרה" ממשיך להופיע עד שמגיעים לראש העץ — ולא נעלם אחרי לחיצה אחת.

### 4.4 ספרים בעלי SchemaNode מורכב (Zohar, Sifra, Mishneh Torah, פרשנויות)

`/api/v3/texts/<title>` לטרקטטים פשוטים מחזיר טקסט. ל-SchemaNodes זה עשוי לזרוק 500 או להחזיר מבנה לא תקין. ב-`loadRef` יש fallback בשתי שכבות:

1. `SefariaError.code` ∈ {`server`, `not_found`, `parse`} → ננסה `fetchIndexFor(refOrName)`.
2. אם `idx.isComplex && idx.nodes.length` → `drillIntoIndex(idx, refOrName)` מטייל **בתוך ה-schema** לפי הפלגי ה-comma של ה-ref.
3. אם ה-node שהגענו אליו יש לו sub-nodes → `renderComplexBookIndex(drilled.ref, drilled.node)` מציג קוביות עם ה-ref **הנכון** של הרמה הזאת.
4. אם הגענו ל-leaf (כמו "פרק א" שלא נטען) → **walk-up אוטומטי** ל-parent + toast "לא הצלחנו לטעון X — מציג את הרמה הקודמת".

**למה drillIntoIndex נחוץ:** Sefaria's `/api/v2/index/X, Y, Z` **מתעלם מ-",Y,Z"** ומחזיר את ה-index של `X` בלבד. בלי drillIntoIndex היינו מציגים את ה-cubes של `X` כאילו הן של `X,Y,Z` → לחיצה תיצור ref מורכב יותר → 400 → לולאה.

**ב-`renderComplexBookIndex`:** ה-onclick של כל קובייה **תמיד קורא ל-`loadRef`**, ללא חריגים. הגישה הקודמת (`hasSubNodes ? recurse : loadRef`) מנעה ניסיון לטעון טקסט ברמת ביניים — מה שגרם לספרים כמו ברכת אברהם להציג אינסוף קוביות. עם drillIntoIndex + walk-up מהשלב הקודם, אין לולאה גם בלי ה-recursion הישיר. עלות: HTTP roundtrip מיותר על לחיצת קובייה (~50ms) — שווה.

**אזהרת לולאה ההיסטורית** (Sifra → Tzav → Shemini, 400 על "Sifra, Tzav, Shemini"): נפתרה ע"י drillIntoIndex. אם אתה משחזר התנהגות שונה ב-`renderComplexBookIndex` — ודא שאתה לא משחזר גם את הלולאה.

### 4.5 תלמוד בבלי — Daf 1 ב-Placeholder

ספריא שומרת את מערך הטקסטים של בבלי **כשאינדקסים 0,1 הם placeholders ריקים לדף א'** (כי אין דף א' בבבלי — תמיד מתחילים מדף ב'). ה-tractate-level grid (`renderBavliBookNav`) חייב להתחיל מ-`dafNum = i + 1` (לא `2 + i`), עם סינון של דף עם amudim ריקים. אותה פילוסופיה ב-`talmudHeLabel` ו-`talmudEnLabel`.

### 4.6 זיהוי קטגוריה — קטגוריות **אנגליות** ולא heRef

ב-`detectKind(result)` משתמשים ב-`result.categories` (אנגלית), לא ב-`heCategories`. הסיבה: heRef ועברית משתנים בין תגובות (גרשיים שונים, range refs מרגיזים), בעוד שהאנגלית של ספריא יציבה.

נווט בעומק: `result.sections.length` (גם של ספריא) במקום parse של heRef. `sections.length === 0` = ספר שלם, `=== 1` = פרק/דף, `=== 2` = פסוק/עמוד/משנה.

### 4.7 פרשנויות דלילות (sparse) — הצגה inline בעומק פרק+

הרבה ספרי פרשנות אינם כותבים על כל פסוק/הלכה/משנה. **ברכת אברהם על משנה תורה** הוא דוגמה: בפרק א של הלכות קריאת שמע יש לו הערה רק על הלכה ט.

**איך זה נראה ב-API**: בקשה ל-ref ברמת פרק (למשל `Birkat Avraham on Mishneh Torah, Reading the Shema 1`) מצליחה ומחזירה `hebrew = [[empty, empty, …, "טקסט של הלכה ט"]]` (`textDepth=2`, רוב האיברים ריקים). בקשה ל-ref ברמת הלכה ריקה (`...Reading the Shema 1 1`) מחזירה **404**.

**ההיגיון של ה-UX**: כשהמשתמש כבר ירד לעומק פרק, אסור לבקש ממנו לבחור הלכה ספציפית — כי רובן לא קיימות, וגם אם כן, הוא בא לראות את הפרק, לא לבחור שוב.

**הפתרון ב-`renderResult`** (מסלול ברירת המחדל, לא tanakh/bavli):
```js
if (sectionDepth >= 1 && textD >= 2 && Array.isArray(result.hebrew)) {
  // unwrap one level — render inline as segments, not as a sub-cube picker
  let flatHebrew;
  if (result.hebrew.length === 1 && Array.isArray(result.hebrew[0])) {
    flatHebrew = result.hebrew[0];           // single-chapter outer wrap
  } else {
    flatHebrew = result.hebrew.map(s =>
      Array.isArray(s) ? flattenSefariaText(s) : (s ?? '')
    );
  }
  renderSection({ ...result, hebrew: flatHebrew }, kind);
}
```

**בונוס חינם**: `renderSection` כבר מסנן segments ריקים (`if (!segText) return;`), אז בפועל המשתמש רואה רק את הלכה ט (במקרה של ברכת אברהם) — בלי 8 שורות ריקות.

**מה זה לא מתקן**: ספרים שספריא בכלל לא מגישה ברמת הפרק (אז ה-loadRef נכשל מההתחלה — נופלים למסלול ה-error UI מסעיף 4.8).

### 4.8 שגיאות טעינה — מסלולי מילוט

כש-`loadRef` נכשל **גם אחרי** ה-drill + walk-up מסעיף 4.4, המשתמש מקבל error block עם שלושה כפתורי פעולה:

- **→ חזרה** — חוזר ל-`drillFrom` או ל-`navStack[top]`. תיקון באג מימי קדם: `drillFrom` נדחף ל-`navStack` רק **אחרי** fetch מוצלח, אז ב-catch אנחנו משתמשים ב-`drillFrom` ישירות כ-fallback אם ה-stack ריק.
- **↻ נסה שוב** — `loadRef(refOrName)` חוזר על עצמו (שגיאות חולפות).
- **🌐 פתח בספריא** — קישור לאתר ספריא, `https://www.sefaria.org/${encodeURIComponent(ref.replace(/\s+/g, '_'))}?lang=he`. נשמר כקופסת מילוט סופית.

---

## 5. פורמטי מראה מקום (`formatMarehMakom`)

כל מראה מקום חייב להיות בעברית. **אסור לאפשר fallback לרפרנס האנגלי** — שום מקום בקוד.

| קטגוריה | פורמט | הערות |
|---------|--------|--------|
| תנ"ך | `<ספר>, פרק X, פסוק Y` | פסיק בין פרק לפסוק. |
| משנה | `משנה <מסכת>, פרק X משנה Y` | "משנה" כקידומת — מבדיל מבבלי באותו שם. |
| תלמוד בבלי | `<מסכת>, דף X עמוד א/ב` | בלי "מסכת" / "תלמוד" כקידומת. |
| תלמוד ירושלמי | `ירושלמי <מסכת>, פרק X הלכה Y` | פסיק אחד, לא שניים. |
| משנה תורה | `משנה תורה לרמב"ם, הלכות <נושא>, פרק X, הלכה Y` |  |
| שו"ע / טור | `שולחן ערוך, <חלק>, סימן X סעיף Y` |  |
| תרגומים | `תרגום <שם> על <מראה-מקום-תנ"ך>` | recurse על ה-inner. |
| פרשנים | `<פרשן> על <מראה-מקום-תנ"ך>` | רמת ההערה (`א:א:א`) נחתכת — רק פרק:פסוק. |

מספרים: אות בודדת **בלי גרשיים** (`פרק א`), רב-תווית **עם גרשיים** (`פרק י״ב`). ניקוד של אותיות שמורים (`וְהָאָרֶץ`), טעמים מוסרים תמיד (`removeTeamim`).

`parseHeRef` משתמש ב-`heCategories` לזיהוי שם הספר (תופס שמות מורכבים כמו "מלכים א" או "הלכות תפלה וברכת כהנים"). אם נכשל, נופל ל-whitespace split של המילה הראשונה.

---

## 6. החלפת שם ה' בכינוי (`applyHashemKinnui`)

הגדרה: `replaceHashemName`, **ברירת מחדל ON**.

| שם | החלפה | תנאי |
|----|--------|-------|
| יהוה | י-הוה | תמיד (גם עם קידומות כמו ויהוה / ליהוה). |
| אלהים | א-להים | תמיד (גם עם קידומות לאלהים / כאלהים / ולאלהים). |
| אלהי | א-להי | construct ("אלהי ישראל"). |
| אדני | א-דני | רק במקרים חד-משמעיים: (א) ניקוד אדון-אי עם **חטף-פתח** על האל"ף (`אֲ`), או (ב) "אדני" כמילה עצמאית **ללא ניקוד כלל**. דורש lookahead שלא יבוא אחרי-יוד עוד אות עברית (שלא יתפוס אדניה / אדניהו). |
| אל | א-ל | רק `אֵ` עם **צירי** (שם ה'). `אֶ` עם **סגול** (מילת יחס "אל/ל") **לא** מותאם. קידומות `ב/ה/ו/כ/ל/מ/ש` נתפסות. lookbehind מונע התאמה בתוך ישראל / אלעזר / אלא. |
| צבאות | צבא-ות | תמיד. |
| שדי | שד-י | רק כמילה עצמאית (בודקת גבול). |
| "אהיה אשר אהיה" | "אהי-ה אשר אהי-ה" | רק כצירוף שלם — לא מטפלים בפועל "אהיה" במשמעויות אחרות. |

**הפונקציה idempotent** — הרצה כפולה לא משנה.

**Edge case ידוע:** "אדני" ללא ניקוד לא מבדיל בין שם ה' לסוקלים ארכיטקטוניים ("אדני כסף"). אצלנו זה false positive — אבל המשתמש קיבל את העלוונת הזו (= "ממש טריקי").

---

## 7. ניקוי טקסט של ספריא (`cleanSefariaText`)

ספריא משאירה בטקסט:
- תגי HTML inline (`<b>`, `<i>`, `<sup>`).
- ישויות (`&nbsp;`, `&thinsp;`, `&amp;`, `&#NN;` …).
- מסמני פרשה `{פ}` `{ס}` `{ש}` `{ר}`.
- טעמי מקרא (תמיד מוסרים — ניקוד נשמר).

`cleanSefariaText` מטפל בכולם. `decodeHTMLEntities` הוא helper exported. **אסור** לדחוף טקסט שלא עבר ניקוי לכרטיס במקור.

---

## 8. מודל ה-Sheet ושמירה

`sources.js` חושף class `Sheet` עם API מפורש: `setTitle`, `setHeader('right'|'left', v)`, `updateSettings`, `replace`, `reset`, `addSefariaSource`, `addCustomSource`, `updateSource`, `removeSource`, `moveSource`, `moveSourceTo(from, target, before|after)`, `subscribe`. כל mutation יורה event ל-subscribers.

מבנה ה-Sheet:
```js
{
  id, title, createdAt, updatedAt,
  headerRight: 'בס"ד',   // chip ימני
  headerLeft: '',         // chip שמאלי (תאריך / כותרת משנה)
  settings: {
    font, fontSize, showNumbering, showDividers, showPageNumbers,
    replaceHashemName: true,   // default ON
    margins,
  },
  sources: [
    { id, type: 'sefaria'|'custom', title, text, sefariaRef, sefariaHeRef,
      originalText, hasBeenEdited },
    ...
  ]
}
```

`storage.js` חושף `loadActiveDraft`/`saveActiveDraft`/`loadSavedSheets`/`saveSheetToLibrary`/`deleteSavedSheet`/`duplicateSavedSheet`/`loadUserSettings`/`saveUserSettings`. Auto-save על ה-active draft מתבצע debounced 300ms דרך subscribe ב-`app.js`.

---

## 9. הדפסה / PDF

`window.print()` עם `@media print` ב-`print.css`. עקרונות:
- מוסתרים בהדפסה: header אפליקציה, פאנל ספריא, פעולות (פנים-כרטיס), drag handle.
- **ראש העמוד**: `.sheet__print-header` (בס"ד ימין / תאריך שמאל) → `.sheet__print-title` (כותרת באמצע). **בסדר הזה** — ה-`::before` הישן הוסר.
- **שום `page-break-inside: avoid`** על `.source-card`: מקור ארוך גולש טבעית לעמוד הבא. עם זאת, `widows`/`orphans` ו-`page-break-after: avoid` על ה-head כדי שכותרת לא תישאר לבד.
- קו מפריד בין מקורות: מגוון ב-`[data-show-dividers='true']`.
- מספרי עמודים: מוזרק דינמית כ-`<style>` עם `@page { @bottom-center { content: counter(page) " / " counter(pages); } }` כי `@page` לא ניתן לסינון לפי attribute selectors.
- **אין** קרדיט "מקור: ספריא" על דף ההדפסה (בכוונה — נשמר רק ב-footer של ה-HTML).

---

## 10. החלטות UX שכבר נסגרו

לפני שתשנה אותן — תוודא שהמשתמש באמת ביקש:
- **חיצים** ב-RTL: `→ חזרה` ו-`→ הוסף לדף / הוסף קטע נבחר / הוסף כפסקה / הוסף את כל ...`. חיצי "הקודם/הבא" של ניווט בכרטיס נשארו `→ הקודם` / `הבא ←` (הוחלט נפרד).
- **מחיקת מקור**: לחיצה על 🗑 → מחיקה מיידית, **בלי `confirm()`**.
- **בס"ד chip**: dropdown מותאם של 3 אופציות — `בס"ד` / `אחר…` (prompt) / `השאר ריק`. ה-menu עם `position: fixed` (חישוב קואורדינטות מהכפתור) כי `.panel` עוטף ב-`overflow: hidden` שחוטם dropdowns רגילים.
- **תנ"ך paragraph mode**: בנוסף ל-"הוסף לדף" יש "הוסף כפסקה (ללא מספרי פסוקים)" שמוסיף את כל הפרק כפסקה רציפה עם נקודה בסוף כל פסוק.
- **מצב הדפסה צבעוני/ש"ל**: הוסר — תמיד שחור-לבן.
- **ברירת מחדל לכינוי שם ה'**: ON.
- **"מסכתות קטנות"**: אין chip נפרד. ספריא מקננת אותם תחת תלמוד בבלי, וה-tree-nav חושף אותם שם.

---

## 11. Cache-busting

`index.html` כולל `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` (+ Pragma + Expires) כדי שעדכוני JS/CSS לא ייתקעו ב-CDN. עדיין: GitHub Pages CDN לוקח 1–2 דקות. אם משתמש מדווח "לא עובד" — בקש hard refresh לפני שאתה רואה באג.

---

## 12. סטטוס Phased Plan

(נשמר היסטורית — כל הסעיפים יושמו וקיבלו לפעמים iteration נוספת.)

- **Phase 1 (MVP)** ✅ — split view, חיפוש בסיסי, הוספה לדף, ייצוא, auto-save.
- **Phase 2 (Related)** ✅ — קיבוץ פרשנים, expand+add, group-add. אזהרה: כותרות של פריטי related חייבות לכלול שם יצירה (`enrichItemTitle` משלים מה-`tocBooks` אם ספריא משמיטה את `heCommentator`).
- **Phase 3 (Tree)** ✅ — `tocRawTree` + `renderTreeNode`. **לא** קיבוץ heuristic.
- **Phase 4 (Library)** ✅ — שמירת דפים, שכפול, מחיקה.
- **Phase 5 (Design)** ✅ — פונט, גודל, מספור, גלישה טבעית, מספרי עמודים, ביטול צבעוני/ש"ל.
- **Phase 6 (Polish)** ✅ — Hashem kinnui (כולל ניקוד-מודע), פורמט מראה מקום per-category, drag-and-drop, favicon, meta, no-cache, complex-schema fallback (כולל הגנת לולאה), back-button chain.
- **Phase 7 (Mobile + sparse-commentary fix)** ✅ — `css/mobile.css` (`@media (max-width: 900px)`): ספריא למעלה / דף למטה, דף ללא גלילה פנימית, dropdown קטגוריות אנכי, כפתורי header icon-only. בנפרד: `drillIntoIndex` + walk-up ב-`loadRef`, תמיד-loadRef ב-`renderComplexBookIndex`, inline-at-chapter+ ב-`renderResult`, error UX (חזרה / נסה שוב / פתח בספריא). ראה סעיפים 4.4 ו-4.7.

לא הוטמע: סימניות (bookmarks), ייצוא/ייבוא JSON של דפים (יש helper אבל לא מחווט ל-UI).

---

## 13. עקרונות עבודה עם Claude Code

1. **קרא את הקובץ הזה לפני שינוי.** במיוחד סעיפים 4, 5, 6.
2. **משימות אטומיות.** פיצ'ר אחד בכל PR. לא לערום.
3. **אל תמציא קטגוריות / קיבוצים.** ספריא היא ה-source of truth — תיגזרי כל מבנה מ-`/api/index`.
4. **תמיד דחוף ל-`claude/torah-resources-page-Iqkrw`, פתח PR, ואחרי הסכמת המשתמש מזג עם squash.** דפוס הקומיט: רענון העתק → דחיפה → PR → המתנה לאישור → merge.
5. **אם conflict ב-merge** (קורה תמיד כי ה-branch הקודם נקטם דרך squash) → `git fetch origin main` → `git rebase --onto origin/main <last-pushed-tip>` → `git push --force-with-lease`.
6. **תיעוד שינויים בעברית בקומיט message ו-PR body**. המשתמש קורא עברית.
7. **בדיקה לפני המשך.** ב-CI אין מערכת — אז `node --check` על כל קובץ JS לפני commit. בדיקות פונקציונליות ב-Node להגזרות regex (`applyHashemKinnui`, `parseHeRef`).
8. **שמור שמות פונקציות באנגלית, מחרוזות UI בעברית.**

---

## 14. בעיות מוכרות / TODOs פתוחים

- ספרים בעלי schema מורכב מאוד (Zohar, Sifra) — נכון לתאריך זה ה-fallback עובד לרמת sub-section ראשונה. סיבוב נוסף ייתכן ויידרש כש-Sefaria משנה schema.
- "אדני" ללא ניקוד — false positive על שמות סוקלים (אדנים, אדני כסף). המשתמש מודע.
- בדיקה ב-Safari < 16.4 — `(?<![א-ת]…)` lookbehind משתנה לא נתמך. ב-Chromium / Firefox / Safari 16.4+ הכל עובד.

---

## 15. רישיון

הטקסטים בספריא ב-Creative Commons (CC-BY-SA / CC-0). מצוין ב-footer של ה-HTML.
