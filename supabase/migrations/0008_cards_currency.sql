-- =====================================================================
--  0008 — البطاقات والعملات
--  * كل بطاقة تُحفظ أول ما تظهر في رسالة: البنك، النوع، آخر 4 أرقام، اسم مختصر، نسبة الرسوم الدولية.
--  * العملية بعملة أجنبية تُحفظ بمبلغها الأصلي وسعر الصرف، وتُضاف رسوم البطاقة إلى المبلغ بالريال.
-- =====================================================================

create table if not exists public.cards (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,   -- صاحب البطاقة
  bank         text not null default '' check (char_length(bank) <= 40),
  last4        text not null check (last4 ~ '^[0-9]{4}$'),
  card_type    text not null default 'other' check (card_type in ('credit', 'debit', 'mada', 'prepaid', 'other')),
  network      text check (network is null or network in ('visa', 'mastercard', 'mada', 'amex', 'other')),
  nickname     text check (nickname is null or char_length(nickname) <= 30),
  intl_fee_bps int  not null default 0 check (intl_fee_bps between 0 and 1000), -- 275 = 2.75%
  created_at   timestamptz not null default now(),
  unique (household_id, bank, last4),
  unique (id, household_id)
);

create trigger cards_lock before update on public.cards
for each row execute function public.lock_household_id();

alter table public.expenses
  add column if not exists card_id           uuid,
  add column if not exists original_amount   bigint check (original_amount is null or original_amount > 0), -- ×100 بعملتها
  add column if not exists original_currency char(3) check (original_currency is null or original_currency ~ '^[A-Z]{3}$'),
  add column if not exists fx_rate           numeric(18, 8) check (fx_rate is null or fx_rate > 0),           -- ريال لكل وحدة
  add column if not exists fee_amount        bigint default 0 check (fee_amount is null or fee_amount >= 0);   -- بالهللة

alter table public.expenses drop constraint if exists expenses_card_fk;
alter table public.expenses add constraint expenses_card_fk
  foreign key (card_id, household_id) references public.cards(id, household_id) on delete set null (card_id);
create index if not exists expenses_card_idx on public.expenses (card_id) where card_id is not null;

-- أسعار الصرف اليومية (تجلبها دالة الخادم وتُخزَّن لتوفير الطلبات)
create table if not exists public.fx_rates (
  rate_date   date    not null,
  currency    char(3) not null,
  rate_to_sar numeric(18, 8) not null check (rate_to_sar > 0),
  source      text,
  fetched_at  timestamptz not null default now(),
  primary key (rate_date, currency)
);

alter table public.cards    enable row level security;
alter table public.fx_rates enable row level security;

create policy cards_select on public.cards for select to authenticated using (public.is_member(household_id));
-- الكتابة على البطاقات للمنشئ فقط (0011)، وهنا للأعضاء حتى يُطبَّق 0011
create policy cards_write on public.cards for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy fx_rates_select on public.fx_rates for select to authenticated using (true);

-- قبل الإدخال: الرسوم الدولية من نسبة البطاقة
create or replace function public.apply_card_fee()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bps int;
begin
  new.fee_amount := coalesce(new.fee_amount, 0);
  if new.original_currency is not null and new.original_currency <> 'SAR'
     and new.fee_amount = 0 and new.card_id is not null then
    select intl_fee_bps into v_bps from cards where id = new.card_id;
    if coalesce(v_bps, 0) > 0 then
      new.fee_amount := round(new.amount * v_bps / 10000.0);
      new.amount := new.amount + new.fee_amount;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists exp_10_card_fee on public.expenses;
create trigger exp_10_card_fee before insert on public.expenses
for each row execute function public.apply_card_fee();

-- تسجيل البطاقة من رسالة البنك (أو إعادتها إن كانت محفوظة)
create or replace function public.upsert_card_from_sms(
  p_user uuid, p_household uuid, p_bank text, p_last4 text, p_type text, p_network text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_last4 is null or p_last4 !~ '^[0-9]{4}$' then return null; end if;
  select id into v_id from cards
   where household_id = p_household and last4 = p_last4 and (bank = coalesce(p_bank, '') or bank = '' or coalesce(p_bank, '') = '')
   order by (bank = coalesce(p_bank, '')) desc limit 1;
  if v_id is not null then
    -- نكمل المعلومات الناقصة فقط، ولا نغيّر ما عدّله المستخدم
    update cards set
      bank = case when bank = '' then coalesce(p_bank, '') else bank end,
      card_type = case when card_type = 'other' and p_type in ('credit', 'debit', 'mada', 'prepaid') then p_type else card_type end,
      network = coalesce(network, case when p_network in ('visa', 'mastercard', 'mada', 'amex') then p_network end)
    where id = v_id;
    return v_id;
  end if;
  insert into cards (household_id, user_id, bank, last4, card_type, network)
  values (p_household, p_user, left(coalesce(p_bank, ''), 40), p_last4,
          case when p_type in ('credit', 'debit', 'mada', 'prepaid') then p_type else 'other' end,
          case when p_network in ('visa', 'mastercard', 'mada', 'amex') then p_network end)
  on conflict (household_id, bank, last4) do update set bank = excluded.bank
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.upsert_card_from_sms(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_card_from_sms(uuid, uuid, text, text, text, text) to service_role;

alter publication supabase_realtime add table public.cards;
