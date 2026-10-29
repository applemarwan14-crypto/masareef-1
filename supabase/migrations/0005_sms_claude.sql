-- =====================================================================
--  0005 — قراءة رسائل البنك بـ Claude
--  * أعمدة جديدة للعملية: المتجر المنظّف، المصدر، طريقة الدفع، البنك، الدولة، من قرأها.
--  * سجل لكل رسالة وصلت (أضيفت / تُجوهلت / فشلت) مع نص الرسالة بعد إخفاء الرصيد.
--  * دالة الإدخال التي تستدعيها دالة الخادم sms (Edge Function) بعد القراءة.
--  ملاحظة: نفّذ الملفات من 0005 إلى 0016 بالترتيب في SQL Editor.
-- =====================================================================

alter table public.expenses
  add column if not exists merchant       text check (merchant is null or char_length(merchant) <= 80),
  add column if not exists source         text not null default 'manual' check (source in ('manual', 'sms', 'recurring')),
  add column if not exists payment_method text check (payment_method is null or payment_method in
                                            ('mada', 'apple_pay', 'pos', 'online', 'atm', 'sadad', 'transfer', 'other')),
  add column if not exists bank           text check (bank is null or char_length(bank) <= 40),
  add column if not exists country        char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  add column if not exists parser         text check (parser is null or parser in ('claude', 'local'));

-- العمليات القديمة: المصدر والمتجر من الوصف السابق «📩 المتجر»
update public.expenses set source = 'recurring' where recurring_id is not null and source = 'manual';
update public.expenses
   set source = 'sms',
       merchant = nullif(trim(regexp_replace(description, '^📩\s*', '')), 'رسالة البنك'),
       description = null,
       parser = 'local'
 where source_hash is not null and source = 'manual';

-- الدفعات الثابتة الجديدة تُعلَّم تلقائياً
create or replace function public.mark_recurring_source()
returns trigger language plpgsql as $$
begin
  if new.recurring_id is not null then new.source := 'recurring'; end if;
  return new;
end $$;
drop trigger if exists exp_05_recurring_source on public.expenses;
create trigger exp_05_recurring_source before insert on public.expenses
for each row execute function public.mark_recurring_source();

