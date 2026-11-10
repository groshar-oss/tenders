-- לידים מהשכרות: פרטי הספק/המשכיר מהודעות פטור, והזוכה במכרזי איתור דיור (נרשם ידנית)
set search_path = tenders;
alter table tenders add column if not exists party jsonb not null default '{}'::jsonb;  -- {supplier, supplierId, amount, currency, regulation, essence, start, end}
alter table tenders add column if not exists winner text not null default '';
alter table tenders add column if not exists winner_by text not null default '';
alter table tenders add column if not exists winner_at timestamptz;
alter table tenders add column if not exists lead_wa_at timestamptz;
-- לקרוא מחדש את עמודי הפטורים כדי לשלוף את שם הספק
update tenders set detail_at = null where kind = 'פטור';
