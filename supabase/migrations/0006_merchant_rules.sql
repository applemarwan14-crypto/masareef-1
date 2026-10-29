-- =====================================================================
--  0006 — التصنيف يتعلّم من تعديلاتك
--  إذا غيّرت تصنيف عملية لها متجر، يُحفظ «هذا المتجر → هذا التصنيف»
--  وتُصنَّف رسائل البنك القادمة من نفس المتجر عليه تلقائياً.
-- =====================================================================

create table if not exists public.merchant_rules (
  household_id   uuid not null references public.households(id) on delete cascade,
  merchant_key   text not null,
  merchant_label text not null,
  category_id    uuid not null,
  hits           int  not null default 0,
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (household_id, merchant_key),
  foreign key (category_id, household_id) references public.categories(id, household_id) on delete cascade
);

alter table public.merchant_rules enable row level security;
create policy merchant_rules_select on public.merchant_rules for select to authenticated
  using (public.is_member(household_id));
create policy merchant_rules_delete on public.merchant_rules for delete to authenticated
  using (public.is_member(household_id));

-- قبل إدخال عملية من رسالة البنك: إن كان للمتجر قاعدة نطبّقها
create or replace function public.apply_merchant_rule()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat uuid;
begin
  if new.source <> 'sms' or new.merchant is null then return new; end if;
  update merchant_rules mr set hits = hits + 1
    from categories c
   where mr.household_id = new.household_id
     and mr.merchant_key = normalize_merchant(new.merchant)
     and c.id = mr.category_id and not c.is_archived
  returning mr.category_id into v_cat;
  if v_cat is not null then new.category_id := v_cat; end if;
  return new;
end $$;

drop trigger if exists exp_20_merchant_rule on public.expenses;
create trigger exp_20_merchant_rule before insert on public.expenses
for each row execute function public.apply_merchant_rule();

-- بعد تغيير التصنيف يدوياً: نحفظ القاعدة
create or replace function public.learn_merchant_rule()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_key text := normalize_merchant(new.merchant);
begin
  if v_key is null or new.category_id = old.category_id then return new; end if;
  insert into merchant_rules (household_id, merchant_key, merchant_label, category_id, updated_by)
  values (new.household_id, v_key, new.merchant, new.category_id, auth.uid())
  on conflict (household_id, merchant_key) do update
     set category_id = excluded.category_id, merchant_label = excluded.merchant_label,
         updated_by = excluded.updated_by, updated_at = now();
  return new;
end $$;

drop trigger if exists exp_learn_merchant on public.expenses;
create trigger exp_learn_merchant after update of category_id on public.expenses
for each row execute function public.learn_merchant_rule();

-- «طبّقه على العمليات السابقة»: نقل كل عمليات المتجر إلى تصنيف القاعدة
create or replace function public.apply_rule_to_past(p_merchant text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_key text := normalize_merchant(p_merchant);
  v_household uuid := (select household_id from household_members where user_id = auth.uid());
  v_cat uuid;
  v_count int;
begin
  select category_id into v_cat from merchant_rules where household_id = v_household and merchant_key = v_key;
  if v_cat is null then raise exception 'no rule for this merchant'; end if;
  update expenses set category_id = v_cat
   where household_id = v_household and normalize_merchant(merchant) = v_key and category_id <> v_cat;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.apply_rule_to_past(text) from public, anon;
grant execute on function public.apply_rule_to_past(text) to authenticated;
