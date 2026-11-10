// שרת מדומה: Google (כניסה, Gmail), Gemini, מנהל הרכש ו-CallMeBot.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function startFake(port) {
  const st = { nextLogin: 'groshar@gmail.com', mails: [], wa: [], geminiCalls: [], mrCalls: [], block: false };
  const dec = (s) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString());
  const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const base = `http://127.0.0.1:${port}`;
  // עמוד חיפוש: הקישורים במקור מצביעים ל-mr.gov.il; הקוד מחליף לכתובת MR_BASE
  const search = fs.readFileSync(path.join(FX, 'mr-search.html'), 'utf8');
  const detail = fs.readFileSync(path.join(FX, 'mr-detail.html'), 'utf8');
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, base);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const auth = (req.headers.authorization || '').replace('Bearer ', '');
    const p = u.pathname;
    try {
      if (p === '/__as') { st.nextLogin = JSON.parse(body).email; return json(res, 200, {}); }
      if (p === '/__block') { st.block = JSON.parse(body).block; return json(res, 200, {}); }
      if (p === '/__state') return json(res, 200, { mails: st.mails, wa: st.wa, geminiCalls: st.geminiCalls.length, mrCalls: st.mrCalls });
      // מנהל הרכש
      if (p === '/ilgstorefront/he/search/') {
        st.mrCalls.push(u.search);
        if (st.block) { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('<html>blocked</html>'); }
        const page = Number(u.searchParams.get('page') || 0);
        const html = u.searchParams.get('s') === 'TENDER' && page === 0 ? search : '<html><body class="ilgstorefront"><div class="search-results">נמצאו 0 תוצאות</div></body></html>';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (/^\/ilgstorefront\/he\/p\/attachment\//.test(p)) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(Buffer.from('%PDF-1.4\n% fake tender booklet\n'));
      }
      if (/^\/ilgstorefront\/he\/p\/\d+$/.test(p)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(detail); }
      // CallMeBot
      if (p === '/callmebot') {
        if (u.searchParams.get('apikey') !== 'wa-key') { res.writeHead(200); return res.end('APIKey is invalid. ERROR'); }
        st.wa.push({ phone: u.searchParams.get('phone'), text: u.searchParams.get('text') });
        res.writeHead(200); return res.end('Message queued. You will receive it in a few seconds.');
      }
      // Google
      if (p === '/o/oauth2/v2/auth') {
        const r = new URL(u.searchParams.get('redirect_uri'));
        r.searchParams.set('code', Buffer.from(JSON.stringify({ email: st.nextLogin, scope: u.searchParams.get('scope') })).toString('base64url'));
        r.searchParams.set('state', u.searchParams.get('state'));
        res.writeHead(302, { location: r.toString() }); return res.end();
      }
      if (p === '/token') {
        const f = new URLSearchParams(body.toString());
        if (f.get('grant_type') === 'authorization_code') {
          const c = JSON.parse(Buffer.from(f.get('code'), 'base64url').toString());
          const out = { access_token: 'at:' + c.email, scope: c.scope };
          if (/gmail/.test(c.scope)) out.refresh_token = 'rt:' + c.email;
          return json(res, 200, out);
        }
        return json(res, 200, { access_token: 'at:' + f.get('refresh_token').slice(3) });
      }
      if (p === '/v1/userinfo') return json(res, 200, { email: auth.slice(3), name: auth.slice(3).split('@')[0], email_verified: true });
      // Gemini: דירוג → לפי הסדר: הראשון 85 גרושר, השני 62 צי, השאר 10. תנאי סף → תשובה קבועה.
      const gm = p.match(/^\/v1beta\/models\/(.+):generateContent$/);
      if (gm) {
        const pl = JSON.parse(body); const text = pl.contents[0].parts[0].text || '';
        st.geminiCalls.push(text.slice(0, 80));
        let out;
        if (text.includes('דרג כל מכרז')) {
          const ids = [...text.matchAll(/^\{"id":(\d+)/gm)].map((m) => +m[1]);
          out = { results: ids.map((id, i) => ({ id, score: i === 0 ? 85 : i === 1 ? 62 : 10, entity: i === 0 ? 'groshar' : i === 1 ? 'tzi' : 'none', reason: i < 2 ? 'התאמה לבדיקה' : 'לא רלוונטי', region: i === 0 ? 'מרכז' : '', tags: i === 0 ? ['ניהול ופיקוח'] : [] })) };
        } else {
          out = { summary: 'מכרז לשירותי שמאות.', scope: '3 שנים', deadlines: [{ label: 'הגשה', when: '09/12/2026 15:00' }], guarantee: 'אין', scoring: '70% מחיר, 30% איכות',
            thresholds: [{ text: 'ניסיון של 3 שנים ברשויות מקומיות', groshar: 'לא ברור', tzi: 'לא עומד', why: 'אין בפרופיל' }], overall: { groshar: 'לא ברור', tzi: 'לא מתאים' }, risks: ['בלעדיות'], questions: ['האם ניסיון כקבלן משנה נחשב?'] };
        }
        return json(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
      }
      if (!auth.startsWith('at:')) return json(res, 401, { error: { message: 'no auth' } });
      if (p === '/upload/gmail/v1/users/me/messages/send') {
        const raw = body.toString();
        const head = raw.split('\r\n\r\n')[0];
        const h = (k) => dec(((head.match(new RegExp('^' + k + ': (.*)$', 'm')) || [])[1] || ''));
        const html = Buffer.from((raw.split('text/html; charset="UTF-8"')[1] || '').split('\r\n\r\n')[1]?.split('--')[0].replace(/\r\n/g, '') || '', 'base64').toString();
        st.mails.push({ from: h('From'), to: h('To'), subject: h('Subject'), html });
        return json(res, 200, { id: 'm' + st.mails.length });
      }
      json(res, 404, { error: { message: 'fake: ' + p } });
    } catch (e) { json(res, 500, { error: { message: String(e) } }); }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ st, server })));
}
