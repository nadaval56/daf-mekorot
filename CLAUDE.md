# דף מקורות - מערכת לבניית דפי מקורות עם אינטגרציה לספריא

> מדריך פיתוח עבור Claude Code  
> פרויקט: `daf-mekorot` (שם זמני - לשנות לפי בחירה)  
> אירוח: GitHub Pages

---

## 📋 סקירה כללית

מערכת web-based לבניית "דפי מקורות" - אסופות מאורגנות של מקורות יהודיים שמשמשות מורי שיעורי שבת ומחנכים בחינוך תורני. המערכת מאפשרת:

1. דפדוף וחיפוש במאגר ספריא בעברית
2. הוספת מקורות לדף נבנה עם מטא-דאטה אוטומטי (מראה מקום)
3. הוספת תיבות טקסט עצמאיות (לטקסטים שלא בספריא או הערות אישיות)
4. עריכה, סידור, ועיצוב המקורות
5. ייצוא ל-PDF להדפסה מקצועית
6. ספריית דפים שמורים בדפדפן

**קהל יעד:** מורי שיעורי שבת, מחנכים בחינוך תורני, מכינים דפי שיעור להדפסה.

**עיקרון מנחה:** דף מודפס יפה וקריא, עברית RTL מושלמת, זרימת עבודה מהירה מצפייה אל בנייה.

---

## 🛠 מחסנית טכנולוגית

