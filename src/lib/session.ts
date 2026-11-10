import { createHmac, createHash, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** סוד לחתימת עוגיות ולהצפנת האסימון של Google. נגזר מ-SESSION_SECRET, ואם אין, מכתובת המסד (שהיא סודית ממילא). */
function secret() {
  const s = process.env.SESSION_SECRET || process.env.DB_PASSWORD || process.env.DATABASE_URL;
  if (!s) throw new Error('SESSION_SECRET לא מוגדר');
  return createHash('sha256').update('tnd:' + s).digest();
}
const b64u = (b: Buffer) => b.toString('base64url');

export const COOKIE = 'tnd_s';
export type Session = { email: string; name: string; exp: number };

export function signSession(s: Omit<Session, 'exp'>, days = 30) {
  const body = b64u(Buffer.from(JSON.stringify({ ...s, exp: Date.now() + days * 864e5 })));
  return body + '.' + b64u(createHmac('sha256', secret()).update(body).digest());
}
export function readSession(token?: string | null): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', secret()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

/** חתימה קצרה ל-state של OAuth */
export function signState(data: object) {
  const body = b64u(Buffer.from(JSON.stringify({ ...data, t: Date.now(), n: randomBytes(6).toString('hex') })));
  return body + '.' + b64u(createHmac('sha256', secret()).update('st' + body).digest());
}
export function readState<T>(st?: string | null): T | null {
  if (!st) return null;
  const [body, sig] = st.split('.');
  if (!body || !sig) return null;
  const want = b64u(createHmac('sha256', secret()).update('st' + body).digest());
  if (want !== sig) return null;
  const d = JSON.parse(Buffer.from(body, 'base64url').toString());
  return Date.now() - d.t < 15 * 60_000 ? (d as T) : null;
}

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secret(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b64u).join('.');
}
export function decrypt(s: string) {
  const [iv, tag, enc] = s.split('.').map((x) => Buffer.from(x, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', secret(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/** סוד ל-cron של Vercel */
export const cronSecret = () => process.env.CRON_SECRET || '';
