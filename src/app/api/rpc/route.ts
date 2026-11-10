import { NextResponse, type NextRequest } from 'next/server';
import { call } from '@/lib/api';
import { baseUrl, errorJson, getMe } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const me = await getMe(req);
    if (!me) return NextResponse.json({ ok: false, error: 'login', login: true }, { status: 401 });
    const { name, args } = await req.json();
    const data = await call(String(name), args || [], { me, baseUrl: baseUrl(req) });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorJson(e);
  }
}
