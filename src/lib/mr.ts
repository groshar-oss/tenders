// איסוף ממנהל הרכש הממשלתי (mr.gov.il): עמודי חיפוש ממוינים לפי תאריך עדכון, ועמוד פרטים לכל מכרז.
import { parseIlDate, parseIlDay } from './core';

export const MR_BASE = () => (process.env.MR_BASE || 'https://mr.gov.il').replace(/\/$/, '');

export const FEEDS: Record<string, { name: string; param: string }> = {
  'mr-tender': { name: 'מכרזים', param: 's=TENDER' },
  'mr-central': { name: 'מכרזים מרכזיים', param: 'i=CENTRALTENDER' },
  'mr-exemption': { name: 'פטורים וכוונות התקשרות', param: 's=EXEMPTION' },
};
export const listUrl = (feed: string, page: number) =>
  `${MR_BASE()}/ilgstorefront/he/search/?q=%3AupdateDate%3Aarchive%3Afalse&text=&${FEEDS[feed].param}${page ? `&page=${page}` : ''}`;

export type ListItem = {
  extId: string; url: string; kind: string; title: string; publisher: string; number: string; status: string;
  publishedOn: string | null; updatedOn: string | null; deadline: string | null;
};
export type Detail = {
  submitStart: string | null; deadline: string | null; topics: string[];
  contact: { name?: string; email?: string; phone?: string }; docs: { name: string; desc: string; url: string; date: string }[];
};

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** ערך שאחרי תווית ("שם המפרסם:") בתוך בלוק של תוצאת חיפוש */
function labeled(block: string, label: RegExp) {
  const m = block.match(new RegExp(`<span[^>]*>\\s*${label.source}[^<]*</span>\\s*<span[^>]*>([\\s\\S]*?)</span>`));
  return m ? text(m[1]) : '';
}

export function parseList(html: string): ListItem[] {
  const out: ListItem[] = [];
  // כל תוצאה: כותרת סוג (h3.search-result-sub-head) ואחריה קישור /p/<מספר> עם h2
  const re = /<h3 class="d-lg-none search-result-sub-head">([\s\S]*?)<\/h3>\s*<a href="([^"]*\/p\/(\d+))"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>\s*<\/a>([\s\S]*?)(?=<h3 class="d-lg-none search-result-sub-head">|<div class="logo-container|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, kind, href, id, title, rest] = m;
    out.push({
      extId: id,
      url: href.startsWith('http') ? href.replace(/^https?:\/\/[^/]+/, MR_BASE()) : MR_BASE() + href,
      kind: text(kind),
      title: text(title),
      publisher: labeled(rest, /שם המפרסם:/),
      number: labeled(rest, /מס׳ הליך:/),
      status: labeled(rest, /סטטוס:/),
      publishedOn: parseIlDay(labeled(rest, /תאריך פרסום:/)),
      updatedOn: parseIlDay(labeled(rest, /תאריך עדכון:/)),
      deadline: parseIlDate(labeled(rest, /מועד אחרון להגשה:/)),
    });
  }
  // הגנה מכפילויות (העמוד מציג לפעמים את אותה תוצאה בגרסת מחשב וטלפון)
  return out.filter((x, i, a) => a.findIndex((y) => y.extId === x.extId) === i);
}

export function totalResults(html: string) {
  const m = html.match(/נמצאו\s*([\d,]+)\s*תוצאות/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

export function parseDetail(html: string): Detail {
  const span = (id: string) => { const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)<`)); return m ? text(m[1]) : ''; };
  const topics: string[] = [];
  const subj = html.indexOf('id="subjects"');
  if (subj >= 0) {
    const part = html.slice(subj, html.indexOf('related-bids', subj) > 0 ? html.indexOf('related-bids', subj) : subj + 20000);
    for (const t of part.matchAll(/class="subject-wrapper[^"]*">([\s\S]*?)<\/div>/g)) { const v = text(t[1]); if (v && !topics.includes(v)) topics.push(v); }
  }
  const contact: Detail['contact'] = {};
  const cn = html.match(/class="bid-contact-name">([\s\S]*?)<\/div>/);
  if (cn) contact.name = text(cn[1]).replace(/^איש קשר:\s*/, '');
  const ce = html.match(/class="bid-contact-mail">[\s\S]*?mailto:([^"]+)"/);
  if (ce) contact.email = decode(ce[1]).trim();
  const cp = html.match(/class="bid-contact-phone">([\s\S]*?)<\/div>/);
  if (cp) contact.phone = text(cp[1]).replace(/^טלפון:\s*/, '');

  // מסמכים: בגרסת הטלפון כל מסמך הוא בלוק winning-bidder-wrapper עם תאריך, שם ותיאור
  const docs: Detail['docs'] = [];
  for (const b of html.matchAll(/<div class="winning-bidder-wrapper[^"]*">([\s\S]*?)<div class="download-wrapper/g)) {
    const block = b[1];
    const href = block.match(/href="([^"]*\/p\/attachment\/[^"]+)"/);
    if (!href) continue;
    const ps = [...block.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => text(x[1]));
    const url = decode(href[1]).replace(/^https?:\/\/[^/]+/, MR_BASE());
    if (docs.some((d) => d.url === url)) continue;
    docs.push({ date: ps[0] || '', name: ps[1] || 'מסמך', desc: ps[2] || '', url: url.startsWith('http') ? url : MR_BASE() + url });
  }
  return { submitStart: parseIlDate(span('firstSubmittingDate')), deadline: parseIlDate(span('lastDate')), topics, contact, docs };
}

/* ---------- הורדה ---------- */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** מוריד עמוד. אם האתר חוסם שרתים, ואם הוגדר FIRECRAWL_API_KEY, מוריד דרך Firecrawl. */
export async function fetchHtml(url: string): Promise<string> {
  let err = '';
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'he-IL,he;q=0.9', accept: 'text/html' }, signal: AbortSignal.timeout(25_000) });
    const t = await r.text();
    if (r.ok && /ilgstorefront|search-results|bids-head/.test(t)) return t;
    err = `HTTP ${r.status}${r.ok ? ' (תוכן לא צפוי, ייתכן חסימה)' : ''}`;
  } catch (e) { err = (e as Error).message; }
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error(`מנהל הרכש לא זמין: ${err}`);
  const r = await fetch(`${process.env.FIRECRAWL_BASE || 'https://api.firecrawl.dev'}/v1/scrape`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false }), signal: AbortSignal.timeout(60_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.rawHtml) throw new Error(`מנהל הרכש לא זמין (${err}); גם Firecrawl נכשל: ${j?.error || r.status}`);
  return j.data.rawHtml as string;
}

/** מוריד מסמך מכרז (PDF / Word) */
export async function fetchDoc(url: string, maxBytes = 18 * 1024 * 1024) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`הורדת המסמך נכשלה (${r.status})`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('המסמך גדול מדי לבדיקה אוטומטית');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('המסמך גדול מדי לבדיקה אוטומטית');
  let mime = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime || mime === 'application/octet-stream') {
    if (buf.subarray(0, 4).toString() === '%PDF') mime = 'application/pdf';
    else if (buf.subarray(0, 2).toString() === 'PK') mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return { buf, mime };
}
