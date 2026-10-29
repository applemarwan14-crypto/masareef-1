-- =====================================================================
--  0014 — التجديدات والضمانات والتأمين
--  * تأمين، استمارة، رخصة، جواز، إقامة، هوية، اشتراكات، إيجار، ضمان.
--  * تُضاف من رسائل البنك وأبشر تلقائياً، أو بكتابة عادية (ويفهم الهجري)، أو يدوياً.
--  * شراء جهاز بـ 300 ر.س أو أكثر يسجّل له ضمان سنتين.
--  * تنبيه قبل الموعد بأيام (7 افتراضياً)، والمستندات الرسمية قبل شهر.
-- =====================================================================

create table if not exists public.renewals (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  kind          text not null check (kind in ('insurance', 'istimara', 'license', 'passport', 'iqama', 'national_id',
                                              'subscription', 'rent', 'warranty', 'other')),
  title         text not null check (char_length(trim(title)) between 1 and 80),
  due_date      date not null,
  amount        bigint check (amount is null or amount > 0),
  remind_days   int  not null check (remind_days between 0 and 120),
  person        text check (person is null or char_length(person) <= 40),
  notes         text check (notes is null or char_length(notes) <= 300),
  source        text not null default 'manual' check (source in ('manual', 'sms', 'auto', 'text')),
  expense_id    uuid references public.expenses(id) on delete set null,
  status        text not null default 'active' check (status in ('active', 'done', 'dismissed')),
  notified_stage smallint not null default 0, -- 0 لا شيء، 1 تنبيه البداية، 2 قبل يوم
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists renewals_due_idx on public.renewals (household_id, due_date) where status = 'active';
-- نفس التجديد لا يتكرر إذا وصلت الرسالة مرتين
create unique index if not exists renewals_unique on public.renewals (household_id, kind, lower(title), due_date);

create trigger renewals_lock before update on public.renewals
for each row execute function public.lock_household_id();

alter table public.renewals enable row level security;
create policy renewals_all on public.renewals for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- أيام التنبيه الافتراضية: المستندات الرسمية شهر، والباقي أسبوع
create or replace function public.default_remind_days(p_kind text)
returns int language sql immutable as $$
  select case when p_kind in ('passport', 'iqama', 'national_id', 'license', 'istimara') then 30
              when p_kind = 'warranty' then 14 else 7 end;
$$;

create or replace function public.renewal_defaults()
returns trigger language plpgsql as $$
begin
  if new.remind_days is null then new.remind_days := default_remind_days(new.kind); end if;
  if tg_op = 'UPDATE' and new.due_date <> old.due_date then new.notified_stage := 0; end if;
  return new;
end $$;
drop trigger if exists renewals_defaults on public.renewals;
create trigger renewals_defaults before insert or update on public.renewals
for each row execute function public.renewal_defaults();

-- ضمان سنتين لجهاز (من رسالة البنك أو من زر «جهاز» في شاشة الإضافة)
create or replace function public.add_warranty(p_expense uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e expenses;
  v_id uuid;
begin
  select * into e from expenses where id = p_expense;
  if e.id is null then raise exception 'expense not found'; end if;
  if auth.uid() is not null and not is_member(e.household_id) then raise exception 'not allowed'; end if;
  if e.amount < 30000 then raise exception 'warranty is for purchases of 300 SAR or more'; end if;
  insert into renewals (household_id, kind, title, due_date, amount, source, expense_id, created_by)
  values (e.household_id, 'warranty', left('ضمان ' || coalesce(e.merchant, e.description, 'جهاز'), 80),
          (e.expense_date + interval '2 years')::date, e.amount, 'auto', e.id, e.created_by)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

-- تجديد من رسالة (أبشر أو البنك). يسجّل الرسالة في السجل إن لم تكن عملية شراء.
create or replace function public.sms_add_renewal(
  p_user uuid, p_household uuid, p_hash text, p_body text, p_parser text, p_parsed jsonb,
  p_renewal jsonb, p_expense uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := coalesce(nullif(p_renewal->>'kind', ''), 'other');
  v_due  date;
  v_id   uuid;
  v_title text := left(coalesce(nullif(trim(p_renewal->>'title'), ''), 'تجديد'), 80);
begin
  begin
    v_due := (p_renewal->>'due_date')::date;
  exception when others then v_due := null;
  end;
  if v_due is null or v_due < (now() at time zone 'Asia/Riyadh')::date - 1 then
    return jsonb_build_object('status', 'ignored', 'reason', 'no future due date');
  end if;
  if v_kind not in ('insurance', 'istimara', 'license', 'passport', 'iqama', 'national_id', 'subscription', 'rent', 'warranty', 'other') then
    v_kind := 'other';
  end if;

  insert into renewals (household_id, kind, title, due_date, amount, person, source, expense_id, created_by)
  values (p_household, v_kind, v_title, v_due,
          nullif((p_renewal->>'amount')::bigint, 0), left(nullif(p_renewal->>'person', ''), 40), 'sms', p_expense, p_user)
  on conflict (household_id, kind, lower(title), due_date) do nothing
  returning id into v_id;

  if p_expense is null then
    perform log_sms(p_user, p_household, p_hash, p_body, 'renewal', v_title, p_parser, p_parsed);
  end if;
  return jsonb_build_object('status', case when v_id is null then 'duplicate' else 'added' end,
                            'renewal_id', v_id, 'title', v_title, 'due_date', v_due);
end $$;

revoke all on function public.add_warranty(uuid) from public, anon;
grant execute on function public.add_warranty(uuid) to authenticated, service_role;
revoke all on function public.sms_add_renewal(uuid, uuid, text, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.sms_add_renewal(uuid, uuid, text, text, text, jsonb, jsonb, uuid) to service_role;

-- تنبيهات التجديدات (من المهمة اليومية): عند بداية فترة التنبيه، ثم قبل الموعد بيوم
create or replace function public.renewal_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare
  r renewals;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_left int;
  n int := 0;
begin
  for r in select * from renewals where status = 'active' and due_date >= v_today
            and ((notified_stage = 0 and due_date - remind_days <= v_today)
              or (notified_stage < 2 and due_date - 1 <= v_today)) loop
    v_left := r.due_date - v_today;
    perform notify(r.household_id, null, 'renewal',
      case when r.kind = 'warranty' then 'الضمان قرب ينتهي' else 'موعد تجديد' end,
      format('%s%s %s', r.title, coalesce(' (' || r.person || ')', ''),
             case v_left when 0 then 'اليوم' when 1 then 'بكرة' when 2 then 'بعد يومين'
                         else format('بعد %s يوم', v_left) end),
      jsonb_build_object('url', '#/renewals', 'renewal_id', r.id),
      'renewal-' || r.id || '-' || case when v_left <= 1 then 2 else 1 end);
    update renewals set notified_stage = case when v_left <= 1 then 2 else 1 end where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.renewal_reminders() from public, anon, authenticated;

alter publication supabase_realtime add table public.renewals;
