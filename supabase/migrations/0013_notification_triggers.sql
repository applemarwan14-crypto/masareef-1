-- =====================================================================
--  0013 — متى نرسل الإشعارات
--  بعد إضافة أي عملية:
--   * من رسالة بنك → لصاحبها: «تم إضافة مبلغ 83.78 ر.س من نون إلى مصاريف».
--   * لبقية أفراد العائلة → مصروف جديد من فلان.
--   * الميزانية الشهرية عند 80% و100% (مرة واحدة لكل شهر)، وميزانية الرحلة كذلك.
--   * خصم مكرر محتمل: نفس المبلغ ونفس المتجر ونفس البطاقة خلال 30 دقيقة.
-- =====================================================================

-- 8378 → «83.78»، 5000 → «50»
create or replace function public.fmt_sar(h bigint)
returns text language sql immutable as $$
  select regexp_replace(to_char(h / 100.0, 'FM999,999,999,990.00'), '\.00$', '');
$$;

create or replace function public.expense_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today   date := (now() at time zone 'Asia/Riyadh')::date;
  v_who     text;
  v_cat     text;
  v_what    text;
  v_url     jsonb := jsonb_build_object('url', '#/expenses', 'expense_id', new.id);
  v_budget  bigint;
  v_spent   bigint;
  v_before  bigint;
  v_month   date := date_trunc('month', new.expense_date)::date;
  t         trips;
begin
  select display_name into v_who from household_members where user_id = new.created_by and household_id = new.household_id;
  select name into v_cat from categories where id = new.category_id;
  v_what := coalesce(new.merchant, new.description, v_cat);
  if new.trip_id is not null then select * into t from trips where id = new.trip_id; end if;

  -- 1) تأكيد رسالة البنك لصاحبها
  if new.source = 'sms' then
    perform notify(new.household_id, array[new.created_by], 'sms_added', 'مصاريف',
      format('تم إضافة مبلغ %s ر.س من %s إلى %s', fmt_sar(new.amount), coalesce(new.merchant, 'رسالة البنك'),
             case when t.id is not null then t.name else 'مصاريف' end),
      v_url, 'sms-' || new.id);
  end if;

  -- 2) بقية العائلة
  perform notify(new.household_id,
    array(select user_id from household_members where household_id = new.household_id and user_id <> new.created_by),
    'family_expense', 'مصروف جديد من ' || coalesce(v_who, 'العائلة'),
    format('%s ر.س · %s%s', fmt_sar(new.amount), v_what, case when t.id is not null then ' · ' || t.name else '' end),
    v_url, 'family-' || new.id);

  -- 3) خصم مكرر محتمل
  if new.source = 'sms' and new.merchant is not null and exists (
    select 1 from expenses e
     where e.household_id = new.household_id and e.id <> new.id and e.source = 'sms'
       and e.amount = new.amount
       and normalize_merchant(e.merchant) = normalize_merchant(new.merchant)
       and (e.card_id is not distinct from new.card_id)
       and e.created_at > now() - interval '30 minutes'
  ) then
    perform notify(new.household_id, array[new.created_by], 'duplicate', 'خصم مكرر؟',
      format('انخصم %s ر.س من %s مرتين خلال دقائق. تأكد من البنك، وإذا كانت مكررة احذف وحدة من التطبيق.',
             fmt_sar(new.amount), new.merchant),
      v_url, 'dup-' || new.id);
  end if;

  -- 4) الميزانية الشهرية (الشهر الحالي فقط، بدون الرحلات)
  if new.trip_id is null and v_month = date_trunc('month', v_today)::date then
    select monthly_budget into v_budget from households where id = new.household_id;
    if v_budget is not null then
      select coalesce(sum(amount), 0) into v_spent from expenses
       where household_id = new.household_id and trip_id is null
         and expense_date >= v_month and expense_date < (v_month + interval '1 month')::date;
      v_before := v_spent - new.amount;
      if v_before < v_budget and v_spent >= v_budget then
        perform notify(new.household_id, null, 'budget', 'وصلتوا الميزانية',
          format('صرفتوا %s ر.س من ميزانية %s ر.س لهذا الشهر.', fmt_sar(v_spent), fmt_sar(v_budget)),
          '{"url": "#/"}', 'budget100-' || to_char(v_month, 'YYYY-MM'));
      elsif v_before * 5 < v_budget * 4 and v_spent * 5 >= v_budget * 4 then
        perform notify(new.household_id, null, 'budget', '80% من الميزانية',
          format('صرفتوا %s ر.س، باقي %s ر.س لآخر الشهر.', fmt_sar(v_spent), fmt_sar(v_budget - v_spent)),
          '{"url": "#/"}', 'budget80-' || to_char(v_month, 'YYYY-MM'));
      end if;
    end if;
  end if;

  -- 5) ميزانية الرحلة
  if t.id is not null and t.budget is not null then
    select coalesce(sum(amount), 0) into v_spent from expenses where trip_id = t.id;
    v_before := v_spent - new.amount;
    if v_before < t.budget and v_spent >= t.budget then
      perform notify(new.household_id, null, 'trip', 'وصلتوا ميزانية الرحلة',
        format('«%s»: صرفتوا %s ر.س من %s ر.س.', t.name, fmt_sar(v_spent), fmt_sar(t.budget)),
        jsonb_build_object('url', '#/trips/' || t.id), 'tripbudget100-' || t.id);
    elsif v_before * 5 < t.budget * 4 and v_spent * 5 >= t.budget * 4 then
      perform notify(new.household_id, null, 'trip', '80% من ميزانية الرحلة',
        format('«%s»: باقي %s ر.س.', t.name, fmt_sar(t.budget - v_spent)),
        jsonb_build_object('url', '#/trips/' || t.id), 'tripbudget80-' || t.id);
    end if;
  end if;

  return null;
end $$;

drop trigger if exists exp_notify on public.expenses;
create trigger exp_notify after insert on public.expenses
for each row execute function public.expense_notifications();
