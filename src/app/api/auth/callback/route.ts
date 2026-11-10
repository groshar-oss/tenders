import { NextResponse, type NextRequest } from 'next/server';
import { q, q1 } from '@/lib/db';
import { exchangeCode, resetTokenCache, saveConnection, userInfo } from '@/lib/google';
import { baseUrl, getMe } from '@/lib/http';
import { COOKIE, readState, signSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const base = baseUrl(req);
  const fail = (m: string) => NextResponse.redirect(`${base}/?e=${encodeURIComponent(m)}`);
  const sp = req.nextUrl.searchParams;
  if (sp.get('error')) return fail('הכניסה בוטלה.');
  const st = readState<{ p: string; by?: string }>(sp.get('state'));
  if (!st) return fail('פג תוקף הכניסה. נסה שוב.');
  try {
    const tok = await exchangeCode(sp.get('code') || '', `${base}/api/auth/callback`);
    const info = await userInfo(tok.access_token);
    const email = String(info.email || '').toLowerCase();
    if (!email) return fail('לא התקבלה כתובת מייל מ-Google.');

    if (st.p === 'connect') {
      const me = await getMe(req);
      if (!me || me.role !== 'owner') return fail('רק בעל החשבון יכול לחבר Google.');
      if (!tok.refresh_token) return fail('Google לא החזיר הרשאה קבועה. נסה שוב, ובחלון של Google אשר את כל ההרשאות.');
      const scopes = String(tok.scope || '');
      if (!scopes.includes('gmail.send')) return fail('צריך לאשר שליחת מייל. נסה שוב וסמן את ההרשאה.');
      await saveConnection(email, tok.refresh_token);
      resetTokenCache();
      return NextResponse.redirect(`${base}/?ok=${encodeURIComponent('חשבון Google חובר לשליחת מיילים: ' + email)}#settings`);
    }

    // כניסה רגילה
    let m = await q1<{ email: string; name: string; role: string }>('select email, name, role from members where email = $1', [email]);
    if (!m) {
      const any = await q1<{ n: number }>('select count(*)::int as n from members');
      // התקנה ריקה: הראשון שנכנס הופך לבעל החשבון
      if (any?.n === 0) { await q("insert into members (email, name, role) values ($1, $2, 'owner')", [email, info.name || '']); m = { email, name: info.name || '', role: 'owner' }; }
      else return fail(`החשבון ${email} לא ברשימת המורשים. בעל החשבון מוסיף מורשים במסך ההגדרות.`);
    }
    await q('update members set last_login_at = now(), name = case when name = \'\' then $2 else name end where email = $1', [email, info.name || '']);
    const res = NextResponse.redirect(`${base}/`);
    res.cookies.set(COOKIE, signSession({ email, name: m.name || info.name || '' }), { httpOnly: true, secure: base.startsWith('https'), sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
    return res;
  } catch (e) {
    // דפדפנים בטלפון לפעמים טוענים את כתובת החזרה פעמיים. הפעם השנייה נכשלת (הקוד כבר נוצל), אבל הראשונה כבר הצליחה.
    if ((e as { code?: string }).code === 'invalid_grant') {
      if (st.p === 'connect') {
        const c = await q1<{ fresh: boolean }>("select connected_at > now() - interval '3 minutes' as fresh from integrations where provider = 'google' and refresh_token_enc is not null");
        if (c?.fresh) return NextResponse.redirect(`${base}/?ok=${encodeURIComponent('חשבון Google חובר')}#settings`);
      } else if (await getMe(req)) return NextResponse.redirect(`${base}/`);
    }
    return fail('הכניסה נכשלה: ' + (e as Error).message);
  }
}
