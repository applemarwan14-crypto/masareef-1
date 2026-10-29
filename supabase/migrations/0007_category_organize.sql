-- =====================================================================
--  0007 — تنظيم التصنيفات بضغطة، مع تراجع كامل
--  * التصنيفات الأساسية مثبّتة: لا تُحذف ولا تُؤرشف ولا تُدمج.
--  * قبل أي تنظيم تُحفظ نسخة كاملة (التصنيفات، تصنيف كل عملية نُقلت، القواعد)
--    ويستطيع المنشئ التراجع عن آخر تنظيم فيعود كل شيء كما كان.
-- =====================================================================

alter table public.categories add column if not exists is_pinned boolean not null default false;

update public.categories set is_pinned = true
 where name in ('البقالة والسوبرماركت', 'المطاعم والمقاهي', 'تطبيقات التوصيل', 'الفواتير والاشتراكات',
                'التسوق والمشتريات', 'مصاريف السيارة', 'راتب العاملة المنزلية', 'راتب السائق', 'مصاريف أخرى');

-- التصنيفات الافتراضية للعائلات الجديدة مثبّتة
create or replace function public.create_household(p_name text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from household_members where user_id = v_uid) then
    raise exception 'already in a household';
  end if;

  insert into households (name) values (coalesce(nullif(trim(p_name), ''), 'عائلتي')) returning id into v_id;
  insert into household_members (household_id, user_id, display_name, role)
    values (v_id, v_uid, trim(p_display_name), 'owner');

  insert into categories (household_id, name, icon, color, sort_order, is_pinned) values
    (v_id, 'البقالة والسوبرماركت', 'cart',     '#0E6B58', 1, true),
    (v_id, 'المطاعم والمقاهي',     'food',     '#C2410C', 2, true),
    (v_id, 'تطبيقات التوصيل',      'bike',     '#DB2777', 3, true),
    (v_id, 'الفواتير والاشتراكات', 'receipt',  '#2563EB', 4, true),
    (v_id, 'التسوق والمشتريات',    'bag',      '#7C3AED', 5, true),
    (v_id, 'مصاريف السيارة',       'car',      '#475569', 6, true),
    (v_id, 'راتب العاملة المنزلية','broom',    '#B45309', 7, true),
    (v_id, 'راتب السائق',          'steering', '#0891B2', 8, true),
    (v_id, 'مصاريف أخرى',          'circle',   '#64748B', 9, true);

  return v_id;
end $$;

-- حماية المثبّتة
create or replace function public.protect_pinned_category()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- حذف العائلة كاملة مسموح
    if old.is_pinned and exists (select 1 from public.households where id = old.household_id) then
      raise exception 'pinned category cannot be deleted';
    end if;
    return old;
  end if;
  new.is_pinned := old.is_pinned;
  if old.is_pinned and new.is_archived then raise exception 'pinned category cannot be archived'; end if;
  return new;
end $$;
drop trigger if exists categories_protect on public.categories;
create trigger categories_protect before update or delete on public.categories
for each row execute function public.protect_pinned_category();

-- ---------- نسخ التنظيم ----------
create table if not exists public.category_snapshots (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  summary      text,
  categories   jsonb not null,               -- كل صفوف التصنيفات قبل التنظيم
  rules        jsonb not null default '[]',  -- كل قواعد المتاجر قبل التنظيم
  moves        jsonb not null default '[]',  -- [{e: expense_id, c: old_category_id}]
  recurring    jsonb not null default '[]',  -- [{r: recurring_id, c: old_category_id}]
  created_ids  uuid[] not null default '{}',
  stats        jsonb,
  created_at   timestamptz not null default now(),
  undone_at    timestamptz
);
create index if not exists category_snapshots_household_idx on public.category_snapshots (household_id, created_at desc);

alter table public.category_snapshots enable row level security;
create policy category_snapshots_select on public.category_snapshots for select to authenticated
  using (public.is_member(household_id));

create or replace function public.is_owner(h uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members where household_id = h and user_id = (select auth.uid()) and role = 'owner');
$$;

