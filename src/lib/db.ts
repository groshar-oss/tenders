import { Pool, types } from 'pg';

// numeric → מספר, timestamptz → ISO, date → 'YYYY-MM-DD'
types.setTypeParser(20, (v) => (v === null ? null : Number(v)) as unknown as number);
types.setTypeParser(1700, (v) => (v === null ? 0 : parseFloat(v)));
types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString()) as unknown as Date);
types.setTypeParser(1082, (v) => v as unknown as Date);

declare global { var __tndPool: Promise<Pool> | undefined; }

/** פרויקט Supabase של הכלי (לא סודי). הסיסמה מגיעה מ-DB_PASSWORD. */
const REF = () => process.env.SUPABASE_REF || '';
const REGION = () => process.env.SUPABASE_REGION || 'eu-central-1';

function candidates() {
  if (process.env.DATABASE_URL) return [process.env.DATABASE_URL];
  const pw = process.env.DB_PASSWORD;
  if (!pw || !REF()) throw new Error('DB_PASSWORD / SUPABASE_REF לא מוגדרים בהגדרות Vercel');
  return ['aws-1', 'aws-0'].map((p) => `postgresql://tenders_app.${REF()}:${encodeURIComponent(pw)}@${p}-${REGION()}.pooler.supabase.com:6543/postgres`);
}
const make = (url: string) => new Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false }, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });

/** מתחבר לכתובת הראשונה שעובדת (שרתי ה-pooler של Supabase משתנים בין פרויקטים) */
async function open() {
  let last: unknown;
  for (const url of candidates()) {
    const p = make(url);
    try { await p.query('select 1'); return p; } catch (e) { last = e; await p.end().catch(() => {}); }
  }
  throw last;
}
export function pool() {
  if (!globalThis.__tndPool) globalThis.__tndPool = open().catch((e) => { globalThis.__tndPool = undefined; throw e; });
  return globalThis.__tndPool;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const r = await (await pool()).query(text, params as unknown[]);
  return r.rows as T[];
}
export async function q1<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  return (await q<T>(text, params))[0] ?? null;
}

export class UserError extends Error {
  status: number;
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}
