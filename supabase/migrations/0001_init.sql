-- איתור מכרזים: מבנה ראשוני
-- האפליקציה מתחברת בתפקיד tenders_app בלבד (הסיסמה נקבעת מחוץ למאגר).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'tenders_app') then
    create role tenders_app login;
  end if;
end $$;

create table members (
  email text primary key,
  name text not null default '',
  role text not null default 'user' check (role in ('owner','user')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1);

create table integrations (
  provider text primary key,
  account_email text not null default '',
  refresh_token_enc text,
  connected_at timestamptz,
  health text not null default 'ok',
  health_at timestamptz,
  health_error text not null default ''
);

-- מקורות איסוף (מנהל הרכש: מכרזים, מכרזים מרכזיים, פטורים; בהמשך עיריות ותאגידים)
create table sources (
  id text primary key,
  name text not null,
  enabled boolean not null default true,
  cursor jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text not null default '',
  last_new int not null default 0,
  last_updated int not null default 0
);
insert into sources (id, name) values
  ('mr-tender', 'מנהל הרכש: מכרזים'),
  ('mr-central', 'מנהל הרכש: מכרזים מרכזיים'),
  ('mr-exemption', 'מנהל הרכש: פטורים וכוונות התקשרות');

create table tenders (
  id bigserial primary key,
  source text not null references sources(id),
  ext_id text not null,
  kind text not null default '',            -- מכרז פומבי / מכרז מרכזי / פטור / כוונה להתקשרות / RFI ...
  title text not null default '',
  publisher text not null default '',
  number text not null default '',          -- מס' הליך
  status text not null default '',          -- כפי שמופיע במקור
  published_on date,
  updated_on date,
  deadline timestamptz,
  submit_start timestamptz,
  url text not null default '',
  topics text[] not null default '{}',
  contact jsonb not null default '{}'::jsonb,
  docs jsonb not null default '[]'::jsonb,
  detail_at timestamptz,
  detail_error text not null default '',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  changed_at timestamptz not null default now(), -- מועד ההגשה/הסטטוס השתנה
  -- דירוג
  kw_groshar text[] not null default '{}',
  kw_tzi text[] not null default '{}',
  ai_score int,                              -- 0-100, ריק = עוד לא דורג
  ai_entity text not null default '',        -- groshar / tzi / both / none
  ai_reason text not null default '',
  ai_region text not null default '',
  ai_tags text[] not null default '{}',
  ai_at timestamptz,
  ai_error text not null default '',
  -- בדיקת תנאי סף
  elig jsonb,
  elig_at timestamptz,
  -- מעקב שלי
  my_status text not null default '' check (my_status in ('','interesting','preparing','submitted','won','lost','irrelevant')),
  my_note text not null default '',
  my_by text not null default '',
  my_at timestamptz,
  -- התראות
  wa_at timestamptz,
  wa_reason text not null default '',
  digest_at timestamptz,
  remind_at timestamptz,                     -- תזכורת לפני מועד הגשה (מכרז במעקב)
  unique (source, ext_id)
);
create index tenders_deadline on tenders (deadline);
create index tenders_score on tenders (ai_score desc nulls last);
create index tenders_first_seen on tenders (first_seen desc);
create index tenders_pending_ai on tenders (id) where ai_at is null;

create table runs (
  id bigserial primary key,
  kind text not null,                        -- collect / score / digest / wa
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  info jsonb not null default '{}'::jsonb
);
create index runs_kind on runs (kind, started_at desc);

-- הרשאות: רק תפקיד האפליקציה. הממשק הציבורי של Supabase לא רואה כלום.
do $$
declare t text;
begin
  foreach t in array array['members','settings','integrations','sources','tenders','runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy app_all on %I for all to tenders_app using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to tenders_app', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on %I from anon, authenticated', t);
    end if;
  end loop;
end $$;
grant usage on schema public to tenders_app;
grant usage, select on all sequences in schema public to tenders_app;
