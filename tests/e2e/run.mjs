// בדיקת קצה לקצה: מסד מקומי + השרת האמיתי (next start) + שירותים מדומים + דפדפן.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFake } from './fake.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..', '..');
const OUT = process.env.SHOTS || path.join(dir, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const DB = 'tnd_e2e', FAKE = 4200, PORT = 3200;
const psql = (args) => execSync(`su postgres -c "psql -q -v ON_ERROR_STOP=1 ${args}"`, { stdio: 'pipe' });
psql(`-c 'drop database if exists ${DB}' -c 'create database ${DB}'`);
for (const f of fs.readdirSync(`${root}/supabase/migrations`).sort()) psql(`-d ${DB} -f ${root}/supabase/migrations/${f}`);
psql(`-c \\"alter role tenders_app password 'localtest'\\"`);
const sql = (s) => { const f = path.join(OUT, '_q.sql'); fs.writeFileSync(f, s); fs.chmodSync(f, 0o644); return execSync(`su postgres -c "psql -At -d ${DB} -f ${f}"`).toString().trim(); };

const { st, server } = await startFake(FAKE);
const F = `http://127.0.0.1:${FAKE}`;
const env = {
  ...process.env, PORT: String(PORT), DATABASE_URL: `postgresql://tenders_app:localtest@localhost:5432/${DB}`,
  GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', GEMINI_API_KEY: 'k', CRON_SECRET: 'cron1', SESSION_SECRET: 'sess',
  GOOGLE_OAUTH_BASE: F, GOOGLE_TOKEN_URL: F + '/token', GOOGLE_USERINFO_URL: F + '/v1/userinfo', GMAIL_API_BASE: F, GEMINI_API_BASE: F,
  MR_BASE: F, CALLMEBOT_URL: F + '/callmebot',
};
const app = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let logs = ''; app.stdout.on('data', (d) => (logs += d)); app.stderr.on('data', (d) => (logs += d));
const url = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 60; i++) { try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const fails = [];
const check = (c, m) => { if (!c) { fails.push(m); console.log('FAIL', m); } else console.log('ok  ', m); };
const as = (email) => fetch(F + '/__as', { method: 'POST', body: JSON.stringify({ email }) });
const state = () => fetch(F + '/__state').then((r) => r.json());

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium' });
async function page(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'he-IL' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  return p;
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = (p, n, full) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: !!full });

