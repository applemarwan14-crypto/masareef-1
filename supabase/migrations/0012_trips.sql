-- =====================================================================
--  0012 — الرحلات
--  * أول شراء حضوري من محل خارج السعودية يفتح رحلة تلقائياً.
--  * أول شراء حضوري داخل السعودية، أو 3 أيام بدون مشتريات من برا، يقفلها (الثاني في المهمة اليومية 0016).
--  * مصاريف الرحلة منفصلة عن مصروف الشهر وميزانيته، ولها صفحة وميزانية خاصة.
--  الشراء الإلكتروني من متجر أجنبي (أمازون، نتفلكس…) لا يفتح رحلة.
-- =====================================================================

create table if not exists public.trips (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 60),
  countries       text[] not null default '{}',
  started_on      date not null,
  last_foreign_on date,
  ended_on        date,
  status          text not null default 'open' check (status in ('open', 'closed')),
  budget          bigint check (budget is null or budget > 0),
  auto            boolean not null default true,
  closed_reason   text,
  archived_total  bigint, -- إجمالي الرحلة بعد أرشفة سنتها
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (id, household_id)
);
-- رحلة مفتوحة واحدة فقط لكل عائلة
create unique index if not exists trips_one_open on public.trips (household_id) where status = 'open';

create trigger trips_lock before update on public.trips
for each row execute function public.lock_household_id();

alter table public.expenses add column if not exists trip_id uuid;
alter table public.expenses drop constraint if exists expenses_trip_fk;
alter table public.expenses add constraint expenses_trip_fk
  foreign key (trip_id, household_id) references public.trips(id, household_id) on delete set null (trip_id);
create index if not exists expenses_trip_idx on public.expenses (trip_id) where trip_id is not null;

alter table public.trips enable row level security;
create policy trips_all on public.trips for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- أسماء الدول بالعربي (للأشهر، والباقي يظهر برمزه)
create or replace function public.country_name_ar(p char(2))
returns text language sql immutable as $$
  select coalesce('{
    "SA": "السعودية", "AE": "الإمارات", "BH": "البحرين", "KW": "الكويت", "QA": "قطر", "OM": "عُمان", "EG": "مصر", "JO": "الأردن",
    "LB": "لبنان", "MA": "المغرب", "TN": "تونس", "TR": "تركيا", "GB": "بريطانيا", "US": "أمريكا", "FR": "فرنسا", "DE": "ألمانيا",
    "IT": "إيطاليا", "ES": "إسبانيا", "CH": "سويسرا", "AT": "النمسا", "NL": "هولندا", "BE": "بلجيكا", "GR": "اليونان", "PT": "البرتغال",
    "CZ": "التشيك", "SE": "السويد", "NO": "النرويج", "DK": "الدنمارك", "FI": "فنلندا", "GE": "جورجيا", "AZ": "أذربيجان", "BA": "البوسنة",
    "MY": "ماليزيا", "ID": "إندونيسيا", "TH": "تايلاند", "MV": "المالديف", "SG": "سنغافورة", "JP": "اليابان", "CN": "الصين", "KR": "كوريا",
    "IN": "الهند", "PK": "باكستان", "LK": "سريلانكا", "PH": "الفلبين", "CA": "كندا", "AU": "أستراليا", "ZA": "جنوب أفريقيا", "KE": "كينيا",
    "TZ": "تنزانيا", "SC": "سيشل", "MU": "موريشيوس", "RU": "روسيا", "UZ": "أوزبكستان", "KZ": "كازاخستان", "AL": "ألبانيا", "HU": "المجر",
    "PL": "بولندا", "IE": "أيرلندا", "MX": "المكسيك", "BR": "البرازيل"
  }'::jsonb->>p, p);
$$;

-- قبل الإدخال: ربط العملية بالرحلة أو فتح/إقفال رحلة
create or replace function public.assign_trip()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t trips;
  v_in_person boolean := coalesce(new.payment_method, '') <> 'online';
begin
  if new.trip_id is not null then
    update trips set last_foreign_on = greatest(coalesce(last_foreign_on, new.expense_date), new.expense_date)
     where id = new.trip_id and new.country is not null and new.country <> 'SA';
    return new;
  end if;
  if new.country is null then return new; end if;

  select * into t from trips where household_id = new.household_id and status = 'open';

  if new.country <> 'SA' then
    if t.id is null then
      if not v_in_person then return new; end if; -- شراء إلكتروني من الخارج: مصروف عادي
      insert into trips (household_id, name, countries, started_on, last_foreign_on, created_by)
      values (new.household_id, 'رحلة ' || country_name_ar(new.country), array[new.country::text],
              new.expense_date, new.expense_date, new.created_by)
      returning * into t;
      perform notify(new.household_id, null, 'trip', 'بدأت رحلة ✈️',
        format('أول شراء من %s، فتحنا «%s». مصاريفها منفصلة عن مصروف الشهر.', country_name_ar(new.country), t.name),
        jsonb_build_object('url', '#/trips/' || t.id), 'trip-open-' || t.id);
    else
      update trips set
        countries = case when new.country = any(countries) then countries else countries || new.country::text end,
        last_foreign_on = greatest(coalesce(last_foreign_on, new.expense_date), new.expense_date)
      where id = t.id;
    end if;
    new.trip_id := t.id;
  elsif t.id is not null and t.auto and v_in_person and new.expense_date >= t.started_on then
    -- أول شراء حضوري داخل السعودية: نهاية الرحلة
    update trips set status = 'closed', ended_on = coalesce(last_foreign_on, started_on), closed_reason = 'local_purchase'
     where id = t.id;
    perform notify(new.household_id, null, 'trip', 'حمدالله على السلامة',
      format('قفلنا «%s» بعد أول شراء داخل السعودية.', t.name),
      jsonb_build_object('url', '#/trips/' || t.id), 'trip-close-' || t.id);
  end if;
  return new;
