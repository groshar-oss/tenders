// פעולות המסכים (/api/rpc)
import JSZip from 'jszip';
import { q, q1, UserError } from './db';
import { MY_STATUS, mergeSettings, type Settings } from './core';
import { cronJob, getSettings, scorePending, sendDigest, sendWhatsApp, digestRows } from './jobs';
import { eligibility, hasAiKey } from './gemini';
import { fetchDoc } from './mr';
import { connection } from './google';
import { encrypt } from './session';

export type Me = { email: string; name: string; role: 'owner' | 'user' };
type Ctx = { me: Me; baseUrl: string };

const ownerOnly = (c: Ctx) => { if (c.me.role !== 'owner') throw new UserError('רק בעל החשבון יכול לשנות הגדרות.', 403); };

export const LIST_COLS = `id, source, kind, title, publisher, number, status, published_on, updated_on, deadline, submit_start, url, topics,
  ai_score, ai_entity, ai_reason, ai_region, ai_tags, ai_at, kw_groshar, kw_tzi, my_status, my_note, first_seen, changed_at, (elig is not null) as has_elig`;

function publicSettings(s: Settings) {
  const { waKeyEnc, ...rest } = s;
  return { ...rest, waKeySet: !!waKeyEnc };
}

type Filters = {
  q?: string; entity?: string; min?: number; kind?: string; open?: boolean; days?: number; region?: string; publisher?: string;
  mine?: string; sort?: string; fresh?: boolean; limit?: number;
};

export async function list(f: Filters) {
  const where: string[] = [], p: unknown[] = [];
  const add = (sql: string, v?: unknown) => { if (v !== undefined) p.push(v); where.push(sql.replaceAll('$$', '$' + p.length)); };
  if (f.open !== false) add("(deadline is null or deadline > now()) and status not in ('חלף מועד הגשה','סגור','מבוטל','התקשרות הסתיימה')");
  if (f.q) for (const w of String(f.q).trim().split(/\s+/).slice(0, 5)) add("(title ilike $$ or publisher ilike $$ or number ilike $$ or array_to_string(topics, ' ') ilike $$)", `%${w}%`);
  if (f.entity === 'groshar') add("ai_entity in ('groshar','both')");
  else if (f.entity === 'tzi') add("ai_entity in ('tzi','both')");
  if (f.min !== undefined && f.min > 0) add('coalesce(ai_score, 0) >= $$', Number(f.min));
  if (f.kind) add('kind = $$', f.kind);
  if (f.days) add("deadline is not null and deadline < now() + ($$ || ' days')::interval", String(Number(f.days)));
  if (f.region) add('(ai_region = $$ or ai_region = \'ארצי\')', f.region);
  if (f.publisher) add('publisher ilike $$', `%${f.publisher}%`);
  if (f.fresh) add("first_seen > now() - interval '3 days'");
  if (f.mine === 'tracked') add("my_status in ('interesting','preparing','submitted')");
  else if (f.mine === 'hidden') add("my_status = 'irrelevant'");
  else if (f.mine === 'all') { /* הכל */ }
  else if (f.mine) add('my_status = $$', f.mine);
  else add("my_status <> 'irrelevant'");
  const order = f.sort === 'deadline' ? 'deadline asc nulls last' : f.sort === 'new' ? 'first_seen desc' : 'coalesce(ai_score, -1) desc, deadline asc nulls last';
  const limit = Math.min(500, Number(f.limit) || 200);
  const rows = await q(`select ${LIST_COLS} from tenders ${where.length ? 'where ' + where.join(' and ') : ''} order by ${order} limit ${limit}`, p);
  const total = await q1<{ n: number }>(`select count(*)::int as n from tenders ${where.length ? 'where ' + where.join(' and ') : ''}`, p);
  return { rows, total: total?.n || 0 };
}

async function boot(c: Ctx) {
  const s = await getSettings();
  const sources = await q('select id, name, enabled, last_run_at, last_ok_at, last_error, last_new, last_updated, cursor from sources order by id');
  const counts = await q1(`select count(*)::int as all,
    count(*) filter (where (deadline is null or deadline > now()) and coalesce(ai_score,0) >= $1 and my_status <> 'irrelevant')::int as relevant,
    count(*) filter (where first_seen > now() - interval '24 hours' and coalesce(ai_score,0) >= $1)::int as today,
    count(*) filter (where my_status in ('interesting','preparing','submitted') and (deadline is null or deadline > now()))::int as tracked,
    count(*) filter (where ai_at is null)::int as pending
    from tenders`, [s.digestMin]);
  const kinds = await q<{ kind: string; n: number }>("select kind, count(*)::int as n from tenders where kind <> '' group by kind order by n desc");
  const g = await connection();
  const runs = await q("select kind, started_at, finished_at, ok, info from runs order by started_at desc limit 12");
  const members = c.me.role === 'owner' ? await q('select email, name, role, last_login_at from members order by role, email') : [];
  return { me: c.me, settings: publicSettings(s), sources, counts, kinds, google: g ? { email: g.account_email, health: g.health } : null, runs, members, ai: hasAiKey(), appUrl: c.baseUrl };
}

async function get(id: number) {
  const t = await q1(`select ${LIST_COLS}, contact, docs, elig, elig_at, detail_error, ai_error, wa_at, wa_reason, my_by, my_at from tenders where id = $1`, [id]);
  if (!t) throw new UserError('המכרז לא נמצא.', 404);
  return t;
}

async function setStatus(c: Ctx, id: number, status: string, note?: string) {
  if (status && !MY_STATUS[status]) throw new UserError('סטטוס לא מוכר.');
  await q(`update tenders set my_status = $2, my_note = coalesce($3, my_note), my_by = $4, my_at = now() where id = $1`, [id, status, note ?? null, c.me.email]);
  return get(id);
}

