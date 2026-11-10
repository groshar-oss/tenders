// לוגיקה טהורה: הגדרות, מילות מפתח, תאריכים, בחירת התראות, תוכן המייל והוואטסאפ.

export type EntityKey = 'groshar' | 'tzi';

export type Settings = {
  profiles: Record<EntityKey, { name: string; keywords: string[]; about: string }>;
  /** נושאים של מנהל הרכש שתמיד נבדקים בבינה מלאכותית, גם בלי מילת מפתח */
  topics: string[];
  /** גופים מפרסמים שתמיד נבדקים (למשל מינהל הדיור הממשלתי) */
  publishers: string[];
  /** מילים שמורידות מכרז מהבדיקה (אספקת ציוד וכו') */
  negative: string[];
  waPhone: string;
  waKeyEnc: string;
  waMin: number;
  urgentMin: number;
  urgentDays: number;
  remindDays: number;
  digestTo: string[];
  digestMin: number;
  digestTime: string; // HH:MM שעון ישראל
  aiModel: string;
  collectEveryMin: number;
};

export const DEFAULT_SETTINGS: Settings = {
  profiles: {
    groshar: {
      name: 'גרושר: ניהול ופיקוח',
      keywords: ['ניהול פרויקט', 'ניהול פרוייקט', 'ניהול ופיקוח', 'פיקוח', 'מפקח', 'ליווי הנדסי', 'ניהול תכנון', 'ניהול הקמה', 'ניהול ביצוע',
        'בקרת תקציב', 'בקרה הנדסית', 'בקרת עלויות', 'מנהל פרויקט', 'מנהלי פרויקטים', 'ייעוץ הנדסי', 'יעוץ הנדסי', 'ניהול בינוי', 'תיאום תכנון',
        'אומדן', 'כתבי כמויות', 'כתב כמויות', 'בקרת חשבונות', 'מאגר יועצים', 'מאגר מנהלי', 'שירותי הנדסה'],
      about: 'גרושר פרויקטים בע"מ: ניהול פרויקטים, פיקוח ובקרת תקציב בפרויקטי בנייה, בדגש על גמר והתאמות למשרדים, מסחר והייטק. (השלם: ניסיון, הסמכות, היקפים, לקוחות ציבוריים)',
    },
    tzi: {
      name: 'צי הנדסה: ביצוע',
      keywords: ['שיפוץ', 'שיפוצים', 'התאמה', 'התאמות', 'עבודות גמר', 'גמר', 'עבודות בינוי', 'בינוי', 'הקמת משרדים', 'ביצוע עבודות', 'עבודות בנייה', 'עבודות בניה',
        'גבס', 'ריצוף', 'צביעה', 'איטום', 'נגרות', 'אחזקת מבנים', 'תחזוקת מבנים', 'עבודות פנים', 'עיצוב פנים', 'משרדים', 'קבלן ראשי', 'קבלן ביצוע', 'איתור דיור', 'שכירת נכס'],
      about: 'צי הנדסה ניהול וביצוע: קבלן ביצוע לעבודות גמר, שיפוץ והתאמות. (השלם: סיווג קבלני מדויק, היקף כספי מקסימלי, אזורי עבודה)',
    },
  },
  topics: ['שירותי בנייה ואחזקת מבנים', 'שירותי שיפוץ ואחזקה', 'שירותי עיצוב פנים', 'נגרות', 'בניית חיפוי קירות', 'שירותי צביעה', 'שירותי ריצוף',
    'שירותי הנדסה מקצועים', 'שירותי הקמת בית חולים', 'מבני קבע', 'חומרי גימור פנים', 'החכרת / השכרת מבנה למסחר, תעשייה ותיירות'],
  publishers: ['מינהל הדיור הממשלתי', 'מינהל הבינוי הממשלתי', 'אגף לתיכנון ולבינוי מוסדות רפואה'],
  negative: [],
  waPhone: '',
  waKeyEnc: '',
  waMin: 75,
  urgentMin: 55,
  urgentDays: 7,
  remindDays: 3,
  digestTo: ['Jonatan@groshar.co.il'],
  digestMin: 40,
  digestTime: '07:30',
  aiModel: 'gemini-flash-latest',
  collectEveryMin: 120,
};

export function mergeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const out: Settings = { ...DEFAULT_SETTINGS, ...r, profiles: { ...DEFAULT_SETTINGS.profiles } };
  for (const k of ['groshar', 'tzi'] as EntityKey[]) out.profiles[k] = { ...DEFAULT_SETTINGS.profiles[k], ...(r.profiles?.[k] || {}) };
  return out;
}