-- مفتاح موحّد لاسم المتجر: «NOON.COM*8812 RIYADH» و«noon.com» → «noon com riyadh» / «noon com»
create or replace function public.normalize_merchant(p text)
returns text language sql immutable as $$
  select nullif(left(trim(regexp_replace(regexp_replace(regexp_replace(
           lower(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩أإآىة', '0123456789اااىه')),
           '[0-9]{3,}', ' ', 'g'),          -- أرقام الفروع والطلبات
           '[^[:alnum:]؀-ۿ]+', ' ', 'g'),
           '\s+', ' ', 'g')), 60), '');
$$;

create index if not exists expenses_merchant_idx
  on public.expenses (household_id, public.normalize_merchant(merchant)) where merchant is not null;
create index if not exists expenses_source_idx on public.expenses (household_id, created_at desc) where source = 'sms';

-- ---------- سجل الرسائل ----------
create table if not exists public.sms_messages (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  hash         text not null unique,
  body         text not null check (char_length(body) <= 2000), -- بعد إخفاء الرصيد
  status       text not null check (status in ('added', 'ignored', 'failed', 'renewal')),
  reason       text,
  parser       text check (parser is null or parser in ('claude', 'local')),
  parsed       jsonb,
  expense_id   uuid references public.expenses(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists sms_messages_user_idx on public.sms_messages (user_id, created_at desc);

alter table public.sms_messages enable row level security;
-- كل شخص يرى رسائله فقط
create policy sms_messages_select on public.sms_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy sms_messages_delete on public.sms_messages for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- دوال الخادم (لا تُستدعى إلا بمفتاح الخدمة من دالة sms) ----------

-- تسجيل رسالة لم تتحول لعملية. يعيد false إذا كانت الرسالة مسجلة مسبقاً.
create or replace function public.log_sms(
  p_user uuid, p_household uuid, p_hash text, p_body text,
  p_status text, p_reason text, p_parser text, p_parsed jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into sms_messages (household_id, user_id, hash, body, status, reason, parser, parsed)
  values (p_household, p_user, p_hash, left(p_body, 2000), p_status, left(p_reason, 200), p_parser, p_parsed)
  on conflict (hash) do nothing;
  return found;
end $$;

-- إدخال عملية من رسالة بنك.
-- p_expense: حقول العملية كما قرأها Claude أو القارئ المحلي (amount بالهللة، expense_date، merchant،
--            payment_method، bank، country، card_id، original_amount، original_currency، fx_rate، category_name).
-- الحقول الحساسة (العائلة، من أضاف، المعرّف…) تُحدَّد هنا ولا تؤخذ من المدخلات.
create or replace function public.ingest_sms_expense(
  p_user uuid, p_household uuid, p_hash text, p_body text, p_parser text, p_parsed jsonb, p_expense jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today  date := (now() at time zone 'Asia/Riyadh')::date;
  v_date   date;
  v_cat    uuid;
  v_name   text;
  r        public.expenses;
  v_id     uuid;
begin
  if not exists (select 1 from household_members where user_id = p_user and household_id = p_household) then
    raise exception 'user is not in this household';
  end if;
  if exists (select 1 from sms_messages where hash = p_hash) or exists (select 1 from expenses where source_hash = p_hash) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  -- التاريخ: من الرسالة إن كان معقولاً، وإلا اليوم
  begin
    v_date := (p_expense->>'expense_date')::date;
  exception when others then v_date := null;
  end;
  if v_date is null or v_date > v_today or v_date < v_today - 60 then v_date := v_today; end if;

  -- التصنيف: الاسم المقترح إن كان موجوداً ونشطاً، وإلا «مصاريف أخرى»، وإلا آخر تصنيف نشط
  select id, name into v_cat, v_name from categories
   where household_id = p_household and not is_archived and name = p_expense->>'category_name';
  if v_cat is null then
    select id, name into v_cat, v_name from categories
     where household_id = p_household and not is_archived
     order by (name = 'مصاريف أخرى') desc, sort_order desc limit 1;
  end if;
  if v_cat is null then raise exception 'no categories'; end if;

  -- الحقول المسموح بها من المدخلات فقط
  r := jsonb_populate_record(r, p_expense - array[
         'id', 'household_id', 'created_by', 'created_at', 'updated_at', 'source', 'source_hash',
         'recurring_id', 'recurring_period', 'receipt_path', 'category_id', 'trip_id', 'category_name', 'parser']);
  r.id           := gen_random_uuid();
  r.household_id := p_household;
  r.created_by   := p_user;
  r.category_id  := v_cat;
  r.expense_date := v_date;
  r.source       := 'sms';
  r.source_hash  := p_hash;
  r.parser       := p_parser;
  r.created_at   := now();
  r.updated_at   := now();
  r.merchant     := nullif(left(trim(r.merchant), 80), '');
  r.description  := nullif(left(trim(r.description), 200), '');
  if r.amount is null or r.amount <= 0 then raise exception 'invalid amount'; end if;

  insert into expenses select (r).* on conflict (source_hash) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('status', 'duplicate'); end if;

  insert into sms_messages (household_id, user_id, hash, body, status, parser, parsed, expense_id)
  values (p_household, p_user, p_hash, left(p_body, 2000), 'added', p_parser, p_parsed, v_id)
  on conflict (hash) do nothing;

  -- نقرأ العملية بعد المحفزات (قاعدة المتجر، الرسوم، الرحلة…)
  select e.amount, c.name into r.amount, v_name
    from expenses e join categories c on c.id = e.category_id where e.id = v_id;
  return jsonb_build_object('status', 'added', 'expense_id', v_id, 'amount', r.amount,
                            'category', v_name, 'merchant', r.merchant);
end $$;

revoke all on function public.log_sms(uuid, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_sms_expense(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.log_sms(uuid, uuid, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.ingest_sms_expense(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;

-- ---------- رمز الاختصار من صفحة الإعدادات ----------
create or replace function public.my_sms_token()
returns text language sql stable security definer set search_path = public as $$
  select token from sms_tokens where user_id = auth.uid();
$$;

create or replace function public.regenerate_sms_token()
returns text language plpgsql security definer set search_path = public as $$
declare v text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  update sms_tokens set token = v where user_id = auth.uid();
  if not found then raise exception 'not in a household'; end if;
  return v;
end $$;

revoke all on function public.my_sms_token() from public, anon;
revoke all on function public.regenerate_sms_token() from public, anon;
grant execute on function public.my_sms_token() to authenticated;
grant execute on function public.regenerate_sms_token() to authenticated;

-- القارئ القديم داخل قاعدة البيانات (يبقى احتياطياً إن لم تُنشر دالة sms): يملأ الأعمدة الجديدة
create or replace function public.sms_mark_legacy()
returns trigger language plpgsql as $$
begin
  if new.source_hash is not null and new.source = 'manual' then
    new.source := 'sms';
    new.parser := 'local';
    if new.description like '📩%' then
      new.merchant := nullif(trim(regexp_replace(new.description, '^📩\s*', '')), 'رسالة البنك');
      new.description := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists exp_06_sms_legacy on public.expenses;
create trigger exp_06_sms_legacy before insert on public.expenses
for each row execute function public.sms_mark_legacy();

alter publication supabase_realtime add table public.sms_messages;
