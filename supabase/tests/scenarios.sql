-- سيناريوهات اختبار على PostgreSQL محلي (تُشغَّل عبر run.sh)
\set ON_ERROR_STOP 1
\set u1 '11111111-1111-1111-1111-111111111111'
\set u2 '22222222-2222-2222-2222-222222222222'

select vault.create_secret('http://localhost:54321', 'project_url');
insert into auth.users values (:'u1', 'owner@test'), (:'u2', 'member@test');

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, false);
$$;

-- ---------- العائلة ----------
select pg_temp.as_user(:'u1');
set role authenticated;
select create_household('بيتنا', 'مروان') as hid \gset
reset role;
select invite_code from households where id = :'hid' \gset
select pg_temp.as_user(:'u2');
set role authenticated;
select join_household(:'invite_code', 'سارة');
reset role;

do $$ begin
  assert (select count(*) from categories where is_pinned) = 9, 'default categories pinned';
  assert (select count(*) from sms_tokens) = 2, 'sms tokens created';
end $$;

-- ---------- رسالة بنك: إضافة + إشعار بالصيغة المطلوبة ----------
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h1', 'شراء من نون بمبلغ 83.78 ريال', 'claude', '{"kind":"purchase"}',
  '{"amount": 8378, "merchant": "نون", "category_name": "التسوق والمشتريات", "payment_method": "online",
    "country": "SA", "bank": "الراجحي", "expense_date": "2000-01-01", "household_id": "00000000-0000-0000-0000-000000000000"}') as r1 \gset
reset role;
\echo :r1
do $$
declare e expenses;
begin
  select * into e from expenses where source_hash = 'h1';
  assert e.amount = 8378 and e.source = 'sms' and e.merchant = 'نون', 'sms expense inserted';
  assert e.expense_date = (now() at time zone 'Asia/Riyadh')::date, 'bad date replaced by today';
  assert e.household_id = (select id from households limit 1), 'household from server, not input';
  assert (select body from notifications where kind = 'sms_added') = 'تم إضافة مبلغ 83.78 ر.س من نون إلى مصاريف', 'sms_added text';
  assert (select count(*) from notifications where kind = 'family_expense') = 1, 'family notified';
  assert (select user_id from notifications where kind = 'family_expense') = '22222222-2222-2222-2222-222222222222', 'only the other member';
  assert (select count(*) from sms_messages where status = 'added') = 1, 'sms logged';
  assert (select count(*) from net.calls) >= 1, 'push kicked';
end $$;

-- نفس الرسالة مرة ثانية
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h1', 'x', 'claude', '{}', '{"amount": 8378}')->>'status' as dup \gset
reset role;
do $$ begin assert current_setting('my.dummy', true) is null; end $$;
\echo dup = :dup

-- ---------- التعلّم من تغيير التصنيف ----------
select id as grocery from categories where name = 'البقالة والسوبرماركت' \gset
select pg_temp.as_user(:'u1');
set role authenticated;
update expenses set category_id = :'grocery' where source_hash = 'h1';
reset role;
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h2', 'x', 'local', '{}',
  '{"amount": 1500, "merchant": "نون*88123", "category_name": "التسوق والمشتريات"}');
reset role;
do $$ begin
  assert (select count(*) from merchant_rules) = 1, 'rule learned';
  assert (select c.name from expenses e join categories c on c.id = e.category_id where source_hash = 'h2')
         = 'البقالة والسوبرماركت', 'rule applied to next sms (branch digits ignored)';
end $$;

-- ---------- البطاقة والعملة والرحلة ----------
set role service_role;
select upsert_card_from_sms(:'u1', :'hid', 'الراجحي', '4321', 'credit', 'visa') as card \gset
reset role;
update cards set intl_fee_bps = 275 where id = :'card';
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h3', 'x', 'claude', '{}',
  json_build_object('amount', 37500, 'merchant', 'Starbucks Istanbul', 'country', 'TR', 'payment_method', 'pos',
                    'original_amount', 10000, 'original_currency', 'USD', 'fx_rate', 3.75, 'card_id', :'card')::jsonb);
