-- =====================================================================
--  0009 — السنوات والأرشفة
--  * أرشفة سنة قديمة: يُحفظ ملخص كل شهر لكل تصنيف، ثم تُحذف عمليات تلك السنة.
--    (الواجهة تنزّل ملف Excel كامل للسنة قبل الأرشفة.)
--  * عرض الإجماليات الشهرية يجمع العمليات الحالية مع الملخصات المؤرشفة،
--    فتبقى المقارنة السنوية صحيحة بعد الأرشفة.
-- =====================================================================

create table if not exists public.archived_totals (
  household_id uuid not null references public.households(id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  category_id  uuid not null,
  total        bigint not null,
  tx_count     int not null,
  primary key (household_id, month, category_id),
  foreign key (category_id, household_id) references public.categories(id, household_id) on delete restrict
);

create table if not exists public.archived_years (
  household_id uuid not null references public.households(id) on delete cascade,
  year         int  not null,
  tx_count     int  not null,
  total        bigint not null,
  archived_by  uuid references auth.users(id) on delete set null,
  archived_at  timestamptz not null default now(),
  primary key (household_id, year)
);

alter table public.archived_totals enable row level security;
alter table public.archived_years  enable row level security;
create policy archived_totals_select on public.archived_totals for select to authenticated using (public.is_member(household_id));
create policy archived_years_select  on public.archived_years  for select to authenticated using (public.is_member(household_id));

-- الإجماليات الشهرية = العمليات + المؤرشف (تُعدَّل في 0012 لاستبعاد الرحلات)
create or replace view public.monthly_category_totals
with (security_invoker = true) as
select household_id, date_trunc('month', expense_date)::date as month, category_id,
       sum(amount)::bigint as total, count(*)::int as tx_count
  from public.expenses
 group by 1, 2, 3
union all
select household_id, month, category_id, total, tx_count from public.archived_totals;

-- ملخص كل سنة (للمقارنة وصفحة السنوات)
create or replace function public.year_overview()
returns table (year int, total bigint, tx_count int, months int, archived boolean)
language sql stable security invoker set search_path = public as $$
  with h as (select household_id from household_members where user_id = auth.uid()),
  m as (
    select t.month, sum(t.total) total, sum(t.tx_count) cnt
      from monthly_category_totals t, h where t.household_id = h.household_id group by t.month
  )
  , y as (
    select extract(year from m.month)::int yr, sum(m.total)::bigint total, sum(m.cnt)::int cnt, count(*)::int months
      from m group by 1
  )
  select y.yr, y.total, y.cnt, y.months,
         exists (select 1 from archived_years a, h where a.household_id = h.household_id and a.year = y.yr)
    from y order by 1 desc;
$$;

-- أرشفة سنة: للمنشئ فقط، ولسنة منتهية فقط. يعيد مسارات الفواتير لتحذفها الواجهة من التخزين.
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

  select count(*), coalesce(sum(amount), 0), array_remove(array_agg(receipt_path), null)
    into v_count, v_total, v_paths
    from expenses where household_id = v_household and expense_date >= v_from and expense_date < v_to;
  if v_count = 0 then raise exception 'nothing to archive'; end if;

  insert into archived_totals (household_id, month, category_id, total, tx_count)
  select household_id, date_trunc('month', expense_date)::date, category_id, sum(amount), count(*)
    from expenses where household_id = v_household and expense_date >= v_from and expense_date < v_to
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
  delete from expenses where household_id = v_household and expense_date >= v_from and expense_date < v_to;
  return coalesce(v_paths, '{}');
end $$;

revoke all on function public.year_overview() from public, anon;
revoke all on function public.archive_year(int) from public, anon;
grant execute on function public.year_overview() to authenticated;
grant execute on function public.archive_year(int) to authenticated;