/*
  تطبيق خطة تنظيم (يقترحها Claude ويراجعها المستخدم):
  {
    "summary": "…",
    "creates": [{"key": "n1", "name": "…", "icon": "…", "color": "#…"}],
    "renames": [{"id": "<uuid>", "name": "…"}],
    "merges":  [{"from": "<uuid>", "to": "<uuid | key>"}],
    "moves":   [{"expense_id": "<uuid>", "to": "<uuid | key>"}],
    "order":   ["<uuid | key>", …]
  }
*/
create or replace function public.apply_category_plan(p_plan jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_household uuid := (select household_id from household_members where user_id = auth.uid());
  v_snap uuid;
  v_map jsonb := '{}';
  v_new uuid;
  v_from uuid;
  v_to uuid;
  v_moves jsonb := '[]';
  v_rec jsonb := '[]';
  v_created uuid[] := '{}';
  x jsonb;
  i int := 0;
  n_renamed int := 0; n_merged int := 0; n_moved int := 0;
begin
  if v_household is null or not is_owner(v_household) then raise exception 'only the owner can do this'; end if;

  insert into category_snapshots (household_id, created_by, summary, categories, rules)
  values (
    v_household, auth.uid(), left(p_plan->>'summary', 500),
    coalesce((select jsonb_agg(to_jsonb(c)) from categories c where c.household_id = v_household), '[]'),
    coalesce((select jsonb_agg(to_jsonb(m)) from merchant_rules m where m.household_id = v_household), '[]')
  ) returning id into v_snap;

  -- تصنيفات جديدة
  for x in select * from jsonb_array_elements(coalesce(p_plan->'creates', '[]')) loop
    continue when coalesce(trim(x->>'name'), '') = '';
    select id into v_new from categories where household_id = v_household and name = trim(x->>'name');
    if v_new is null then
      insert into categories (household_id, name, icon, color, sort_order)
      values (v_household, left(trim(x->>'name'), 40), coalesce(x->>'icon', 'circle'),
              case when x->>'color' ~ '^#[0-9A-Fa-f]{6}$' then x->>'color' else '#64748B' end, 999)
      returning id into v_new;
      v_created := v_created || v_new;
    end if;
    v_map := v_map || jsonb_build_object(x->>'key', v_new);
    v_new := null;
  end loop;

  -- إعادة تسمية (غير المثبّتة فقط، وبدون تكرار اسم)
  for x in select * from jsonb_array_elements(coalesce(p_plan->'renames', '[]')) loop
    update categories set name = left(trim(x->>'name'), 40)
     where id = (x->>'id')::uuid and household_id = v_household and not is_pinned
       and coalesce(trim(x->>'name'), '') <> ''
       and not exists (select 1 from categories where household_id = v_household and name = trim(x->>'name'));
    if found then n_renamed := n_renamed + 1; end if;
  end loop;

  -- دمج: نقل كل شيء من تصنيف إلى آخر ثم أرشفة القديم
  for x in select * from jsonb_array_elements(coalesce(p_plan->'merges', '[]')) loop
    v_from := (x->>'from')::uuid;
    v_to := coalesce((v_map->>(x->>'to'))::uuid, case when x->>'to' ~ '^[0-9a-f-]{36}$' then (x->>'to')::uuid end);
    continue when v_from = v_to or v_to is null
      or not exists (select 1 from categories where id = v_from and household_id = v_household and not is_pinned)
      or not exists (select 1 from categories where id = v_to and household_id = v_household);

    select v_moves || coalesce(jsonb_agg(jsonb_build_object('e', id, 'c', category_id)), '[]') into v_moves
      from expenses where household_id = v_household and category_id = v_from;
    select v_rec || coalesce(jsonb_agg(jsonb_build_object('r', id, 'c', category_id)), '[]') into v_rec
      from recurring_expenses where household_id = v_household and category_id = v_from;
    update expenses set category_id = v_to where household_id = v_household and category_id = v_from;
    update recurring_expenses set category_id = v_to where household_id = v_household and category_id = v_from;
    update merchant_rules set category_id = v_to where household_id = v_household and category_id = v_from;
    update categories set is_archived = true where id = v_from;
    n_merged := n_merged + 1;
  end loop;

  -- نقل عمليات محددة
  for x in select * from jsonb_array_elements(coalesce(p_plan->'moves', '[]')) loop
    v_to := coalesce((v_map->>(x->>'to'))::uuid, case when x->>'to' ~ '^[0-9a-f-]{36}$' then (x->>'to')::uuid end);
    continue when v_to is null or not exists (select 1 from categories where id = v_to and household_id = v_household);
    v_from := null;
    select category_id into v_from from expenses
     where id = (x->>'expense_id')::uuid and household_id = v_household and category_id <> v_to;
    continue when v_from is null;
    v_moves := v_moves || jsonb_build_array(jsonb_build_object('e', x->>'expense_id', 'c', v_from));
    update expenses set category_id = v_to where id = (x->>'expense_id')::uuid;
    n_moved := n_moved + 1;
  end loop;

  -- الترتيب
  for x in select * from jsonb_array_elements(coalesce(p_plan->'order', '[]')) loop
    i := i + 1;
    v_to := coalesce((v_map->>(x#>>'{}'))::uuid, case when x#>>'{}' ~ '^[0-9a-f-]{36}$' then (x#>>'{}')::uuid end);
    update categories set sort_order = i where id = v_to and household_id = v_household;
  end loop;
  if i > 0 then
    update categories c set sort_order = i + s.rn
      from (select id, row_number() over (order by sort_order, name) rn from categories
             where household_id = v_household and sort_order >= 999) s
     where c.id = s.id;
  end if;

  update category_snapshots
     set moves = v_moves, recurring = v_rec, created_ids = v_created,
         stats = jsonb_build_object('created', cardinality(v_created), 'renamed', n_renamed,
                                    'merged', n_merged, 'moved', n_moved)
   where id = v_snap;
  return v_snap;
end $$;

-- التراجع عن آخر تنظيم: كل شيء يعود كما كان قبله
create or replace function public.undo_category_plan(p_snapshot uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s category_snapshots;
  c jsonb;
begin
  select * into s from category_snapshots where id = p_snapshot;
  if s.id is null or not is_owner(s.household_id) then raise exception 'only the owner can do this'; end if;
  if s.undone_at is not null then raise exception 'already undone'; end if;
  if exists (select 1 from category_snapshots where household_id = s.household_id
             and created_at > s.created_at and undone_at is null) then
    raise exception 'undo the newer organization first';
  end if;

  -- 1) التصنيفات المحذوفة بعد التنظيم تُعاد، والموجودة ترجع لحالتها
  for c in select * from jsonb_array_elements(s.categories) loop
    insert into categories (id, household_id, name, icon, color, sort_order, is_archived, is_pinned, created_at)
    values ((c->>'id')::uuid, s.household_id, left(c->>'id', 8) || '…', c->>'icon', c->>'color',
            (c->>'sort_order')::int, (c->>'is_archived')::boolean, (c->>'is_pinned')::boolean, (c->>'created_at')::timestamptz)
    on conflict (id) do nothing;
  end loop;
  -- أسماء مؤقتة لتفادي تعارض الأسماء أثناء الإرجاع
  update categories set name = left(id::text, 8) || '…'
   where household_id = s.household_id and id in (select (e->>'id')::uuid from jsonb_array_elements(s.categories) e);
  update categories cat
     set name = j.v->>'name', icon = j.v->>'icon', color = j.v->>'color',
         sort_order = (j.v->>'sort_order')::int, is_archived = (j.v->>'is_archived')::boolean
    from jsonb_array_elements(s.categories) j(v)
   where cat.id = (j.v->>'id')::uuid and cat.household_id = s.household_id;

  -- 2) العمليات والثابتة لتصنيفاتها الأصلية
  update expenses e set category_id = (m->>'c')::uuid
    from jsonb_array_elements(s.moves) m
   where e.id = (m->>'e')::uuid and e.household_id = s.household_id;
  update recurring_expenses r set category_id = (m->>'c')::uuid
    from jsonb_array_elements(s.recurring) m
   where r.id = (m->>'r')::uuid and r.household_id = s.household_id;

  -- 3) القواعد كما كانت (التراجع نفسه يولّد قواعد عبر محفز التعلّم، فنستبدلها كلها)
  delete from merchant_rules where household_id = s.household_id;
  insert into merchant_rules (household_id, merchant_key, merchant_label, category_id, hits, updated_by, updated_at)
  select s.household_id, r->>'merchant_key', r->>'merchant_label', (r->>'category_id')::uuid,
         (r->>'hits')::int, (r->>'updated_by')::uuid, (r->>'updated_at')::timestamptz
    from jsonb_array_elements(s.rules) r
   where exists (select 1 from categories where id = (r->>'category_id')::uuid);

  -- 4) التصنيفات التي أنشأها التنظيم: تُحذف إن لم يعد عليها شيء، وإلا تُؤرشف
  update categories set is_archived = true
   where id = any(s.created_ids)
     and (exists (select 1 from expenses where category_id = categories.id)
          or exists (select 1 from recurring_expenses where category_id = categories.id));
  delete from categories
   where id = any(s.created_ids)
     and not exists (select 1 from expenses where category_id = categories.id)
     and not exists (select 1 from recurring_expenses where category_id = categories.id);

  update category_snapshots set undone_at = now() where id = s.id;
end $$;

revoke all on function public.apply_category_plan(jsonb) from public, anon;
revoke all on function public.undo_category_plan(uuid) from public, anon;
grant execute on function public.apply_category_plan(jsonb) to authenticated;
grant execute on function public.undo_category_plan(uuid) to authenticated;