-- شراء إلكتروني من الخارج أثناء الرحلة يدخل الرحلة
select ingest_sms_expense(:'u1', :'hid', 'h4', 'x', 'claude', '{}',
  '{"amount": 2000, "merchant": "Booking", "country": "NL", "payment_method": "online"}');
reset role;
do $$
declare e expenses; t trips;
begin
  select * into e from expenses where source_hash = 'h3';
  assert e.fee_amount = 1031 and e.amount = 38531, format('fee applied: %s %s', e.fee_amount, e.amount);
  select * into t from trips;
  assert t.status = 'open' and t.name = 'رحلة تركيا', 'trip opened';
  assert e.trip_id = t.id, 'expense in trip';
  assert (select trip_id from expenses where source_hash = 'h4') = t.id, 'online foreign during trip joins trip';
  assert t.countries = array['TR', 'NL'], 'countries tracked';
  assert (select body from notifications where kind = 'sms_added' order by created_at desc limit 1) like '%إلى رحلة تركيا', 'sms text mentions trip';
  assert not exists (select 1 from monthly_category_totals where total = 38531), 'trip excluded from monthly totals';
end $$;

-- شراء حضوري محلي يقفل الرحلة
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h5', 'x', 'claude', '{}', '{"amount": 1000, "merchant": "بنده", "country": "SA", "payment_method": "pos"}');
-- شراء إلكتروني من الخارج بدون رحلة لا يفتح رحلة
select ingest_sms_expense(:'u1', :'hid', 'h6', 'x', 'claude', '{}', '{"amount": 5500, "merchant": "Netflix", "country": "US", "payment_method": "online"}');
reset role;
do $$ begin
  assert (select status from trips) = 'closed', 'trip closed by local purchase';
  assert (select count(*) from trips) = 1, 'online foreign purchase did not open a trip';
  assert (select trip_id from expenses where source_hash = 'h6') is null, 'netflix stays monthly';
end $$;

-- ---------- الميزانية 80% و100% ----------
select pg_temp.as_user(:'u1');
set role authenticated;
update households set monthly_budget = 100000 where id = :'hid';
reset role;
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h7', 'x', 'local', '{}', '{"amount": 70000, "merchant": "ايكيا"}');
select ingest_sms_expense(:'u1', :'hid', 'h8', 'x', 'local', '{}', '{"amount": 20000, "merchant": "اكسترا"}');
select ingest_sms_expense(:'u1', :'hid', 'h9', 'x', 'local', '{}', '{"amount": 10, "merchant": "بقالة"}');
reset role;
do $$ begin
  assert (select count(*) from notifications where kind = 'budget' and dedupe_key like 'budget80-%') = 2, '80% once per member';
  assert (select count(*) from notifications where kind = 'budget' and dedupe_key like 'budget100-%') = 2, '100% once per member';
end $$;

-- ---------- خصم مكرر ----------
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h10', 'x', 'claude', '{}', '{"amount": 4500, "merchant": "Jahez"}');
select ingest_sms_expense(:'u1', :'hid', 'h11', 'y', 'claude', '{}', '{"amount": 4500, "merchant": "JAHEZ"}');
reset role;
do $$ begin assert (select count(*) from notifications where kind = 'duplicate') = 1, 'duplicate detected'; end $$;

-- ---------- إيقاف نوع إشعار ----------
insert into notification_prefs (user_id, disabled) values (:'u2', array['family_expense']);
set role service_role;
select ingest_sms_expense(:'u1', :'hid', 'h12', 'x', 'claude', '{}', '{"amount": 100, "merchant": "Test"}');
reset role;
do $$ begin
  assert not exists (select 1 from notifications n join expenses e on n.data->>'expense_id' = e.id::text
                     where e.source_hash = 'h12' and n.kind = 'family_expense'), 'disabled kind respected';
end $$;