end $$;

drop trigger if exists exp_30_trip on public.expenses;
create trigger exp_30_trip before insert on public.expenses
for each row execute function public.assign_trip();

-- إقفال الرحلات التي مرّ عليها 3 أيام بدون مشتريات من الخارج (من المهمة اليومية)
create or replace function public.close_idle_trips()
returns int language plpgsql security definer set search_path = public as $$
declare
  t trips;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  n int := 0;
begin
  for t in select * from trips
            where status = 'open' and auto and coalesce(last_foreign_on, started_on) <= v_today - 3 loop
    update trips set status = 'closed', ended_on = coalesce(last_foreign_on, started_on), closed_reason = 'idle'
     where id = t.id;
    perform notify(t.household_id, null, 'trip', 'قفلنا الرحلة',
      format('«%s» انتهت: 3 أيام بدون مشتريات من الخارج.', t.name),
      jsonb_build_object('url', '#/trips/' || t.id), 'trip-close-' || t.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- إعادة فتح رحلة أُقفلت بالغلط
create or replace function public.reopen_trip(p_trip uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update trips set status = 'closed', closed_reason = 'replaced'
   where household_id = (select household_id from trips where id = p_trip) and status = 'open' and id <> p_trip;
  update trips set status = 'open', ended_on = null, closed_reason = null, auto = false where id = p_trip;
  if not found then raise exception 'trip not found'; end if;
end $$;

revoke all on function public.close_idle_trips() from public, anon, authenticated;
revoke all on function public.reopen_trip(uuid) from public, anon;
grant execute on function public.reopen_trip(uuid) to authenticated;

-- الإجماليات الشهرية بدون مصاريف الرحلات
create or replace view public.monthly_category_totals
with (security_invoker = true) as
select household_id, date_trunc('month', expense_date)::date as month, category_id,
       sum(amount)::bigint as total, count(*)::int as tx_count
  from public.expenses
 where trip_id is null
 group by 1, 2, 3
union all
select household_id, month, category_id, total, tx_count from public.archived_totals;

-- عند الأرشفة: مصاريف الرحلات لا تدخل ملخص الأشهر
create or replace function public.archive_year(p_year int)
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_household uuid := (select household_id from household_members where user_id = auth.uid() and role = 'owner');
  v_from date := make_date(p_year, 1, 1);
  v_to   date := make_date(p_year + 1, 1, 1);
  v_paths text[];
  v_count int;
  v_total bigint;
begin
  if v_household is null then raise exception 'only the owner can do this'; end if;
  if p_year >= extract(year from (now() at time zone 'Asia/Riyadh'))::int then
    raise exception 'only finished years can be archived';
  end if;

  select count(*), coalesce(sum(amount) filter (where trip_id is null), 0), array_remove(array_agg(receipt_path), null)
    into v_count, v_total, v_paths
    from expenses where household_id = v_household and expense_date >= v_from and expense_date < v_to;
  if v_count = 0 then raise exception 'nothing to archive'; end if;

  insert into archived_totals (household_id, month, category_id, total, tx_count)
  select household_id, date_trunc('month', expense_date)::date, category_id, sum(amount), count(*)
    from expenses where household_id = v_household and expense_date >= v_from and expense_date < v_to and trip_id is null
   group by 1, 2, 3
  on conflict (household_id, month, category_id)
     do update set total = archived_totals.total + excluded.total, tx_count = archived_totals.tx_count + excluded.tx_count;

  insert into archived_years (household_id, year, tx_count, total, archived_by)
  values (v_household, p_year, v_count, v_total, auth.uid())
  on conflict (household_id, year)
     do update set tx_count = archived_years.tx_count + excluded.tx_count,
                   total = archived_years.total + excluded.total, archived_at = now();

  delete from sms_messages where household_id = v_household and expense_id in
    (select id from expenses where household_id = v_household and expense_date >= v_from and expense_date < v_to);
  -- الرحلات تحتفظ بإجماليها
  update trips t set archived_total = coalesce(t.archived_total, 0) + s.total
    from (select trip_id, sum(amount) total from expenses
           where household_id = v_household and expense_date >= v_from and expense_date < v_to and trip_id is not null
           group by trip_id) s
   where t.id = s.trip_id;
  delete from expenses where household_id = v_household and expense_date >= v_from and expense_date < v_to;
  return coalesce(v_paths, '{}');
end $$;

alter publication supabase_realtime add table public.trips;
