-- =====================================================================
--  0015 — قراءات
--  الأرقام تُحسب بدقة في التطبيق من العمليات نفسها، وClaude يكتب الملاحظات عليها فقط.
--  هنا: يوم الراتب (لتحليل «أول الشهر بعد الراتب»)، وحفظ ملاحظات Claude لكل شهر،
--  وحدّ يومي لطلبات Claude لكل عائلة.
-- =====================================================================

alter table public.households
  add column if not exists salary_day smallint not null default 27 check (salary_day between 1 and 31);
grant update (salary_day) on public.households to authenticated;

create table if not exists public.ai_insights (
  household_id uuid not null references public.households(id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  facts_hash   text not null,
  notes        jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (household_id, month)
);

create table if not exists public.ai_usage (
  household_id uuid not null references public.households(id) on delete cascade,
  day          date not null default (now() at time zone 'Asia/Riyadh')::date,
  action       text not null,
  count        int  not null default 0,
  primary key (household_id, day, action)
);

alter table public.ai_insights enable row level security;
alter table public.ai_usage    enable row level security;
create policy ai_insights_select on public.ai_insights for select to authenticated using (public.is_member(household_id));
create policy ai_usage_select    on public.ai_usage    for select to authenticated using (public.is_member(household_id));

-- يُستدعى من دالة ai قبل كل طلب: يرفض إذا تجاوزت العائلة الحد اليومي
create or replace function public.ai_take_quota(p_household uuid, p_action text, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into ai_usage (household_id, action, count) values (p_household, p_action, 1)
  on conflict (household_id, day, action) do update set count = ai_usage.count + 1
  returning count into v;
  return v <= p_limit;
end $$;
revoke all on function public.ai_take_quota(uuid, text, int) from public, anon, authenticated;
grant execute on function public.ai_take_quota(uuid, text, int) to service_role;
