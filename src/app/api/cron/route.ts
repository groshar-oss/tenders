import { NextResponse, type NextRequest } from 'next/server';
import { cronJob } from '@/lib/jobs';
import { errorJson, baseUrl } from '@/lib/http';
import { cronSecret } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** נקרא כל חצי שעה (pg_cron ב-Supabase) ופעם ביום מ-Vercel Cron. מחליט לבד מה לעשות. */
export async function GET(req: NextRequest) {
  const s = cronSecret();
  const ok = s ? req.headers.get('authorization') === `Bearer ${s}` : false;
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, data: await cronJob(baseUrl(req), { force: req.nextUrl.searchParams.get('force') === '1' }) });
  } catch (e) {
    return errorJson(e);
  }
}
