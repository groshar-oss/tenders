import { NextResponse, type NextRequest } from 'next/server';
import { authUrl, LOGIN_SCOPES } from '@/lib/google';
import { baseUrl } from '@/lib/http';
import { signState } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const base = baseUrl(req);
    return NextResponse.redirect(authUrl(`${base}/api/auth/callback`, LOGIN_SCOPES, signState({ p: 'login' }), false));
  } catch (e) {
    return NextResponse.redirect(`${baseUrl(req)}/?e=${encodeURIComponent((e as Error).message)}`);
  }
}