/** בדיקת תנאי סף: מוריד את חוברת המכרז (ועוד עד 2 מסמכים) ושולח לבינה מלאכותית */
async function checkEligibility(id: number) {
  const t = await q1<{ title: string; publisher: string; docs: { name: string; desc: string; url: string }[] }>('select title, publisher, docs from tenders where id = $1', [id]);
  if (!t) throw new UserError('המכרז לא נמצא.', 404);
  if (!t.docs?.length) throw new UserError('אין מסמכים מצורפים למכרז הזה במנהל הרכש. פתח את עמוד המכרז ובדוק ידנית.');
  const rank = (d: { name: string; desc: string }) => (/חוברת|מסמכי המכרז|הזמנה להציע|מכרז/.test(d.name + d.desc) ? 0 : /תנאי|נספח/.test(d.name) ? 1 : /מודעה|עיתונות|פרוטוקול/.test(d.name) ? 3 : 2);
  const pick = [...t.docs].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  const docs: { name: string; mime: string; data: Buffer | string }[] = [];
  let total = 0;
  const errors: string[] = [];
  for (const d of pick) {
    try {
      const f = await fetchDoc(d.url);
      if (total + f.buf.length > 19 * 1024 * 1024) continue;
      if (f.mime === 'application/pdf') { docs.push({ name: d.name, mime: f.mime, data: f.buf }); total += f.buf.length; }
      else if (/word|officedocument/.test(f.mime)) {
        const zip = await JSZip.loadAsync(f.buf);
        const xml = await zip.file('word/document.xml')?.async('string');
        if (xml) docs.push({ name: d.name, mime: 'text/plain', data: xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&') });
      }
    } catch (e) { errors.push(`${d.name}: ${(e as Error).message}`); }
  }
  if (!docs.length) throw new UserError('לא הצלחתי לקרוא את מסמכי המכרז. ' + errors.join('; '));
  const s = await getSettings();
  const r = await eligibility(docs, t, s);
  await q('update tenders set elig = $2, elig_at = now() where id = $1', [id, JSON.stringify(r)]);
  return get(id);
}

async function saveSettings(c: Ctx, patch: Partial<Settings> & { waKey?: string }) {
  ownerOnly(c);
  const cur = await getSettings();
  const next = mergeSettings({ ...cur, ...patch });
  if (patch.waKey !== undefined) next.waKeyEnc = patch.waKey ? encrypt(String(patch.waKey).trim()) : '';
  else next.waKeyEnc = cur.waKeyEnc;
  delete (next as { waKey?: string }).waKey;
  const nums: (keyof Settings)[] = ['waMin', 'urgentMin', 'urgentDays', 'remindDays', 'digestMin', 'collectEveryMin'];
  for (const k of nums) (next[k] as number) = Math.max(0, Math.min(k === 'collectEveryMin' ? 1440 : 100, Math.round(Number(next[k]) || 0)));
  if (next.collectEveryMin < 60) next.collectEveryMin = 60;
  if (!/^\d{2}:\d{2}$/.test(next.digestTime)) next.digestTime = '07:30';
  next.digestTo = (Array.isArray(next.digestTo) ? next.digestTo : String(next.digestTo).split(/[,\s;]+/)).map((x) => x.trim()).filter((x) => /@/.test(x));
  await q('update settings set data = $1, updated_at = now() where id = 1', [JSON.stringify(next)]);
  return publicSettings(next);
}

async function members(c: Ctx, action: 'add' | 'remove', email: string, name = '') {
  ownerOnly(c);
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new UserError('כתובת מייל לא תקינה.');
  if (action === 'add') await q("insert into members (email, name, role) values ($1, $2, 'user') on conflict (email) do nothing", [e, name]);
  else {
    if (e === c.me.email) throw new UserError('אי אפשר להסיר את עצמך.');
    await q("delete from members where email = $1 and role <> 'owner'", [e]);
  }
  return q('select email, name, role, last_login_at from members order by role, email');
}

export async function call(name: string, args: unknown[], c: Ctx) {
  const a = args as never[];
  switch (name) {
    case 'boot': return boot(c);
    case 'list': return list((a[0] || {}) as Filters);
    case 'get': return get(Number(a[0]));
    case 'setStatus': return setStatus(c, Number(a[0]), String(a[1] || ''), a[2] as string | undefined);
    case 'eligibility': return checkEligibility(Number(a[0]));
    case 'rescore': { const s = await getSettings(); await scorePending(Date.now() + 120_000, s, [Number(a[0])]); return get(Number(a[0])); }
    case 'saveSettings': return saveSettings(c, (a[0] || {}) as Partial<Settings>);
    case 'members': return members(c, a[0], a[1], a[2]);
    case 'runNow': ownerOnly(c); return cronJob(c.baseUrl, { force: true });
    case 'rescoreAll': {
      ownerOnly(c);
      await q("update tenders set ai_at = null where (deadline is null or deadline > now())");
      const s = await getSettings();
      return scorePending(Date.now() + 240_000, s);
    }
    case 'testWhatsApp': { ownerOnly(c); const s = await getSettings(); await sendWhatsApp(s, `בדיקה ממערכת המכרזים ✅\n${c.baseUrl}`); return true; }
    case 'testDigest': { ownerOnly(c); const s = await getSettings(); return sendDigest(s, c.baseUrl); }
    case 'previewDigest': { const s = await getSettings(); return digestRows(s); }
    default: throw new UserError('פעולה לא מוכרת: ' + name);
  }
}