export const REGIONS = ['צפון', 'חיפה', 'מרכז', 'תל אביב', 'ירושלים', 'דרום', 'יהודה ושומרון', 'ארצי'] as const;
export const TAGS = ['ניהול ופיקוח', 'ביצוע וגמר', 'תכנון וייעוץ', 'איתור דיור', 'מאגר ספקים', 'אחזקה'] as const;
export const MY_STATUS: Record<string, string> = { interesting: 'מעניין', preparing: 'בהכנה', submitted: 'הוגש', won: 'זכינו', lost: 'לא זכינו', irrelevant: 'לא רלוונטי' };
export const TRACKED = ['interesting', 'preparing', 'submitted'];

/* ---------- טקסט ---------- */

/** מנרמל עברית להשוואה: בלי ניקוד, גרשיים, מקפים ורווחים כפולים */
export function norm(s: string) {
  return String(s || '').replace(/[֑-ׇ]/g, '').replace(/["'״׳`]/g, '').replace(/[-–—_/\\|,.;:()[\]]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function hits(text: string, words: string[]) {
  const t = ' ' + norm(text) + ' ';
  const out: string[] = [];
  for (const w of words) {
    const n = norm(w);
    if (n && t.includes(n) && !out.includes(w)) out.push(w);
  }
  return out;
}

export type Candidate = { title: string; publisher: string; topics: string[]; kind?: string };
/** מילות מפתח לכל ישות, והאם המכרז שווה בדיקה בבינה מלאכותית */
export function keywordScan(t: Candidate, s: Settings) {
  const text = `${t.title} ${t.topics.join(' ')}`;
  const g = hits(text, s.profiles.groshar.keywords);
  const z = hits(text, s.profiles.tzi.keywords);
  const topic = t.topics.some((x) => s.topics.some((y) => norm(y) === norm(x)));
  const pub = s.publishers.some((p) => norm(t.publisher).includes(norm(p)));
  const neg = hits(t.title, s.negative).length > 0;
  return { groshar: g, tzi: z, candidate: !neg && (g.length > 0 || z.length > 0 || topic || pub) };
}

/* ---------- תאריכים (שעון ישראל) ---------- */

/** הפרש UTC של ישראל בתאריך נתון (2 או 3 שעות) */
export function ilOffsetMin(d: Date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return Math.round((asUtc - d.getTime()) / 60000);
}
/** "19/11/2026 12:00" או "09/12/2026 ,15:00" או "22/10/2026" → ISO (שעון ישראל) */
export function parseIlDate(s: string): string | null {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const guess = new Date(Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0)));
  const off = ilOffsetMin(guess);
  return new Date(guess.getTime() - off * 60000).toISOString();
}
export function parseIlDay(s: string): string | null {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
export function ilNow(now = new Date()) {
  const d = new Date(now.getTime() + ilOffsetMin(now) * 60000);
  return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) };
}
export function fmtDeadline(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const l = new Date(d.getTime() + ilOffsetMin(d) * 60000).toISOString();
  return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}`;
}
export function daysLeft(iso: string | null, now = new Date()) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 864e5);
}

const CLOSED = ['חלף מועד הגשה', 'סגור', 'מבוטל', 'התקשרות בתוקף', 'התקשרות הסתיימה', 'בוטל', 'נסגר'];
export function isOpen(t: { status: string; deadline: string | null }, now = new Date()) {
  if (CLOSED.some((c) => norm(t.status) === norm(c))) return false;
  return !t.deadline || new Date(t.deadline) > now;
}

/* ---------- התראות ---------- */

export type AlertRow = {
  id: number; title: string; publisher: string; kind: string; url: string; status: string; deadline: string | null;
  ai_score: number | null; ai_entity: string; ai_reason: string; my_status: string; wa_at: string | null; remind_at: string | null; first_seen: string;
};

/** מה שולחים בוואטסאפ עכשיו: מכרז ששווה (ציון גבוה), מכרז רלוונטי שנסגר בקרוב, ותזכורת למכרז במעקב */
export function pickWhatsApp(rows: AlertRow[], s: Settings, now = new Date()) {
  const out: { row: AlertRow; reason: 'שווה' | 'דחוף' | 'תזכורת' }[] = [];
  for (const r of rows) {
    if (!isOpen(r, now) || r.my_status === 'irrelevant') continue;
    const left = daysLeft(r.deadline, now);
    if (TRACKED.includes(r.my_status) && r.my_status !== 'submitted' && left !== null && left <= s.remindDays && !r.remind_at) { out.push({ row: r, reason: 'תזכורת' }); continue; }
    if (r.wa_at || r.ai_score === null) continue;
    if (r.ai_score >= s.waMin) out.push({ row: r, reason: 'שווה' });
    else if (r.ai_score >= s.urgentMin && left !== null && left <= s.urgentDays) out.push({ row: r, reason: 'דחוף' });
  }
  return out.sort((a, b) => (b.row.ai_score || 0) - (a.row.ai_score || 0));
}

const ENT: Record<string, string> = { groshar: 'גרושר', tzi: 'צי', both: 'גרושר + צי', none: '' };
export const entLabel = (e: string) => ENT[e] ?? '';

export function waText(items: { row: AlertRow; reason: string }[], appUrl: string, now = new Date()) {
  const lines = ['*מכרזים: התראה*'];
  for (const { row: r, reason } of items.slice(0, 6)) {
    const left = daysLeft(r.deadline, now);
    lines.push('', `${reason === 'שווה' ? '⭐' : reason === 'דחוף' ? '⏰' : '📌'} *${reason}* · ${r.ai_score ?? '-'} · ${entLabel(r.ai_entity)}`.trim(),
      r.title, r.publisher, r.deadline ? `הגשה עד ${fmtDeadline(r.deadline)}${left !== null ? ` (${left} ימים)` : ''}` : '', `${appUrl}/#t/${r.id}`);
  }
  if (items.length > 6) lines.push('', `ועוד ${items.length - 6} במערכת: ${appUrl}`);
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