-- ---------- الصلاحيات ----------
select pg_temp.as_user(:'u2');
set role authenticated;
do $$
declare n int;
begin
  update expenses set amount = 1 where source_hash = 'h1';
  get diagnostics n = row_count;
  assert n = 0, 'member cannot edit owner expense';
  begin
    insert into categories (household_id, name) values ((select household_id from household_members limit 1), 'جديد');
    assert false, 'member inserted category';
  exception when insufficient_privilege then null;
  end;
  update households set monthly_budget = 1;
  get diagnostics n = row_count;
  assert n = 0, 'member cannot change budget';
  assert (select count(*) from sms_messages) = 0, 'member does not see owner sms';
end $$;
insert into expenses (household_id, category_id, amount) values (:'hid', :'grocery', 1234);
update expenses set amount = 4321 where amount = 1234;
reset role;
do $$ begin assert exists (select 1 from expenses where amount = 4321), 'member edits own expense'; end $$;
select pg_temp.as_user(:'u1');
set role authenticated;
update expenses set amount = 4322 where amount = 4321;
reset role;
do $$ begin assert exists (select 1 from expenses where amount = 4322), 'owner edits member expense'; end $$;

-- ---------- تنظيم التصنيفات والتراجع ----------
select id as other from categories where name = 'مصاريف أخرى' \gset
select id as shopping from categories where name = 'التسوق والمشتريات' \gset
select pg_temp.as_user(:'u1');
set role authenticated;
insert into categories (household_id, name, icon, color) values (:'hid', 'تسوق', 'bag', '#7C3AED') returning id as dupcat \gset
insert into expenses (household_id, category_id, amount, merchant) values (:'hid', :'dupcat', 900, 'زارا') returning id as zara \gset
insert into expenses (household_id, category_id, amount, merchant) values (:'hid', :'other', 3000, 'صيدلية النهدي') returning id as pharm \gset
create temp table before_cats as select id, name, icon, color, sort_order, is_archived from categories;
create temp table before_exp as select id, category_id from expenses;
create temp table before_rules as select * from merchant_rules;
select apply_category_plan(json_build_object(
  'summary', 'test',
  'creates', json_build_array(json_build_object('key', 'n1', 'name', 'الصحة', 'icon', 'health', 'color', '#16A34A')),
  'renames', json_build_array(json_build_object('id', :'grocery', 'name', 'اسم جديد')),
  'merges',  json_build_array(json_build_object('from', :'dupcat', 'to', :'shopping'),
                              json_build_object('from', :'other', 'to', :'shopping')),
  'moves',   json_build_array(json_build_object('expense_id', :'pharm', 'to', 'n1')),
  'order',   json_build_array('n1', :'shopping')
)::jsonb) as snap \gset
reset role;
do $$ begin
  assert (select name from categories where name = 'البقالة والسوبرماركت') is not null, 'pinned not renamed';
  assert (select is_archived from categories where name = 'تسوق'), 'merged category archived';
  assert not (select is_archived from categories where name = 'مصاريف أخرى'), 'pinned not merged';
  assert (select c.name from expenses e join categories c on c.id = e.category_id where e.merchant = 'زارا') = 'التسوق والمشتريات', 'merge moved expenses';
  assert (select c.name from expenses e join categories c on c.id = e.category_id where e.merchant = 'صيدلية النهدي') = 'الصحة', 'move to new category';
  assert (select sort_order from categories where name = 'الصحة') = 1, 'order applied';
end $$;
select pg_temp.as_user(:'u1');
set role authenticated;
select undo_category_plan(:'snap');
reset role;
do $$ begin
  assert not exists (select 1 from categories where name = 'الصحة'), 'created category removed';
  assert not exists (select id, name, icon, color, sort_order, is_archived from before_cats
                     except select id, name, icon, color, sort_order, is_archived from categories), 'categories restored';
  assert not exists (select * from before_exp except select id, category_id from expenses), 'expense categories restored';
  assert (select count(*) from merchant_rules) = (select count(*) from before_rules), 'rules restored';