try {
  // ---------- כניסה: הראשון הופך לבעל החשבון ----------
  let p = await page({ width: 1280, height: 860 });
  await p.goto(url);
  await p.waitForSelector('a.gbtn');
  await shot(p, '00-login');
  await as('groshar@gmail.com');
  await p.click('a.gbtn');
  await p.waitForSelector('text=המאגר עוד ריק');
  check(sql("select role from members where email = 'groshar@gmail.com'") === 'owner', 'first login is owner');
  await shot(p, '01-empty');

  // ---------- זר לא נכנס ----------
  const p2 = await page({ width: 1000, height: 700 });
  await as('stranger@gmail.com');
  await p2.goto(url + 'api/auth/login');
  await p2.waitForSelector('text=לא ברשימת המורשים');
  check(true, 'unknown account refused');
  await p2.context().close();
  await as('groshar@gmail.com');

  // ---------- הגדרות: וואטסאפ, Google, איסוף ----------
  await p.goto(url + '#settings');
  await p.waitForSelector('#waPhone');
  await p.fill('#waPhone', '972541234567');
  await p.fill('#waKey', 'wa-key');
  await p.click('#saveAlerts');
  await p.waitForSelector('text=נשמר');
  check(!sql("select data->>'waKeyEnc' from settings").includes('wa-key') && sql("select data->>'waKeyEnc' from settings").length > 10, 'whatsapp key stored encrypted');
  await p.click('#testWa');
  await p.waitForSelector('text=נשלחה הודעת בדיקה');
  check((await state()).wa.length === 1 && (await state()).wa[0].phone === '972541234567', 'whatsapp test sent');
  await p.click('a[href="/api/google/connect"]');
  await p.waitForSelector('text=נשלח מ:');
  check(sql("select account_email from integrations where provider = 'google'") === 'groshar@gmail.com', 'google connected for mail');

  sql(`update settings set data = jsonb_set(data, '{digestTime}', '"23:59"')`);
  await p.click('#runNow');
  await p.waitForSelector('text=איסוף:', { timeout: 60000 });
  const n = +sql('select count(*) from tenders');
  check(n >= 15, `collected ${n} tenders from search page`);
  check(+sql("select count(*) from tenders where detail_at is null and deadline > now()") === 0, 'details fetched for all open tenders');
  check(sql("select topics[1] from tenders limit 1") === 'שירותי ניהול, יעוץ ומנהל', 'topics from detail page');
  check(+sql("select count(*) from tenders where ai_at is null and deadline > now()") === 0, 'all open tenders scored');
  check(+sql("select count(*) from tenders where ai_reason like 'לא נמצאו%'") > 0, 'non-candidates skipped without AI');
  check(sql("select cursor->>'backfill' from sources where id = 'mr-tender'") === 'false', 'backfill finished (empty next page)');
  await shot(p, '02-settings', true);

  // ---------- רשימה ----------
  await p.goto(url + '#list');
  await p.waitForSelector('.tc');
  const cards = await p.$$eval('.tc', (els) => els.length);
  const rel = +sql("select count(*) from tenders where ai_score >= 40 and (deadline is null or deadline > now())");
  check(cards === rel && rel >= 1, `list shows relevant (${cards}/${rel})`);
  await shot(p, '03-list', true);
  await p.selectOption('#fmin', '0');
  await p.waitForFunction((n) => document.querySelectorAll('.tc').length > n, cards);
  check(true, 'filter "all" shows more');
  await p.fill('#fq', 'משטרת');
  await p.waitForFunction(() => { const c = [...document.querySelectorAll('.tc')]; return c.length >= 1 && c.every((e) => e.textContent.includes('משטרת')); }, null, { timeout: 8000 }).catch(() => {});
  const pol = await p.$$eval('.tc', (els) => els.every((e) => e.textContent.includes('משטרת')));
  check(pol, 'text search filters');
  await p.click('#freset');
  await p.waitForSelector('.tc');

  // ---------- פרטי מכרז + תנאי סף ----------
  const top = sql('select id from tenders order by ai_score desc nulls last limit 1');
  await p.click(`.tc[data-id="${top}"] .ttl`);
  await p.waitForSelector('#elig');
  await p.click('#elig');
  await p.waitForSelector('text=שאלות הבהרה מוצעות', { timeout: 30000 });
  check(sql(`select elig->'overall'->>'tzi' from tenders where id = ${top}`) === 'לא מתאים', 'eligibility saved');
  await shot(p, '04-detail', true);
  await p.click('.stbtns [data-st="preparing"]');
  await p.waitForSelector('text=סומן: בהכנה');
  check(sql(`select my_status from tenders where id = ${top}`) === 'preparing', 'status saved from detail');
  await p.click('#x');
  await p.waitForFunction(() => document.querySelector('#modal').hidden);
  // סימון מהיר
  const second = sql(`select id from tenders where id <> ${top} and ai_score >= 40 order by ai_score desc nulls last limit 1`);
  if (second) {
    await p.click(`.tc[data-id="${second}"] [data-st="irrelevant"]`);
    await p.waitForSelector('text=סומן: לא רלוונטי');
    check(!(await p.$(`.tc[data-id="${second}"]`)), 'irrelevant hidden from list');
  }
  await p.goto(url + '#tracked');
  await p.waitForSelector(`.tc[data-id="${top}"]`);
  check(true, 'tracked view shows preparing tender');

  // ---------- cron: וואטסאפ וסיכום ----------
  // מועד הגשה קרוב למכרז במעקב → תזכורת
  sql(`update tenders set deadline = now() + interval '2 days' where id = ${top}`);
  sql(`update settings set data = jsonb_set(data, '{digestTime}', '"00:00"')`);
  const s0 = await state();
  const bad = await fetch(url + 'api/cron');
  check(bad.status === 401, 'cron needs secret');
  const cr = await (await fetch(url + 'api/cron', { headers: { authorization: 'Bearer cron1' } })).json();
  check(cr.ok, 'cron ran: ' + JSON.stringify(cr.data || cr.error).slice(0, 200));
  const s1 = await state();
  const waMsg = s1.wa[s1.wa.length - 1]?.text || '';
  check(s1.wa.length === s0.wa.length + 1 && waMsg.includes('תזכורת'), 'whatsapp alert with reminder');
  check(+sql('select count(*) from tenders where wa_at is not null') >= 0 && sql(`select remind_at is not null from tenders where id = ${top}`) === 't', 'reminder marked');
  check(s1.mails.length === s0.mails.length + 1 && /מכרזים/.test(s1.mails.at(-1).subject) && s1.mails.at(-1).html.includes('נסגרים השבוע'), 'daily digest sent: ' + (s1.mails.at(-1)?.subject || '') + ` (${s0.mails.length}->${s1.mails.length}, wa ${s0.wa.length}->${s1.wa.length})`);
  fs.writeFileSync(path.join(OUT, 'digest.html'), s1.mails.at(-1)?.html || '');
  const cr2 = await (await fetch(url + 'api/cron', { headers: { authorization: 'Bearer cron1' } })).json();
  const s2 = await state();
  check(s2.mails.length === s1.mails.length && s2.wa.length === s1.wa.length, 'second cron: no duplicate mail/whatsapp');
  check(!cr2.data.collect, 'second cron skips collection (not due)');

  // ---------- חסימה ----------
  await fetch(F + '/__block', { method: 'POST', body: JSON.stringify({ block: true }) });
  await (await fetch(url + 'api/cron?force=1', { headers: { authorization: 'Bearer cron1' } })).json();
  check(/מנהל הרכש לא זמין/.test(sql("select last_error from sources where id = 'mr-tender'")), 'blocked source error recorded');
  await p.goto(url + '#list'); await p.reload();
  await p.waitForSelector('text=שגיאה באיסוף');
  check(true, 'error banner shown');
  await fetch(F + '/__block', { method: 'POST', body: JSON.stringify({ block: false }) });

  // ---------- טלפון ----------
  const m = await page({ width: 390, height: 844 });
  await m.goto(url);
  await m.waitForSelector('a.gbtn'); await m.click('a.gbtn');
  await m.waitForSelector('.tc');
  check((await overflow(m)) <= 0, 'phone list: no horizontal overflow');
  await shot(m, '05-phone-list');
  await m.click('.tc .ttl');
  await m.waitForSelector('#elig');
  check((await overflow(m)) <= 0, 'phone detail: no overflow');
  await shot(m, '06-phone-detail', true);
  await m.goto(url + '#settings');
  await m.waitForSelector('#waPhone');
  check((await overflow(m)) <= 0, 'phone settings: no overflow');
  await shot(m, '07-phone-settings', true);
} catch (e) {
  fails.push('exception: ' + e.message);
  console.log(e);
} finally {
  await browser.close();
  server.close();
  try { process.kill(-app.pid); } catch {}
  if (fails.length) { console.log('\nSERVER LOG:\n' + logs.slice(-3000)); console.log('\nFAILED:', fails.length); process.exit(1); }
  console.log('\nALL OK');
  process.exit(0);
}
