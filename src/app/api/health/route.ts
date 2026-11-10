import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** בדיקת מצב: מסד, ואילו הגדרות קיימות (בלי ערכים) */
export async function GET() {
  const env = Object.fromEntries(['DB_PASSWORD', 'SUPABASE_REF', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GEMINI_API_KEY', 'CRON_SECRET', 'FIRECRAWL_API_KEY'].map((k) => [k, !!process.env[k]]));
  try {
    const r = await q1<{ n: number; last: string | null }>("select (select count(*)::int from tenders) as n, (select max(started_at) from runs where kind = 'collect' and ok) as last");
    return NextResponse.json({ ok: true, db: true, tenders: r?.n, lastCollect: r?.last, env });
  } catch (e) {
    return NextResponse.json({ ok: false, db: false, error: String((e as Error).message).slice(0, 200), env }, { status: 500 });
  }
}