const esc = (s: string) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function digestHtml(o: { fresh: AlertRow[]; closing: AlertRow[]; appUrl: string; date: string }, now = new Date()) {
  const card = (r: AlertRow) => {
    const left = daysLeft(r.deadline, now);
    return `<tr><td style="padding:10px 12px;border-bottom:1px solid #DDD8CC;vertical-align:top">
<div style="font-size:12px;color:#5A6572">${esc(r.kind)} · ${esc(r.publisher)}</div>
<div style="font-size:15px;font-weight:600;margin:3px 0"><a href="${esc(o.appUrl)}/#t/${r.id}" style="color:#11151C;text-decoration:none">${esc(r.title)}</a></div>
<div style="font-size:13px;color:#2E3742">${esc(r.ai_reason)}</div>
<div style="font-size:12px;color:#5A6572;margin-top:4px">${r.deadline ? `הגשה עד ${fmtDeadline(r.deadline)}${left !== null ? ` · ${left} ימים` : ''}` : 'ללא מועד הגשה'} · <a href="${esc(r.url)}" style="color:#7A7510">לעמוד המכרז</a></div>
</td><td style="padding:10px 12px;border-bottom:1px solid #DDD8CC;text-align:center;vertical-align:top;white-space:nowrap">
<div style="font-size:20px;font-weight:300">${r.ai_score ?? ''}</div><div style="font-size:11px;color:#5A6572">${esc(entLabel(r.ai_entity))}</div></td></tr>`;
  };
  const section = (title: string, rows: AlertRow[]) => rows.length
    ? `<h2 style="font-size:16px;font-weight:500;margin:22px 0 6px;border-bottom:2px solid #B4AE14;padding-bottom:4px">${esc(title)} (${rows.length})</h2><table style="width:100%;border-collapse:collapse">${rows.map(card).join('')}</table>`
    : '';
  const g = o.fresh.filter((r) => r.ai_entity === 'groshar' || r.ai_entity === 'both');
  const z = o.fresh.filter((r) => r.ai_entity === 'tzi');
  const rest = o.fresh.filter((r) => !['groshar', 'both', 'tzi'].includes(r.ai_entity));
  const body = [section('במעקב: נסגרים השבוע', o.closing), section('חדשים לגרושר: ניהול ופיקוח', g), section('חדשים לצי: ביצוע', z), section('חדשים נוספים', rest)].join('')
    || '<p style="color:#5A6572">אין מכרזים חדשים שמתאימים מאז הסיכום הקודם.</p>';
  return `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;background:#F6F3EC;padding:18px"><div style="max-width:720px;margin:0 auto;background:#fff;border-top:3px solid #B4AE14;padding:18px 20px">
<div style="font-size:12px;color:#5A6572">גרושר · איתור מכרזים</div><h1 style="font-size:22px;font-weight:300;margin:4px 0 0">סיכום מכרזים ${esc(o.date)}</h1>${body}
<p style="margin-top:22px;font-size:12px;color:#5A6572"><a href="${esc(o.appUrl)}" style="color:#7A7510">פתיחת המערכת</a> · הדירוג נעשה בבינה מלאכותית. התנאים המחייבים הם אלה שבמסמכי המכרז.</p></div></div>`;
}
