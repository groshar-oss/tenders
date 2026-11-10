import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, keywordScan, parseIlDate, pickWhatsApp, waText, isOpen, mergeSettings, digestHtml, type AlertRow } from '@/lib/core';
import { cleanScores, scorePrompt } from '@/lib/gemini';

const s = DEFAULT_SETTINGS;
const now = new Date('2026-11-10T08:00:00Z');
const row = (o: Partial<AlertRow>): AlertRow => ({ id: 1, title: 'מכרז', publisher: 'משרד', kind: 'מכרז פומבי', url: 'u', status: 'פורסם', deadline: '2026-12-01T10:00:00Z',
  ai_score: 80, ai_entity: 'groshar', ai_reason: '', my_status: '', wa_at: null, remind_at: null, first_seen: '2026-11-10T07:00:00Z', ...o });

describe('מילות מפתח', () => {
  it('ניהול ופיקוח → גרושר', () => {
    const k = keywordScan({ title: 'מכרז למתן שירותי ניהול ופיקוח על עבודות שיפוץ', publisher: 'עיריית רעננה', topics: [] }, s);
    expect(k.groshar).toContain('ניהול ופיקוח');
    expect(k.tzi).toContain('שיפוץ');
    expect(k.candidate).toBe(true);
  });
  it('תחילית עברית: "לפיקוח" נתפס', () => {
    expect(keywordScan({ title: 'שירותים לפיקוח הנדסי', publisher: '', topics: [] }, s).groshar).toContain('פיקוח');
  });
  it('אספקת מחשבים לא מועמד', () => {
    expect(keywordScan({ title: 'רכישת מחשבים ניידים', publisher: 'מנהל התכנון', topics: ['מחשוב ותקשורת'] }, s).candidate).toBe(false);
  });
  it('נושא או מפרסם רלוונטי מספיקים', () => {
    expect(keywordScan({ title: 'מכרז לאיתור נכס', publisher: 'משרד האוצר - מינהל הדיור הממשלתי', topics: [] }, s).candidate).toBe(true);
    expect(keywordScan({ title: 'מכרז 5', publisher: 'x', topics: ['שירותי עיצוב פנים'] }, s).candidate).toBe(true);
  });
  it('מילה שלילית מוציאה', () => {
    const s2 = mergeSettings({ negative: ['אספקת'] });
    expect(keywordScan({ title: 'אספקת גבס', publisher: '', topics: [] }, s2).candidate).toBe(false);
    expect(s2.profiles.groshar.keywords.length).toBeGreaterThan(5);
  });
});

describe('תאריכים בשעון ישראל', () => {
  it('חורף UTC+2, קיץ UTC+3', () => {
    expect(parseIlDate('19/11/2026 12:00')).toBe('2026-11-19T10:00:00.000Z');
    expect(parseIlDate('01/07/2026 12:00')).toBe('2026-07-01T09:00:00.000Z');
    expect(parseIlDate('09/12/2026 ,15:00')).toBe('2026-12-09T13:00:00.000Z');
    expect(parseIlDate('')).toBeNull();
  });
  it('פתוח / סגור', () => {
    expect(isOpen({ status: 'עודכן', deadline: '2026-12-01T00:00:00Z' }, now)).toBe(true);
    expect(isOpen({ status: 'חלף מועד הגשה', deadline: null }, now)).toBe(false);
    expect(isOpen({ status: 'פורסם', deadline: '2026-11-01T00:00:00Z' }, now)).toBe(false);
  });
});

describe('בחירת וואטסאפ', () => {
  it('שווה, דחוף ותזכורת', () => {
    const rows = [
      row({ id: 1, ai_score: 82 }),
      row({ id: 2, ai_score: 60, deadline: '2026-11-14T10:00:00Z' }),
      row({ id: 3, ai_score: 60, deadline: '2026-12-30T10:00:00Z' }),
      row({ id: 4, ai_score: 90, wa_at: '2026-11-09T00:00:00Z' }),
      row({ id: 5, ai_score: 30, my_status: 'preparing', deadline: '2026-11-12T10:00:00Z', wa_at: '2026-11-01T00:00:00Z' }),
      row({ id: 6, ai_score: 95, my_status: 'irrelevant' }),
      row({ id: 7, ai_score: 95, deadline: '2026-11-09T10:00:00Z' }),
    ];
    const p = pickWhatsApp(rows, s, now);
    expect(p.map((x) => [x.row.id, x.reason])).toEqual([[1, 'שווה'], [2, 'דחוף'], [5, 'תזכורת']]);
    const t = waText(p, 'https://app', now);
    expect(t).toContain('https://app/#t/1');
    expect(t).toContain('⏰ *דחוף*');
  });
  it('סיכום במייל מחולק לפי ישות', () => {
    const h = digestHtml({ fresh: [row({ id: 1 }), row({ id: 2, ai_entity: 'tzi', title: 'שיפוץ <משרדים>' })], closing: [], appUrl: 'https://a', date: '10/11/2026' }, now);
    expect(h).toContain('חדשים לגרושר');
    expect(h).toContain('חדשים לצי');
    expect(h).toContain('שיפוץ &lt;משרדים&gt;');
  });
});

describe('דירוג Gemini', () => {
  it('מנקה תשובה', () => {
    const r = cleanScores({ results: [{ id: 5, score: 130, entity: 'x', reason: 'r', region: 'מרכז', tags: ['ניהול ופיקוח', 'זבל'] }, { id: 9, score: 50 }, { id: 5, score: 1 }] }, [5]);
    expect(r).toEqual([{ id: 5, score: 100, entity: 'none', reason: 'r', region: 'מרכז', tags: ['ניהול ופיקוח'] }]);
  });
  it('הפרומפט כולל דוגמאות מההחלטות', () => {
    const p = scorePrompt([{ id: 1, title: 't', publisher: 'p', kind: 'k', topics: [], deadline: null, kw: [] }], s, [{ title: 'דוגמה', publisher: 'x', verdict: 'לא רלוונטי' }]);
    expect(p).toContain('לא רלוונטי: דוגמה');
  });
});
