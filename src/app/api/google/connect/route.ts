import { NextResponse, type NextRequest } from 'next/server';
import { authUrl, CONNECT_SCOPES } from '@/lib/google';
import { baseUrl, getMe } from '@/lib/http';
import { signState } from '@/lib/session';

export const runtime = 'nodejs';

/** בעל החשבון מחבר חשבון Google שממנו יישלח הסיכום היומי */
export async function GET(req: NextRequest) {
  const base = baseUrl(req);
  const me = await getMe(req);
  if (!me || me.role !== 'owner') return NextResponse.redirect(`${base}/?e=${encodeURIComponent('רק בעל החשבון יכול לחבר Google.')}`);
  try {
    return NextResponse.redirect(authUrl(`${base}/api/auth/callback`, CONNECT_SCOPES, signState({ p: 'connect', by: me.email }), true));
  } catch (e) {
    return NextResponse.redirect(`${base}/?e=${encodeURIComponent((e as Error).message)}`);
  }
}
