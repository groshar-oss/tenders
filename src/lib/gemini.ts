import { UserError } from './db';
import { REGIONS, TAGS, type Settings } from './core';

const BASE = () => process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
export const hasAiKey = () => !!process.env.GEMINI_API_KEY;

type GPart = { text: string } | { inline_data: { mime_type: string; data: string } };
export async function generate(parts: GPart[], model: string, what: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new UserError('חסר מפתח Gemini (GEMINI_API_KEY בהגדרות Vercel).');
  const payload = { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } };
  const url = `${BASE()}/v1beta/models/${encodeURIComponent(model || 'gemini-flash-latest')}:generateContent`;
  let last = '';
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120_000) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const text: string = (body.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
      try { return JSON.parse(text.replace(/^```json|```$/g, '').trim()); } catch { throw new UserError(`${what}: תשובה לא מובנת`); }
    }
    last = body?.error?.message || `קוד ${res.status}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new UserError(`${what}: ${last}`);
}

export type ScoreIn = { id: number; title: string; publisher: string; kind: string; topics: string[]; deadline: string | null; kw: string[] };
export type ScoreOut = { id: number; score: number; entity: 'groshar' | 'tzi' | 'both' | 'none'; reason: string; region: string; tags: string[] };
export type Example = { title: string; publisher: string; verdict: 'רלוונטי' | 'לא רלוונטי' };

export function scorePrompt(items: ScoreIn[], s: Settings, examples: Example[]) {
  return [
    'אתה עוזר למנהל פרויקטים בנייה בישראל לאתר מכרזים ציבוריים שמתאימים לשתי החברות שלו. דרג כל מכרז ברשימה והחזר JSON בלבד.',
    '',
    `חברה 1 (groshar), ${s.profiles.groshar.name}: ${s.profiles.groshar.about}`,
    `חברה 2 (tzi), ${s.profiles.tzi.name}: ${s.profiles.tzi.about}`,
    '',
    'מה רלוונטי: שירותי ניהול פרויקטים, פיקוח, ליווי הנדסי, בקרת תקציב ועלויות לבנייה, שיפוצים והתאמות (groshar);',
    'ביצוע עבודות בנייה, שיפוץ, גמר, התאמות פנים, הקמת משרדים ומבני ציבור, אחזקת מבנים (tzi);',
    'מכרזי "איתור דיור" או שכירת נכס למשרדי ממשלה: המשכיר הזוכה צריך לבצע התאמות, זה ליד לביצוע (tzi, תגית "איתור דיור").',
    'מאגרי יועצים ומאגרי ספקים בתחומים האלה רלוונטיים מאוד (תגית "מאגר ספקים").',
    'לא רלוונטי: אספקת ציוד, תרופות, מחשוב, רכבים, שירותים רפואיים, הסעדה, ניקיון, שמירה, תוכנה, הדרכות, מכירת קרקע, פטור שניתן לספק אחר בלי הליך תחרותי.',
    'תשתיות כבדות (כבישים, רכבות, תחנות כוח, ביוב) רלוונטיות רק אם מדובר בניהול ופיקוח, ובציון נמוך יותר.',
    '',
    examples.length ? 'החלטות קודמות של המשתמש (ללמוד מהן):\n' + examples.map((e) => `- ${e.verdict}: ${e.title} (${e.publisher})`).join('\n') + '\n' : '',
    'החזר: {"results": [{"id": מספר, "score": 0-100 (כמה כדאי לבדוק את המכרז: 80+ התאמה ישירה, 50-79 כדאי לבדוק, 20-49 קשור בעקיפין, מתחת ל-20 לא רלוונטי),',
    ' "entity": "groshar" | "tzi" | "both" | "none", "reason": משפט קצר בעברית (עד 18 מילים) למה מתאים או לא,',
    ` "region": אחד מ: ${[...REGIONS, ''].map((r) => `"${r}"`).join(' | ')} (לפי מיקום העבודה; "ארצי" אם בכל הארץ; ריק אם לא ידוע),`,
    ` "tags": תת-רשימה של: ${TAGS.map((t) => `"${t}"`).join(', ')}}]}`,
    'אל תמציא פרטים שלא מופיעים. החזר תוצאה לכל מזהה ברשימה.',
    '',
    'המכרזים:',
    ...items.map((t) => JSON.stringify({ id: t.id, title: t.title, publisher: t.publisher, kind: t.kind, topics: t.topics.slice(0, 8), deadline: t.deadline?.slice(0, 10) || '', keywords: t.kw })),
  ].join('\n');
}

export function cleanScores(raw: unknown, ids: number[]): ScoreOut[] {
  const arr = (raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
  const out: ScoreOut[] = [];
  for (const r of arr) {
    const id = Number(r.id);
    if (!ids.includes(id) || out.some((o) => o.id === id)) continue;
    const ent = String(r.entity || 'none');
    out.push({
      id,
      score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
      entity: (['groshar', 'tzi', 'both', 'none'].includes(ent) ? ent : 'none') as ScoreOut['entity'],
      reason: String(r.reason || '').slice(0, 200),
      region: (REGIONS as readonly string[]).includes(String(r.region)) ? String(r.region) : '',
      tags: Array.isArray(r.tags) ? (r.tags as string[]).filter((t) => (TAGS as readonly string[]).includes(t)) : [],
    });
  }
  return out;
}

export async function scoreBatch(items: ScoreIn[], s: Settings, examples: Example[]) {
  const raw = await generate([{ text: scorePrompt(items, s, examples) }], s.aiModel, 'דירוג המכרזים נכשל');
  return cleanScores(raw, items.map((i) => i.id));
}

/* ---------- בדיקת תנאי סף ---------- */

export type Elig = {
  summary: string; scope: string; deadlines: { label: string; when: string }[]; guarantee: string; scoring: string;
  thresholds: { text: string; groshar: string; tzi: string; why: string }[]; overall: { groshar: string; tzi: string }; risks: string[]; questions: string[]; docs: string[];
};

export async function eligibility(docs: { name: string; mime: string; data: Buffer | string }[], t: { title: string; publisher: string }, s: Settings) {
  const prompt = [
    `אתה יועץ מכרזים לחברות בנייה בישראל. מצורפים מסמכי המכרז "${t.title}" של ${t.publisher}. קרא אותם והחזר JSON בלבד.`,
    `חברה groshar, ${s.profiles.groshar.name}: ${s.profiles.groshar.about}`,
    `חברה tzi, ${s.profiles.tzi.name}: ${s.profiles.tzi.about}`,
    '{"summary": תיאור המכרז ב-2-3 משפטים, "scope": היקף העבודה/ההתקשרות (כסף, תקופה, כמות) כפי שכתוב,',
    ' "deadlines": [{"label": למשל "שאלות הבהרה" / "סיור מציעים" / "הגשה", "when": תאריך ושעה כפי שכתוב}],',
    ' "guarantee": ערבות הגשה/ביצוע (סכום) או "אין", "scoring": איך נבחר הזוכה (מחיר/איכות, משקלות),',
    ' "thresholds": [{"text": תנאי הסף בניסוח קצר, "groshar": "עומד" | "לא עומד" | "לא ברור", "tzi": "עומד" | "לא עומד" | "לא ברור", "why": הסבר קצר}],',
    ' "overall": {"groshar": "מתאים" | "לא מתאים" | "לא ברור", "tzi": "מתאים" | "לא מתאים" | "לא ברור"},',
    ' "risks": [נקודות שדורשות תשומת לב: בלעדיות, קנסות, ביטוחים חריגים, דרישות כוח אדם], "questions": [שאלות הבהרה שכדאי לשאול]}',
    'כללים: קבע "עומד" רק אם הפרופיל של החברה מראה זאת במפורש. אם חסר מידע בפרופיל: "לא ברור". אל תמציא סכומים או תאריכים.',
  ].join('\n');
  const parts: GPart[] = [{ text: prompt }];
  for (const d of docs) {
    parts.push({ text: `--- מסמך: ${d.name} ---` });
    parts.push(typeof d.data === 'string' ? { text: d.data.slice(0, 120_000) } : { inline_data: { mime_type: d.mime, data: d.data.toString('base64') } });
  }
  const r = (await generate(parts, s.aiModel, 'בדיקת תנאי הסף נכשלה')) as Partial<Elig>;
  return {
    summary: String(r.summary || ''), scope: String(r.scope || ''), deadlines: Array.isArray(r.deadlines) ? r.deadlines.slice(0, 8) : [],
    guarantee: String(r.guarantee || ''), scoring: String(r.scoring || ''), thresholds: Array.isArray(r.thresholds) ? r.thresholds.slice(0, 20) : [],
    overall: { groshar: String(r.overall?.groshar || 'לא ברור'), tzi: String(r.overall?.tzi || 'לא ברור') },
    risks: Array.isArray(r.risks) ? r.risks.slice(0, 10).map(String) : [], questions: Array.isArray(r.questions) ? r.questions.slice(0, 10).map(String) : [],
    docs: docs.map((d) => d.name),
  } as Elig;
}
