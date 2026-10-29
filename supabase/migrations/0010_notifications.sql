-- =====================================================================
--  0010 — الإشعارات من التطبيق نفسه
--  * صندوق إشعارات لكل شخص داخل التطبيق + إشعارات push على الجوال (0016).
--  * كل الأنواع مفعّلة افتراضياً، وكل شخص يوقف ما لا يريده من الإعدادات.
-- =====================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade, -- المستلم
  kind         text not null check (kind in (
                 'sms_added', 'family_expense', 'budget', 'recurring_due', 'month_summary',
                 'sms_failed', 'trip', 'renewal', 'duplicate', 'daily', 'test')),
  title        text not null check (char_length(title) <= 80),
  body         text not null check (char_length(body) <= 300),
  data         jsonb not null default '{}', -- url وأي معرّفات للفتح من الإشعار
  dedupe_key   text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  pushed_at    timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

create table if not exists public.notification_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  disabled   text[] not null default '{}', -- الأنواع الموقوفة؛ الفارغ = الكل مفعّل
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy prefs_all on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_all on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- الدالة الوحيدة التي تُنشئ الإشعارات. p_users = null تعني كل أعضاء العائلة.
create or replace function public.notify(
  p_household uuid, p_users uuid[], p_kind text, p_title text, p_body text,
  p_data jsonb default '{}', p_dedupe text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into notifications (household_id, user_id, kind, title, body, data, dedupe_key)
  select p_household, m.user_id, p_kind, left(p_title, 80), left(p_body, 300), coalesce(p_data, '{}'), p_dedupe
    from household_members m
    left join notification_prefs p on p.user_id = m.user_id
   where m.household_id = p_household
     and (p_users is null or m.user_id = any(p_users))
     and (p_kind = 'test' or not (p_kind = any(coalesce(p.disabled, '{}'))))
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.notify(uuid, uuid[], text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, uuid[], text, text, text, jsonb, text) to service_role;

-- إشعار تجريبي من الإعدادات
create or replace function public.send_test_notification()
returns void language plpgsql security definer set search_path = public as $$
declare v_household uuid := (select household_id from household_members where user_id = auth.uid());
begin
  if v_household is null then raise exception 'not in a household'; end if;
  perform notify(v_household, array[auth.uid()], 'test', 'مصاريف', 'الإشعارات تعمل 👌', '{"url": "#/notifications"}');
end $$;

create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.send_test_notification() from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.send_test_notification() to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- تنظيف: الإشعارات أقدم من 90 يوماً (يُستدعى من المهمة اليومية في 0016)
create or replace function public.prune_notifications()
returns void language sql security definer set search_path = public as $$
  delete from notifications where created_at < now() - interval '90 days';
$$;

alter publication supabase_realtime add table public.notifications;
