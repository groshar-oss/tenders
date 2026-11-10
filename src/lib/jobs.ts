// העבודה הקבועה: איסוף, פרטים, דירוג, וואטסאפ וסיכום יומי.
import { q, q1 } from './db';
import { daysLeft, digestHtml, ilNow, isOpen, keywordScan, mergeSettings, pickWhatsApp, waText, type AlertRow, type Settings } from './core';
import { FEEDS, fetchHtml, listUrl, parseDetail, parseList, type ListItem } from './mr';
import { hasAiKey, scoreBatch, type Example } from './gemini';
import { connection, sendMail } from './google';
import { decrypt } from './session';

export async function getSettings(): Promise<Settings> {
  const r = await q1<{ data: unknown }>('select data from settings where id = 1');
  return mergeSettings(r?.data);
}

const run = async <T>(kind: string, fn: () => Promise<T>) => {
  const r = await q1<{ id: number }>('insert into runs (kind) values ($1) returning id', [kind]);
  try {
    const info = await fn();
    await q('update runs set finished_at = now(), ok = true, info = $2 where id = $1', [r!.id, JSON.stringify(info ?? {})]);
    return info;
  } catch (e) {
    await q('update runs set finished_at = now(), ok = false, info = $2 where id = $1', [r!.id, JSON.stringify({ error: String((e as Error).message).slice(0, 500) })]);
    throw e;
  }
};

/* ---------- איסוף ---------- */

type Cursor = { backfill?: boolean; page?: number; since?: string };
const BACKFILL_DAYS = 150;

/** שומר תוצאה. מחזיר 'new' / 'updated' / 'same' */
async function upsert(source: string, it: ListItem) {
  const r = await q1<{ ins: boolean }>(
    `insert into tenders (source, ext_id, kind, title, publisher, number, status, published_on, updated_on, deadline, url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (source, ext_id) do update set kind = excluded.kind, title = excluded.title, publisher = excluded.publisher, number = excluded.number,
       status = excluded.status, published_on = excluded.published_on, updated_on = excluded.updated_on, deadline = coalesce(excluded.deadline, tenders.deadline), url = excluded.url, last_seen = now(),
       detail_at = case when tenders.updated_on is distinct from excluded.updated_on then null else tenders.detail_at end,
       changed_at = case when tenders.deadline is distinct from excluded.deadline or tenders.status is distinct from excluded.status then now() else tenders.changed_at end,
       remind_at = case when tenders.deadline is distinct from excluded.deadline then null else tenders.remind_at end
     returning (xmax = 0) as ins`,
    [source, it.extId, it.kind, it.title, it.publisher, it.number, it.status, it.publishedOn, it.updatedOn, it.deadline, it.url]);
  return r?.ins ? 'new' : 'same';
}

/** שומרים רק מה שעוד פתוח, או שעודכן ב-30 הימים האחרונים */
function keep(it: ListItem, now: Date) {
  if (it.deadline) return new Date(it.deadline).getTime() > now.getTime() - 864e5;
  return !!it.updatedOn && (now.getTime() - new Date(it.updatedOn).getTime()) / 864e5 <= 30;
}

export async function collectFeed(source: string, until: number, now = new Date()) {
  const src = await q1<{ cursor: Cursor; last_run_at: string | null }>('select cursor, last_run_at from sources where id = $1', [source]);
  const cur: Cursor = { ...(src?.cursor || {}) };
  const today = now.toISOString().slice(0, 10);
  let pages = 0, fresh = 0, seen = 0;
  const startPage = cur.backfill === false ? 0 : cur.page || 0;
  const stopBefore = cur.backfill === false
    ? new Date(new Date(cur.since || today).getTime() - 2 * 864e5).toISOString().slice(0, 10) // חפיפה של יומיים
    : new Date(now.getTime() - BACKFILL_DAYS * 864e5).toISOString().slice(0, 10);
  let page = startPage, done = false;
  while (!done && Date.now() < until && pages < (cur.backfill === false ? 12 : 25)) {
    const items = parseList(await fetchHtml(listUrl(source, page)));
    pages++;
    if (!items.length) { done = true; break; }
    for (const it of items) {
      seen++;
      if (keep(it, now) && (await upsert(source, it)) === 'new') fresh++;
    }
    const oldest = items.map((i) => i.updatedOn || '9999').sort()[0];
    if (oldest < stopBefore) done = true;
    page++;
  }
  // מילוי ראשוני: ממשיכים מהעמוד שעצרנו. בסיומו עוברים לעדכונים מתאריך תחילת המילוי (כדי לא לפספס מה שזז בינתיים).
  const started = cur.since || today;
  const next: Cursor = cur.backfill === false
    ? { backfill: false, since: done ? today : started }
    : done ? { backfill: false, since: started } : { backfill: true, page, since: started };
  await q(`update sources set cursor = $2, last_run_at = now(), last_ok_at = now(), last_error = '', last_new = $3, last_updated = $4 where id = $1`,
    [source, JSON.stringify(next), fresh, seen]);
  return { source, pages, seen, fresh, backfill: next.backfill !== false };
}