end $$;

-- المثبّت لا يُحذف
select pg_temp.as_user(:'u1');
set role authenticated;
do $$ begin
  begin
    delete from categories where name = 'راتب السائق';
    assert false, 'pinned deleted';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- ---------- التجديدات والضمان ----------
set role service_role;
select sms_add_renewal(:'u1', :'hid', 'r1', 'تم تجديد رخصة القيادة', 'claude', '{}',
  json_build_object('kind', 'license', 'title', 'رخصة القيادة', 'due_date', (current_date + 20)::text, 'person', 'مروان')::jsonb)->>'status' as ren \gset
select sms_add_renewal(:'u1', :'hid', 'r1b', 'نفس الرسالة', 'claude', '{}',
  json_build_object('kind', 'license', 'title', 'رخصة القيادة', 'due_date', (current_date + 20)::text)::jsonb)->>'status' as ren2 \gset
select ingest_sms_expense(:'u1', :'hid', 'h13', 'x', 'claude', '{}', '{"amount": 450000, "merchant": "Apple Store"}')->>'expense_id' as iphone \gset
select add_warranty(:'iphone');
reset role;
\echo renewal: :ren / :ren2
do $$ begin
  assert (select remind_days from renewals where kind = 'license') = 30, 'documents remind 30 days';
  assert (select count(*) from renewals where kind = 'license') = 1, 'renewal dedupe';
  assert (select due_date from renewals where kind = 'warranty') = (now() at time zone 'Asia/Riyadh')::date + interval '2 years', 'warranty 2y';
  assert (select status from sms_messages where hash = 'r1') = 'renewal', 'renewal sms logged';
end $$;

-- ---------- المهمة اليومية ----------
insert into recurring_expenses (household_id, category_id, name, amount, day_of_month, created_by)
values (:'hid', :'grocery', 'راتب العاملة', 150000, extract(day from (now() at time zone 'Asia/Riyadh'))::int, :'u1');
insert into trips (household_id, name, started_on, last_foreign_on) values (:'hid', 'رحلة قديمة', current_date - 10, current_date - 5);
select daily_tasks();
select daily_tasks(); -- مرة ثانية لا تكرر
do $$ begin
  assert (select count(*) from notifications where kind = 'renewal') = 2, 'renewal reminder for both members';
  assert (select count(*) from notifications where kind = 'recurring_due') = 2, 'recurring due';
  assert (select count(*) from notifications where kind = 'daily') = 2, 'daily once';
  assert (select status from trips where name = 'رحلة قديمة') = 'closed', 'idle trip closed';
  assert (select count(*) from cron.job) = 2, 'cron jobs scheduled';
  assert verify_cron_secret((select secret from vault.secrets where name = 'cron_secret')), 'cron secret';
end $$;

-- ---------- الأرشفة ----------
insert into expenses (household_id, category_id, amount, expense_date, created_by)
values (:'hid', :'grocery', 5000, make_date(extract(year from current_date)::int - 1, 3, 10), :'u1'),
       (:'hid', :'grocery', 7000, make_date(extract(year from current_date)::int - 1, 3, 20), :'u1');
select sum(total) as before_total from monthly_category_totals where month < date_trunc('year', current_date) \gset
select pg_temp.as_user(:'u1');
set role authenticated;
select archive_year(extract(year from current_date)::int - 1);
select year, total from year_overview();
reset role;
do $$ begin
  assert not exists (select 1 from expenses where expense_date < date_trunc('year', current_date)), 'old expenses deleted';
  assert (select total from archived_years) = 12000, 'year summary kept';
end $$;
select sum(total) as after_total from monthly_category_totals where month < date_trunc('year', current_date) \gset
\echo totals before/after archive: :before_total / :after_total

-- ---------- التنظيف ----------
select pg_temp.as_user(:'u1');
set role authenticated;
select remove_member(:'u2');
reset role;
do $$ begin assert (select count(*) from household_members) = 1, 'member removed'; end $$;

\echo ✅ all scenarios passed
