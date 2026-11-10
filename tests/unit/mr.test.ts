import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseList, parseDetail, totalResults } from '@/lib/mr';

const fx = (n: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8');

describe('מנהל הרכש: עמוד חיפוש', () => {
  const items = parseList(fx('mr-search.html'));
  it('קורא את כל 20 התוצאות', () => {
    expect(items.length).toBe(20);
    expect(totalResults(fx('mr-search.html'))).toBe(8862);
  });
  it('שדות של תוצאה', () => {
    const t = items.find((x) => x.extId === '4000623143')!;
    expect(t.title).toBe('אספקת מערכת דימות ואנליזה אוטומטית – סריקת סליידים');
    expect(t.kind).toBe('מכרז פומבי');
    expect(t.publisher).toBe('משרד הבריאות - המרכז הרפואי תל אביב ע"ש סוראסקי, איכילוב');
    expect(t.number).toBe('265691');
    expect(t.status).toBe('עודכן');
    expect(t.publishedOn).toBe('2026-10-22');
    expect(t.updatedOn).toBe('2026-11-10');
    expect(t.deadline).toBe('2026-11-19T10:00:00.000Z'); // 12:00 שעון ישראל (חורף)
    expect(t.url).toBe('https://mr.gov.il/ilgstorefront/he/p/4000623143');
  });
  it('כל התוצאות עם מזהה, כותרת, מפרסם ותאריך עדכון', () => {
    for (const x of items) { expect(x.extId).toMatch(/^\d+$/); expect(x.title).not.toBe(''); expect(x.publisher).not.toBe(''); expect(x.updatedOn).toMatch(/^2026-/); }
  });
});

describe('מנהל הרכש: עמוד מכרז', () => {
  const d = parseDetail(fx('mr-detail.html'));
  it('מועדים, נושאים, איש קשר ומסמכים', () => {
    expect(d.deadline).toBe('2026-12-09T13:00:00.000Z');
    expect(d.submitStart).toBe('2026-11-30T06:00:00.000Z');
    expect(d.topics).toContain('שירותי ניהול, יעוץ ומנהל');
    expect(d.topics.length).toBe(7);
    expect(d.contact).toEqual({ name: 'אסף אהרונוביץ', email: 'asafa@land.gov.il' });
    expect(d.docs.map((x) => x.name)).toEqual(['חוברת המכרז', 'נספח למכרז', 'מודעה לעיתונות בעברית']);
    expect(d.docs[0].desc).toContain('PDF');
  });
});

describe('exemption detail (rental)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../fixtures/mr-exemption.html'), 'utf8');
  it('reads the landlord, company id and amount', () => {
    const d = parseDetail(html);
    expect(d.party.supplier).toBe('מחצית היובל בע"מ');
    expect(d.party.supplierId).toBe('512686114');
    expect(d.party.amount).toBe(4100000);
    expect(d.party.regulation).toMatch(/מקרקעין/);
    expect(d.party.start).toBe('2026-11-02');
    expect(d.topics).toContain('החכרת / השכרת קרקעות ומבנים');
    expect(d.contact.email).toBe('ibrahima@mof.gov.il');
    expect(d.docs.length).toBe(1);
    expect(d.docs[0].name).toBe('פרוטוקול לפרסום');
  });
  it('tender pages have no party', () => {
    const d = parseDetail(fs.readFileSync(path.join(__dirname, '../fixtures/mr-detail.html'), 'utf8'));
    expect(d.party.supplier).toBeUndefined();
  });
});