- **Frontend בלבד:** HTML5, CSS3, JavaScript (Vanilla, ללא frameworks)
- **אירוח:** GitHub Pages (static, ללא backend)
- **API חיצוני:** Sefaria API ([developers.sefaria.org](https://developers.sefaria.org/))
- **שמירה:** localStorage בלבד
- **פונטים:** Google Fonts (Hebrew web fonts)

**למה Vanilla JS?** פשטות, ביצועים על GitHub Pages, אין תלות ב-build process, קל לעריכה ידנית, מתאים לעבודה איטרטיבית עם Claude Code.

---

## 🏗 ארכיטקטורה

### תצוגה ראשית - Split View

```
+----------------------+----------------------+
|                      |                      |
|   דף המקורות         |   דפדפן ספריא        |
|   (פאנל ימני)         |   (פאנל שמאלי)       |
|                      |                      |
|   - כותרת השיעור      |   - חיפוש/דפדוף       |
|   - רשימת מקורות      |   - הצגת פסוק/מקור   |
|   - תיבה עצמאית       |   - מקורות מקושרים   |
|   - הגדרות עיצוב      |   - כפתורי "הוסף ←" |
|   - ייצוא/שמירה       |                      |
|                      |                      |
+----------------------+----------------------+
```

### מבנה תיקיות

```
/
├── index.html                # נקודת כניסה
├── css/
│   ├── main.css             # סגנון ראשי, layout
│   ├── rtl.css              # התאמות RTL
│   ├── print.css            # @media print לייצוא PDF
│   └── fonts.css            # הגדרות פונטים
├── js/
│   ├── app.js               # אתחול וניהול ראשי
│   ├── sefaria-api.js       # client ל-API של ספריא
│   ├── sources.js           # ניהול מקורות (CRUD על הדף)
│   ├── storage.js           # localStorage layer
│   ├── ui-sheet.js          # ממשק דף המקורות (פאנל ימני)
│   ├── ui-browser.js        # ממשק דפדפן ספריא (פאנל שמאלי)
│   ├── export.js            # ייצוא PDF + הדפסה
│   └── utils.js             # ניקוי טעמים, פורמט מראה מקום, helpers
├── assets/
│   └── icons/               # אייקונים SVG
├── CLAUDE.md                # קובץ זה
├── README.md
└── .gitignore
```

**עקרון:** קובץ JS אחד לכל אחריות. מונע context bloat בעבודה עם Claude Code.

---

## ✨ פיצ'רים מפורטים

### 1. דפדפן ספריא (פאנל שמאלי)

**תפריט שורש:** קטגוריות עיקריות - תנ"ך, משנה, תלמוד בבלי, תלמוד ירושלמי, מדרש, הלכה, קבלה, ליטורגיה.

**Drill-down:** קטגוריה → ספר → פרק/דף → פסוק/עמוד. נטען מ-`/api/index`.

**חיפוש חופשי:** שדה autocomplete בראש הפאנל. שולח ל-`/api/name/<query>` ומציג הצעות בעברית.

**מסך הצגת פסוק:**
- טקסט הפסוק/מקור: ניקוד **כן**, טעמים **לא** (ראה פונקציית `removeTeamim`)
- כפתור "הוסף לדף ←" שמעביר את המקור לדף הימני
- מתחת לפסוק: רשימת **מקורות מקושרים** מקובצים לפי קטגוריה:
  - 📖 פרשני התורה (רש"י, רמב"ן, אבן עזרא, ספורנו, אור החיים...)
  - 🔄 תרגומים (אונקלוס, יונתן)
  - 📚 מדרשים (רבה, תנחומא, ילקוט...)
  - ⚖️ הלכה (רמב"ם, שולחן ערוך...)
  - 🎓 תלמוד (סוגיות שמצטטות)
- כל מקור מקושר: preview (100 תווים ראשונים), כפתור הרחבה לטקסט המלא, וכפתור "הוסף ←"

**Quick-add ברמת קבוצה:** כפתור "הוסף את כל פרשני התורה לדף" בכל קבוצת מקורות. חוסך 5+ לחיצות.

### 2. דף המקורות (פאנל ימני)

**כותרת:** שדה ערוך - "שם השיעור" (למשל: "פרשת לך-לך, שבת בוקר, פרשני התורה על 'לך לך'").

**רשימת מקורות:** כל מקור הוא "כרטיס" עם:
- כותרת = **מראה מקום בעברית** (אוטומטי מספריא, או ערוך חופשי)
- גוף הטקסט (ערוך - אפשר לקצר/לערוך אחרי ההוספה)
- כפתורי פעולה: 🗑 מחיקה, ⬆⬇ הזזה, ✏️ עריכה
- אינדיקטור: 📜 ספריא / ✏️ עצמאי
- שמירה אוטומטית של ה-`sefariaRef` המקורי גם אחרי עריכה

**תיבה עצמאית:** כפתור `+ הוסף מקור עצמאי` יוצר כרטיס ריק. שני שדות:
- כותרת/מראה מקום (חופשי - למשל "שו"ת אגרות משה, יו"ד ב:סה")
- גוף הטקסט (paste/הקלדה)

**הגדרות עיצוב (panel/modal):**
- פונט: Frank Ruhl Libre / David Libre / Bellefair / Heebo (dropdown)
- גודל גופן בסיס: 12pt / 14pt / 16pt / 18pt
- צ'קבוקס: "כל מקור בעמוד חדש בהדפסה"
- צ'קבוקס: "הצג מספור מקורות"
- שולי דף: רגיל / רחב / צר
- מצב הדפסה: צבעוני / שחור-לבן ניגודיות מוגברת

### 3. ספריית דפים שמורים

**מודל השמירה:**
- **טיוטה פעילה (`activeDraft`):** auto-save כל שינוי. תמיד יש בדיוק אחת.
- **דפים שמורים (`savedSheets`):** מערך עם שם, תאריך, ותוכן מלא.
- **דף חדש:** מאפס את הטיוטה הפעילה (עם confirm).

**חלון "הדפים שלי":**
- רשימת כל הדפים השמורים (שם, תאריך עדכון אחרון)
- 📂 פתח | 📋 שכפל | 🗑 מחק

**ייצוא JSON (אדוונסד):** כפתור "ייצא קובץ עבודה" לגיבוי או שיתוף בין מורים. כפתור מקביל לייבוא. נחבא ב-"הגדרות מתקדמות".

---

## 🔌 אינטגרציה עם Sefaria API

### Base URL
```
https://www.sefaria.org/api
```

### Endpoints עיקריים

#### 1. שליפת טקסט

```
GET /api/v3/texts/<ref>?version=hebrew&return_format=text_only
```

דוגמה: `https://www.sefaria.org/api/v3/texts/Genesis.1.1`

**Response חלקי:**
```json
{
  "ref": "Genesis 1:1",
  "heRef": "בראשית א׳:א׳",
  "versions": [
    { "language": "he", "text": "...", "versionTitle": "..." }
  ],
  "categories": ["Tanakh", "Torah", "Genesis"],
  "heCategories": ["תנ\"ך", "תורה", "בראשית"]
}
```

**טיפול:** ניקוי טעמים → שמירת הטקסט המנוקד → שמירת ה-`ref` המקורי לציטוט.

#### 2. מקורות מקושרים

```
GET /api/related/<ref>
```

דוגמה: `https://www.sefaria.org/api/related/Genesis.1.1`

**Response חלקי:**
```json
{
  "links": [
    {
      "ref": "Rashi on Genesis 1:1:1",
      "heRef": "רש״י על בראשית א׳:א׳:א׳",
      "category": "Commentary",
      "heCategory": "פרשנות",
      "type": "commentary",
      "commentator": "Rashi"
    }
  ]
}
```

**שימוש:** קיבוץ לפי `category`, סינון לפי דרגת חשיבות, הצגה בפאנל ספריא. שליפת הטקסט המלא של כל קישור בהרחבה - לא בטעינה הראשונית (lazy load).

#### 3. אוטוקומפליט/חיפוש

```
GET /api/name/<query>
```

דוגמה: `https://www.sefaria.org/api/name/בראשית`

#### 4. אינדקס מלא

```
GET /api/index
```

מבנה היררכי של כל הספרים. **לטעון פעם אחת** ב-app init ולשמור ב-memory למהירות drill-down.

### הערות חשובות

- **CORS:** פתוח לכולם, אפשר לקרוא ישירות מ-frontend
- **Rate limiting:** בלי מגבלה רשמית, אבל כדאי לא להציף
- **Cache:** ה-API responses טובים ל-cache ב-memory (אותו פסוק לא משתנה). כדאי לממש Map פשוט.
- **שגיאות:** טיפול ב-404 (ref לא קיים), 500 (server), network errors. הודעה ידידותית בעברית.

---

## 🔤 עזרי טיפול בטקסט עברי

### `js/utils.js` - פונקציות ליבה

```javascript
/**
 * הסרת טעמי מקרא, שמירה על ניקוד
 * Unicode טווחי טעמים: U+0591-U+05AF, U+05BD, U+05BF, U+05C0, U+05C3, U+05C6
 */
export function removeTeamim(text) {
  return text.replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C6]/g, '');
}

/**
 * הסרת כל הניקוד והטעמים (לטקסט "חשוף")
 */
export function stripAllNikud(text) {
  return text.replace(/[\u0591-\u05C7]/g, '');
}

/**
 * הסרת תגי HTML מתשובת ספריא (לפעמים יש <b>, <i>, <sup>)
 */
export function stripHTML(text) {
  return text.replace(/<[^>]*>/g, '');
}

/**
 * בניית מראה מקום מלא בעברית מ-heRef + heCategories
 * 
 * דוגמאות:
 *   heRef: "סוכה ב׳ א", heCategories: ["תלמוד", "בבלי", ...]
 *   → "תלמוד בבלי, מסכת סוכה, דף ב עמוד א"
 *   
 *   heRef: "בראשית א׳:א׳", heCategories: ["תנ\"ך", "תורה", ...]
 *   → "בראשית, פרק א פסוק א"
 */
export function formatMarehMakom(heRef, heCategories) {
  const cats = heCategories || [];
  
  if (cats.includes('תלמוד') && cats.includes('בבלי')) {
    // לוגיקה לתלמוד בבלי
    // לפרסר את ה-heRef ולבנות "תלמוד בבלי, מסכת X, דף Y עמוד Z"
  }
  
  if (cats.includes('משנה')) {
    // לוגיקה למשנה - "משנה, מסכת X, פרק Y משנה Z"
  }
  
  if (cats.includes('תנ"ך')) {
    // לוגיקה לתנ"ך - "ספר X, פרק Y פסוק Z"
  }
  
  if (cats.includes('פרשנות')) {
    // לוגיקה לפרשנים - "[פרשן] על [המקור]"
  }
  
  // ברירת מחדל - heRef הגולמי
  return heRef;
}
```

---

## 📊 מודל הנתונים

### מבנה דף מקורות

```javascript
{
  id: "sheet_1736000000000",          // unique ID
  title: "פרשת לך-לך, שבת בוקר",      // שם הדף
  createdAt: 1736000000000,            // timestamp
  updatedAt: 1736000000000,
  settings: {
    font: "Frank Ruhl Libre",
    fontSize: 14,
    pageBreakPerSource: false,
    showNumbering: true,
    margins: "normal",                 // normal | wide | narrow
    printMode: "color"                 // color | bw-high-contrast
  },
  sources: [
    {
      id: "source_1",
      type: "sefaria",                 // sefaria | custom
      title: "בראשית, פרק א פסוק א",   // מראה מקום
      text: "בְּרֵאשִׁית בָּרָא...",
      sefariaRef: "Genesis.1.1",       // רק עבור type=sefaria
      sefariaHeRef: "בראשית א׳:א׳",    // לציטוט מסודר
      originalText: "...",              // הטקסט המקורי לפני עריכה
      hasBeenEdited: false
    },
    {
      id: "source_2",
      type: "custom",
      title: "שאלה לפתיחה",
      text: "מה ההבדל בין..."
    }
  ]
}
```

### מבנה localStorage

```javascript
{
  "daf_mekorot_activeDraft": { /* dafObject */ },
  "daf_mekorot_savedSheets": [
    { /* dafObject 1 */ },
    { /* dafObject 2 */ }
  ],
  "daf_mekorot_userSettings": {
    "defaultFont": "Frank Ruhl Libre",
    "defaultFontSize": 14
  }
}
```

---

## 🎨 עיצוב וטיפוגרפיה

### פונטים זמינים (Google Fonts)

1. **Frank Ruhl Libre** - ברירת מחדל, קלאסי ומסורתי
2. **David Libre** - חלופה רחבה יותר
3. **Bellefair** - סריף עכשווי
4. **Heebo** - סנס-סריף מודרני (לסטייל פחות מסורתי)

טעינה ב-`index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;700&family=David+Libre:wght@400;700&family=Bellefair&family=Heebo:wght@400;700&display=swap" rel="stylesheet">
```

### עקרונות RTL

```css
html { direction: rtl; }
body { text-align: right; }

/* טקסט מעורב עברית-אנגלית-מספרים */
.mixed-content { unicode-bidi: plaintext; }

/* גופנים עבריים בטקסט מקורות */
.source-text {
  font-family: 'Frank Ruhl Libre', serif;
  font-feature-settings: "kern" 1;
  line-height: 1.7;
}
```

### Print CSS (קריטי לאיכות הייצוא!)

```css
@media print {
  body { background: white; color: black; }
  
  /* הסתרת פאנל ספריא */
  .sefaria-browser,
  .toolbar,
  .controls,
  .edit-buttons { display: none !important; }
  
  /* הרחבת דף המקורות לכל הרוחב */
  .source-sheet {
    width: 100%;
    max-width: none;
    padding: 0;
  }
  
  /* כל מקור לא נחתך באמצע */
  .source-card { 
    page-break-inside: avoid;
    break-inside: avoid;
  }
  
  /* אופציונלי: כל מקור בעמוד חדש */
  .page-break-mode .source-card:not(:first-child) { 
    page-break-before: always;
    break-before: page;
  }
  
  @page {
    margin: 2cm;
    size: A4;
  }
}
```

---

## 🚀 שלבי פיתוח (Phased Approach)

### Phase 1 - MVP (מטרה: דף מקורות בסיסי עובד)

- [x] מבנה תיקיות + `index.html` בסיסי
- [x] Split view layout עם RTL מלא
- [x] חיפוש פשוט בספריא (`/api/name/`)
- [x] שליפה והצגה של פסוק (`/api/v3/texts/`)
- [x] ניקוי טעמים, שמירת ניקוד
- [x] כפתור "הוסף לדף" → מוסיף מקור לפאנל ימני
- [x] תיבה עצמאית (custom source)
- [x] עריכת טקסט וכותרת אחרי הוספה
- [x] מחיקה וסידור מקורות (חיצים)
- [x] ייצוא PDF דרך `window.print()` עם CSS print
- [x] auto-save של טיוטה פעילה ל-localStorage

### Phase 2 - מקורות מקושרים

- [x] קריאה ל-`/api/related/` לכל מקור שנפתח
- [x] קיבוץ הקישורים לפי קטגוריה (פרשנים / מדרשים / וכו')
- [x] preview של מקור מקושר עם הרחבה ב-click
- [x] כפתור "הוסף" לכל מקור מקושר
- [x] Quick-add: "הוסף את כל פרשני התורה" ברמת קבוצה

### Phase 3 - דפדוף מלא בעץ

- [x] טעינת `/api/index` ב-app init (lazy per-book via `fetchIndexFor`)
- [x] עץ ניווט: ספר → פרק/דף → פסוק/שורה
- [x] היסטוריית ניווט (breadcrumb + back)
- [ ] סימניות (bookmarks) למקומות נפוצים

### Phase 4 - ספריית דפים

- [x] חלון "הדפים שלי"
- [x] שמירה מפורשת עם שם
- [x] טעינת דף שמור
- [x] מחיקה, שכפול
- [x] "התחל דף חדש" (עם confirm)

### Phase 5 - הגדרות עיצוב

- [x] בחירת פונט (4 אופציות)
- [x] בחירת גודל גופן
- [x] ~~צ'קבוקס "כל מקור בעמוד חדש"~~ — בוטל: גלישה רגילה עם `page-break-inside: avoid` לכרטיס
- [x] מספור מקורות
- [x] שולי דף
- [x] מצב הדפסה שחור-לבן

### Phase 6 - ליטוש והעמקה

- [ ] בניית מראה מקום מלא לפי קטגוריות (formatMarehMakom)
- [ ] ייצוא/ייבוא JSON
- [ ] כותרת רצה בהדפסה
- [ ] טפסי הדפסה (A4, Letter, Legal)
- [ ] קיצורי מקלדת
- [ ] תאימות מובייל (לפחות לצפייה)

---

## 💡 עקרונות עבודה עם Claude Code

1. **משימות אטומיות:** כל phase מתפצל למשימות קטנות, פיצ'ר אחד בכל בקשה. לא "תבנה את כל Phase 1" אלא "תבנה את ה-layout של ה-split view בלבד".

2. **קבצים נפרדים:** כל פונקציונליות בקובץ JS משלה (sefaria-api.js, storage.js, וכו'). מונע context bloat ומקל על איתור באגים.

3. **תיעוד דו-לשוני:** הערות בקוד יכולות להיות בעברית או באנגלית. שמות פונקציות באנגלית, מחרוזות UI בעברית.

4. **בדיקה לפני המשך:** אחרי כל משימה - בדיקה בדפדפן לפני התקדמות. לא לערום פיצ'רים בלי לוודא שהקיים עובד.

5. **`/compact` בין שלבים:** ניקוי context בין phase ל-phase מונע לופים ו-timeouts.

6. **עדכון `CLAUDE.md`:** סמן ✅ בכל משימה שהושלמה ב-Phased Approach. הקובץ הזה הוא ה-source of truth.

7. **commit אחרי כל פיצ'ר עובד:** קל לחזור אחורה אם משהו נשבר.

---

## ⚠️ בעיות נפוצות לצפות מראש

1. **טקסטים ארוכים:** רמב"ן על פסוק יכול להיות 500+ מילים. חובה preview + אפשרות לקצר/לערוך אחרי ההוספה.

2. **HTML בתוך טקסט ספריא:** לפעמים יש `<b>`, `<i>`, `<sup>`, `<small>`. החלטה: לרנדר (טוב לפסוקים) או להסיר (אם בעייתי).

3. **חוסר עקביות בניקוד:** לא כל הטקסטים בספריא מנוקדים. צריך לוודא שהקוד עמיד גם לטקסט "חשוף".

4. **RTL ומספרים:** מספרי עמודים, פרק:פסוק, מספרי הערות עלולים להופיע ברצף שגוי. שימוש ב-CSS `unicode-bidi: plaintext` או Unicode markers (`\u202B`) במקומות בעייתיים.

5. **הבדלי דפדפנים בהדפסה:** Chrome, Firefox, Safari מתנהגים שונה ב-`@media print`. לבדוק לפחות ב-Chrome ו-Firefox.

6. **localStorage quota:** ~5-10MB לדפדפן. דפים רגילים <100KB, אז יש מקום למאות דפים. עדיין - להזהיר אם מתקרבים.

---

## 📚 משאבים

- [Sefaria API Documentation](https://developers.sefaria.org/)
- [Sefaria-Project on GitHub](https://github.com/Sefaria/Sefaria-Project) - דוגמאות קוד
- [Google Fonts Hebrew](https://fonts.google.com/?subset=hebrew)
- [Hebrew Unicode Reference](https://unicode.org/charts/PDF/U0590.pdf)
- [MDN @media print](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/print)

---

## 📄 רישיון ושיוך

המערכת משתמשת ב-Sefaria API שטקסטיו ברישיון Creative Commons (CC-BY-SA / CC-0 בהתאם למקור). דף מקורות שמופק מהמערכת מציין את ספריא כמקור בכותרת תחתונה.

---

## 🔄 לוג שינויים

- 2026-05-13: גרסה ראשונה של ה-spec
