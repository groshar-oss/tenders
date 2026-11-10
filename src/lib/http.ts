import { NextResponse, type NextRequest } from 'next/server';
import { q1, UserError } from './db';
import { COOKIE, readSession } from './session';
import type { Me } from './api';

export function baseUrl(req: NextRequest) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function getMe(req: NextRequest): Promise<Me | null> {
  const s = readSession(req.cookies.get(COOKIE)?.value);
  if (!s) return null;
  const m = await q1<{ email: string; name: string; role: 'owner' | 'user' }>('select email, name, role from members where email = $1', [s.email]);
  return m ? { email: m.email, name: m.name || s.name, role: m.role } : null;
}

export function errorJson(e: unknown) {
  if (e instanceof UserError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ ok: false, error: 'שגיאה בשרת: ' + String((e as Error)?.message || e).slice(0, 300) }, { status: 500 });
}
