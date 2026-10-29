-- =====================================================================
--  0016 — إشعارات push والمهام اليومية
--  * كل إشعار جديد يوقظ دالة الخادم push فترسله لأجهزة صاحبه (آيفون/أندرويد/كمبيوتر).
--  * مهمة يومية الساعة 9 الصبح بتوقيت الرياض: التذكير اليومي، موعد الثابتة، التجديدات،
--    إقفال الرحلات الخاملة، وملخص الشهر في أول يوم منه.
--
--  قبل التنفيذ: فعّل pg_cron و pg_net من Database → Extensions (أو يفعّلها هذا الملف).
--  بعد التنفيذ نفّذ سطراً واحداً برابط مشروعك:
--    select vault.create_secret('https://xxxx.supabase.co', 'project_url');
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- سرّ داخلي بين قاعدة البيانات ودالة push (يُنشأ تلقائياً، لا يحتاج نسخ)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'cron_secret');
  end if;
end $$;

create or replace function public.verify_cron_secret(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = p);
$$;
revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- إيقاظ دالة push (لا يُفشل إضافة الإشعار أبداً)
create or replace function public.kick_push()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
exception when others then
  raise warning 'kick_push failed: %', sqlerrm;
end $$;

create or replace function public.notifications_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform kick_push();
  return null;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
for each statement execute function public.notifications_after_insert();

-- إعادة المحاولة لما لم يُرسل (مثلاً إن كانت الدالة نائمة)
create or replace function public.kick_push_if_pending()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from notifications where pushed_at is null
             and created_at > now() - interval '1 day' and created_at < now() - interval '2 minutes') then
    perform kick_push();
  end if;
end $$;

-- ---------- المصاريف الثابتة: اليوم موعدها ----------
create or replace function public.recurring_due_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_month date := date_trunc('month', v_today)::date;
  v_last  int := extract(day from (v_month + interval '1 month - 1 day'))::int;
  r record;
  n int := 0;
begin
  for r in
    select re.* from recurring_expenses re
     where re.is_active and re.start_month <= v_month
       and least(re.day_of_month, v_last) = extract(day from v_today)::int
       and not exists (select 1 from expenses e where e.recurring_id = re.id and e.recurring_period = v_month)
  loop
    perform notify(r.household_id, null, 'recurring_due', 'موعد مصروف ثابت',
      format('اليوم موعد %s (%s ر.س). سجّل الدفع من صفحة الثابتة.', r.name, fmt_sar(r.amount)),
      '{"url": "#/recurring"}', 'rec-' || r.id || '-' || to_char(v_month, 'YYYY-MM'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- ملخص الشهر (أول يوم من الشهر عن الشهر الماضي) ----------
create or replace function public.month_summaries()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  h record;
  v_total bigint; v_prev bigint; v_top text; v_count int;
  v_body text;
  n int := 0;
begin
  if extract(day from v_today) <> 1 then return 0; end if;
  for h in select * from households loop
    select coalesce(sum(amount), 0), count(*) into v_total, v_count from expenses
     where household_id = h.id and trip_id is null and expense_date >= v_month and expense_date < v_month + interval '1 month';
    continue when v_count = 0;
    select coalesce(sum(amount), 0) into v_prev from expenses
     where household_id = h.id and trip_id is null
       and expense_date >= v_month - interval '1 month' and expense_date < v_month;
    select c.name into v_top from expenses e join categories c on c.id = e.category_id
     where e.household_id = h.id and e.trip_id is null and e.expense_date >= v_month and e.expense_date < v_month + interval '1 month'
     group by c.name order by sum(e.amount) desc limit 1;

    v_body := format('صرفتوا %s ر.س في %s عملية، وأكثرها %s.', fmt_sar(v_total), v_count, v_top);
    if v_prev > 0 then
      v_body := v_body || format(' %s من الشهر اللي قبله بـ %s%%.',
        case when v_total > v_prev then 'أكثر' else 'أقل' end,
        round(abs(v_total - v_prev) * 100.0 / v_prev));
    end if;
    if h.monthly_budget is not null then
      v_body := v_body || case when v_total <= h.monthly_budget
        then format(' وفّرتوا %s ر.س من الميزانية 👏', fmt_sar(h.monthly_budget - v_total))
        else format(' تجاوزتوا الميزانية بـ %s ر.س.', fmt_sar(v_total - h.monthly_budget)) end;
    end if;
    perform notify(h.id, null, 'month_summary', 'ملخص الشهر', v_body, '{"url": "#/insights"}',
                   'month-' || to_char(v_month, 'YYYY-MM'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- التذكير اليومي الساعة 9 ----------
create or replace function public.daily_digest()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  h record;
  v_total bigint; v_count int;
  n int := 0;
begin
  for h in select * from households loop
    select coalesce(sum(amount), 0), count(*) into v_total, v_count
      from expenses where household_id = h.id and expense_date = v_today - 1;
    perform notify(h.id, null, 'daily', 'صباح الخير ☀️',
      case when v_count = 0 then 'ما انسجل شي أمس. إذا دفعتوا كاش، سجّلوه الحين.'
           else format('أمس: %s ر.س في %s عملية. لا تنسون المصاريف النقدية.', fmt_sar(v_total), v_count) end,
      '{"url": "#/"}', 'daily-' || v_today);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.daily_tasks()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform close_idle_trips();
  perform renewal_reminders();
  perform recurring_due_reminders();
  perform month_summaries();
  perform daily_digest();
  perform prune_notifications();
end $$;

revoke all on function public.kick_push() from public, anon, authenticated;
revoke all on function public.kick_push_if_pending() from public, anon, authenticated;
revoke all on function public.recurring_due_reminders() from public, anon, authenticated;
revoke all on function public.month_summaries() from public, anon, authenticated;
revoke all on function public.daily_digest() from public, anon, authenticated;
revoke all on function public.daily_tasks() from public, anon, authenticated;

-- الجدولة بتوقيت UTC: 06:00 UTC = 09:00 الرياض
select cron.unschedule(jobname) from cron.job where jobname in ('masareef-daily', 'masareef-push-retry');
select cron.schedule('masareef-daily', '0 6 * * *', 'select public.daily_tasks()');
select cron.schedule('masareef-push-retry', '*/10 * * * *', 'select public.kick_push_if_pending()');
