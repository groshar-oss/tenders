import { q, q1, UserError } from './db';
import { decrypt, encrypt } from './session';

// כתובות Google. בבדיקות מפנים אותן לשרת מדומה.
const OAUTH = () => process.env.GOOGLE_OAUTH_BASE || 'https://accounts.google.com';
const TOKEN = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const USERINFO = () => process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL = () => process.env.GMAIL_API_BASE || 'https://gmail.googleapis.com';

export const LOGIN_SCOPES = ['openid', 'email', 'profile'];
/** הרשאה מצומצמת: האפליקציה יכולה רק לשלוח מייל (לסיכום היומי). */
export const CONNECT_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];

function client() {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new UserError('Google לא מוגדר: חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET בהגדרות Vercel.', 500);
  return { id, secret };
}

export function authUrl(redirectUri: string, scopes: string[], state: string, offline: boolean, hint?: string) {
  const p = new URLSearchParams({
    client_id: client().id, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '), state,
    prompt: offline ? 'consent' : 'select_account', include_granted_scopes: 'true',
  });
  if (offline) p.set('access_type', 'offline');
  if (hint) p.set('login_hint', hint);
  return `${OAUTH()}/o/oauth2/v2/auth?${p}`;
}

async function tokenCall(body: Record<string, string>) {
  const { id, secret } = client();
  const r = await fetch(TOKEN(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Google: ${j.error_description || j.error || r.status}`) as Error & { code?: string };
    err.code = j.error;
    throw err;
  }
  return j as { access_token: string; refresh_token?: string; scope?: string; id_token?: string };
}
export const exchangeCode = (code: string, redirectUri: string) => tokenCall({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });

export async function userInfo(accessToken: string) {
  const r = await fetch(USERINFO(), { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error('לא הצלחתי לקרוא את פרטי חשבון Google');
  return (await r.json()) as { email: string; name?: string; email_verified?: boolean };
}

/* ---------- החשבון המחובר לשליחת מיילים ---------- */

export async function saveConnection(email: string, refreshToken: string) {
  await q(`insert into integrations (provider, account_email, refresh_token_enc, connected_at, health, health_at, health_error)
           values ('google', $1, $2, now(), 'ok', now(), '')
           on conflict (provider) do update set account_email = $1, refresh_token_enc = $2, connected_at = now(), health = 'ok', health_at = now(), health_error = ''`,
    [email, encrypt(refreshToken)]);
}
export async function connection() {
  return q1<{ account_email: string; refresh_token_enc: string | null; health: string; health_error: string; connected_at: string }>(
    "select * from integrations where provider = 'google'");
}

export class GoogleNotConnected extends UserError {
  constructor(msg = 'חשבון Google לא מחובר. בעל החשבון צריך ללחוץ "חבר Google" במסך ההגדרות.') { super(msg, 409); }
}

let cached: { token: string; until: number } | null = null;
export async function accessToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const c = await connection();
  if (!c?.refresh_token_enc) throw new GoogleNotConnected();
  try {
    const t = await tokenCall({ refresh_token: decrypt(c.refresh_token_enc), grant_type: 'refresh_token' });
    cached = { token: t.access_token, until: Date.now() + 45 * 60_000 };
    if (c.health !== 'ok') await q("update integrations set health = 'ok', health_at = now(), health_error = '' where provider = 'google'");
    return t.access_token;
  } catch (e) {
    if ((e as { code?: string }).code === 'invalid_grant') {
      await q("update integrations set health = 'revoked', health_at = now(), health_error = $1 where provider = 'google'", [String((e as Error).message).slice(0, 300)]);
      throw new GoogleNotConnected('Google ביטל את ההרשאה. בעל החשבון צריך לחבר מחדש במסך ההגדרות.');
    }
    throw e;
  }
}
export const resetTokenCache = () => { cached = null; };

async function gfetch(url: string, init: RequestInit = {}) {
  const token = await accessToken();
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let m = t;
    try { m = JSON.parse(t).error?.message || t; } catch { /* טקסט */ }
    throw new Error(`Google ${r.status}: ${String(m).slice(0, 300)}`);
  }
  return r;
}


const FOLDER = 'application/vnd.google-apps.folder';
/* ---------- Gmail ---------- */

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const encWord = (s: string) => `=?UTF-8?B?${b64(s)}?=`;
const wrap = (s: string) => s.replace(/.{76}/g, '$&\r\n');
export type Attachment = { filename: string; mime: string; content: Buffer };

export function buildMime(o: { from?: string; fromName?: string; to: string[]; cc?: string[]; subject: string; html: string; text?: string; attachments?: Attachment[] }) {
  const mixed = 'm_' + Math.random().toString(36).slice(2), alt = 'a_' + Math.random().toString(36).slice(2);
  const from = o.from ? (o.fromName ? `${encWord(o.fromName)} <${o.from}>` : o.from) : undefined;
  const lines = [
    ...(from ? [`From: ${from}`] : []),
    `To: ${o.to.join(', ')}`,
    ...(o.cc?.length ? [`Cc: ${o.cc.join(', ')}`] : []),
    `Subject: ${encWord(o.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(b64(o.text || o.subject)),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(b64(o.html)),
    `--${alt}--`,
  ];
  for (const a of o.attachments || []) {
    lines.push(`--${mixed}`, `Content-Type: ${a.mime}; name="${encWord(a.filename)}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encWord(a.filename)}"`, '', wrap(a.content.toString('base64')));
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}

export async function sendMail(o: Parameters<typeof buildMime>[0]) {
  const raw = buildMime(o);
  const r = await gfetch(`${GMAIL()}/upload/gmail/v1/users/me/messages/send?uploadType=media`, { method: 'POST', headers: { 'content-type': 'message/rfc822' }, body: raw });
  return (await r.json()).id as string;
}