export async function collectAll(until: number) {
  const out: unknown[] = [];
  const srcs = await q<{ id: string }>('select id from sources where enabled order by id');
  for (const s of srcs) {
    if (!FEEDS[s.id]) continue;
    if (Date.now() > until) break;
    try { out.push(await collectFeed(s.id, until)); } catch (e) {
      await q("update sources set last_run_at = now(), last_error = $2 where id = $1", [s.id, String((e as Error).message).slice(0, 300)]);
      out.push({ source: s.id, error: (e as Error).message });
    }
  }
  return out;
}

/** עמוד פרטים: נושאים, מסמכים, איש קשר. קודם החדשים והפתוחים. */
export async function fetchDetails(until: number, max = 40) {
  const rows = await q<{ id: number; url: string }>(
    `select id, url from tenders where detail_at is null and (deadline is null or deadline > now()) order by first_seen desc limit $1`, [max]);
  let ok = 0, fail = 0;
  const work = [...rows];
  const worker = async () => {
    while (work.length && Date.now() < until) {
      const t = work.shift()!;
      try {
        const d = parseDetail(await fetchHtml(t.url));
        await q(`update tenders set topics = $2, contact = $3, docs = $4, submit_start = $5, deadline = coalesce($6, deadline), party = $7, detail_at = now(), detail_error = '',
                 ai_at = case when topics is distinct from $2 then null else ai_at end where id = $1`,
          [t.id, d.topics, JSON.stringify(d.contact), JSON.stringify(d.docs), d.submitStart, d.deadline, JSON.stringify(d.party)]);
        ok++;
      } catch (e) {
        await q("update tenders set detail_at = now(), detail_error = $2 where id = $1", [t.id, String((e as Error).message).slice(0, 300)]);
        fail++;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { details: ok, detailFail: fail };
}

/* ---------- דירוג ---------- */

export async function examples(): Promise<Example[]> {
  const r = await q<{ title: string; publisher: string; my_status: string }>(
    `select title, publisher, my_status from tenders where my_status <> '' order by my_at desc nulls last limit 24`);
  return r.map((x) => ({ title: x.title, publisher: x.publisher, verdict: x.my_status === 'irrelevant' ? 'לא רלוונטי' : 'רלוונטי' }));
}

export async function scorePending(until: number, s: Settings, ids?: number[]) {
  // מחכים לעמוד הפרטים (נושאים) לפני דירוג, אלא אם עברו שעתיים
  const rows = await q<{ id: number; title: string; publisher: string; kind: string; topics: string[]; deadline: string | null }>(
    ids?.length
      ? 'select id, title, publisher, kind, topics, deadline from tenders where id = any($1)'
      : `select id, title, publisher, kind, topics, deadline from tenders where ai_at is null and (detail_at is not null or first_seen < now() - interval '2 hours') order by first_seen desc limit 400`,
    ids?.length ? [ids] : []);
  let skipped = 0, scored = 0, failed = 0;
  const forAi: { id: number; title: string; publisher: string; kind: string; topics: string[]; deadline: string | null; kw: string[] }[] = [];
  for (const r of rows) {
    const k = keywordScan(r, s);
    await q('update tenders set kw_groshar = $2, kw_tzi = $3 where id = $1', [r.id, k.groshar, k.tzi]);
    if (k.candidate) forAi.push({ ...r, kw: [...k.groshar, ...k.tzi] });
    else {
      await q("update tenders set ai_score = 0, ai_entity = 'none', ai_reason = 'לא נמצאו מילות מפתח או נושאים רלוונטיים', ai_region = '', ai_tags = '{}', ai_at = now(), ai_error = '' where id = $1", [r.id]);
      skipped++;
    }
  }
  if (forAi.length && !hasAiKey()) {
    // בלי מפתח: ציון לפי מילות מפתח בלבד
    for (const r of forAi) {
      const k = keywordScan(r, s);
      const ent = k.groshar.length && k.tzi.length ? 'both' : k.groshar.length ? 'groshar' : k.tzi.length ? 'tzi' : 'none';
      await q("update tenders set ai_score = $2, ai_entity = $3, ai_reason = $4, ai_at = now(), ai_error = 'ללא מפתח Gemini' where id = $1",
        [r.id, Math.min(60, 25 + 10 * r.kw.length), ent, 'לפי מילות מפתח: ' + r.kw.join(', ')]);
    }
    return { skipped, scored: forAi.length, failed, ai: false };
  }
  const ex = await examples();
  for (let i = 0; i < forAi.length && Date.now() < until; i += 25) {
    const batch = forAi.slice(i, i + 25);
    try {
      const res = await scoreBatch(batch, s, ex);
      for (const o of res) {
        await q('update tenders set ai_score = $2, ai_entity = $3, ai_reason = $4, ai_region = $5, ai_tags = $6, ai_at = now(), ai_error = \'\' where id = $1',
          [o.id, o.score, o.entity, o.reason, o.region, o.tags]);
        scored++;
      }
      const missing = batch.filter((b) => !res.some((o) => o.id === b.id));
      for (const m of missing) await q("update tenders set ai_error = 'לא התקבל דירוג' where id = $1", [m.id]);
    } catch (e) {
      failed += batch.length;
      await q('update tenders set ai_error = $2 where id = any($1)', [batch.map((b) => b.id), String((e as Error).message).slice(0, 300)]);
    }
  }
  return { skipped, scored, failed, ai: true };
}

/* ---------- וואטסאפ ---------- */

export async function sendWhatsApp(s: Settings, text: string) {
  if (!s.waPhone || !s.waKeyEnc) throw new Error('וואטסאפ לא מוגדר (מספר ומפתח CallMeBot במסך ההגדרות)');
  const base = process.env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php';
  const url = `${base}?phone=${encodeURIComponent(s.waPhone.replace(/[^\d+]/g, ''))}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(decrypt(s.waKeyEnc))}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await r.text();
  if (!r.ok || /error|invalid|not\s+active/i.test(body.slice(0, 500)) && !/queued|sent/i.test(body)) throw new Error(`CallMeBot: ${r.status} ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
  return true;
}

const ALERT_COLS = 'id, title, publisher, kind, url, status, deadline, ai_score, ai_entity, ai_reason, my_status, wa_at, remind_at, first_seen';

/* ---------- לידים מהשכרות ---------- */

/** הודעת פטור על שכירת נכס (מופיע שם המשכיר). בלי רמ"י (הקצאות קרקע) ובלי חניות/תוכנה/ציוד. */
export const RENT_EXEMPT = `kind = 'פטור' and publisher not ilike '%רשות מקרקעי ישראל%'
  and (party->>'regulation' ilike '%מקרקעין%' or array_to_string(topics, ' ') ilike '%השכרת%' or title ~ '(שכירות|שכירת) (נכס|משרד|מבנה|שטח)')
  and title !~ '(חני|תוכנ|רכב|יריד|דוכן|ציוד)'`;
/** מכרז לאיתור דיור / שכירת נכס: הזוכה לא מתפרסם, צריך לברר מול איש הקשר */
export const RENT_TENDER = `kind like '%מכרז%' and title ~ '(איתור דיור|שכירת נכס|שכירות נכס|שכירת משרדים|שכירת מבנה)'`;

type LeadRow = { id: number; title: string; publisher: string; party: { supplier?: string; supplierId?: string; amount?: number }; contact: { name?: string; email?: string; phone?: string } };

export function leadText(exempt: LeadRow[], closed: LeadRow[], appUrl: string) {
  const L = ['🏢 לידים מהשכרות'];
  for (const r of exempt) {
    const p = r.party || {};
    L.push(`• השכרה בפטור: ${r.title}`, `  משכיר: ${p.supplier}${p.supplierId ? ` (ח"פ ${p.supplierId})` : ''}${p.amount ? ` · ${p.amount.toLocaleString('he-IL')} ₪` : ''}`);
  }
  for (const r of closed) {
    const c = r.contact || {};
    L.push(`• מכרז איתור דיור נסגר: ${r.title}`, `  לברר מי זכה: ${[c.name, c.phone, c.email].filter(Boolean).join(' · ') || r.publisher}`);
  }
  L.push(`${appUrl}/#leads`);
  return L.join('\n');
}

export async function leadsAlert(s: Settings, appUrl: string) {
  const exempt = await q<LeadRow>(`select id, title, publisher, party, contact from tenders where ${RENT_EXEMPT}
    and lead_wa_at is null and coalesce(party->>'supplier', '') <> '' and first_seen > now() - interval '3 days'
    and coalesce(published_on, first_seen::date) >= current_date - 3 order by first_seen limit 8`);
  const closed = await q<LeadRow>(`select id, title, publisher, party, contact from tenders where ${RENT_TENDER}
    and lead_wa_at is null and deadline < now() and deadline > now() - interval '3 days' and status <> 'מבוטל' order by deadline limit 8`);
  if (!exempt.length && !closed.length) return 0;
  await sendWhatsApp(s, leadText(exempt, closed, appUrl));
  await q('update tenders set lead_wa_at = now() where id = any($1)', [[...exempt, ...closed].map((r) => r.id)]);
  return exempt.length + closed.length;
}

export async function whatsappJob(s: Settings, appUrl: string, now = new Date()) {
  if (!s.waPhone || !s.waKeyEnc) return { wa: 'off' };
  const leads = await leadsAlert(s, appUrl);
  const rows = await q<AlertRow>(`select ${ALERT_COLS} from tenders where (deadline is null or deadline > now()) and (
      (wa_at is null and ai_score >= least($1::int, $2::int)) or (my_status in ('interesting','preparing') and remind_at is null and deadline is not null))`, [s.waMin, s.urgentMin]);
  const pick = pickWhatsApp(rows, s, now);
  if (!pick.length) return { wa: 0, leads };
  await sendWhatsApp(s, waText(pick, appUrl, now));
  for (const p of pick) {
    if (p.reason === 'תזכורת') await q('update tenders set remind_at = now() where id = $1', [p.row.id]);
    else await q('update tenders set wa_at = now(), wa_reason = $2 where id = $1', [p.row.id, p.reason]);
  }
  return { wa: pick.length, leads };
}

/* ---------- סיכום יומי במייל ---------- */

export async function digestRows(s: Settings) {
  const last = await q1<{ t: string }>("select max(started_at) as t from runs where kind = 'digest' and ok");
  const since = last?.t || new Date(Date.now() - 864e5).toISOString();
  const fresh = await q<AlertRow>(`select ${ALERT_COLS} from tenders where first_seen > $1 and ai_score >= $2 and my_status <> 'irrelevant' and (deadline is null or deadline > now())
                                   order by ai_score desc, deadline asc nulls last limit 60`, [since, s.digestMin]);
  const closing = await q<AlertRow>(`select ${ALERT_COLS} from tenders where my_status in ('interesting','preparing') and deadline > now() and deadline < now() + interval '7 days' order by deadline`);
  return { fresh: fresh.filter((r) => isOpen(r)), closing };
}

export async function sendDigest(s: Settings, appUrl: string, now = new Date()) {
  const to = s.digestTo.filter((x) => /@/.test(x));
  if (!to.length) throw new Error('לא הוגדרה כתובת לסיכום היומי');
  const c = await connection();
  if (!c?.refresh_token_enc) throw new Error('חשבון Google לשליחת מיילים לא מחובר (מסך ההגדרות)');
  const { fresh, closing } = await digestRows(s);
  const date = ilNow(now).date.split('-').reverse().join('/');
  const hot = fresh.filter((r) => (r.ai_score || 0) >= s.waMin).length;
  await sendMail({
    to, fromName: 'גרושר · מכרזים', subject: `מכרזים ${date}: ${fresh.length} חדשים${hot ? `, ${hot} חמים` : ''}${closing.length ? `, ${closing.length} נסגרים השבוע` : ''}`,
    html: digestHtml({ fresh, closing, appUrl, date }, now),
  });
  if (fresh.length) await q('update tenders set digest_at = now() where id = any($1)', [fresh.map((r) => r.id)]);
  return { digest: fresh.length, closing: closing.length };
}

/** האם הגיע זמן הסיכום היומי (שעון ישראל) ועוד לא נשלח היום */
export async function digestDue(s: Settings, now = new Date()) {
  const il = ilNow(now);
  if (il.hm < s.digestTime) return false;
  const last = await q1<{ d: string }>("select to_char(max(started_at) at time zone 'Asia/Jerusalem', 'YYYY-MM-DD') as d from runs where kind = 'digest' and ok");
  return last?.d !== il.date;
}

/* ---------- ההרצה הקבועה ---------- */

export async function cronJob(appUrl: string, opts: { force?: boolean } = {}) {
  const started = Date.now();
  const until = started + 230_000;
  const s = await getSettings();
  const out: Record<string, unknown> = {};
  const lastCollect = await q1<{ t: string | null }>("select max(started_at) as t from runs where kind = 'collect' and ok");
  const backfilling = await q1<{ n: number }>("select count(*)::int as n from sources where enabled and coalesce((cursor->>'backfill')::boolean, true)");
  const due = opts.force || !lastCollect?.t || (backfilling?.n || 0) > 0 || Date.now() - new Date(lastCollect.t).getTime() > (s.collectEveryMin - 10) * 60_000;
  if (due) {
    out.collect = await run('collect', async () => {
      const feeds = await collectAll(started + 150_000);
      const det = await fetchDetails(started + 190_000);
      return { feeds, ...det };
    });
  }
  out.score = await run('score', () => scorePending(until, s));
  try { out.wa = await run('wa', () => whatsappJob(s, appUrl)); } catch (e) { out.wa = { error: (e as Error).message }; }
  if (await digestDue(s)) {
    try { out.digest = await run('digest', () => sendDigest(s, appUrl)); } catch (e) { out.digest = { error: (e as Error).message }; }
  }
  out.ms = Date.now() - started;
  return out;
}

export { daysLeft };
