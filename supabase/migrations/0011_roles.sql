-- =====================================================================
--  0011 — الإدارة للمنشئ
--  المنشئ وحده يدير: التصنيفات، الميزانية وإعدادات العائلة، البطاقات، الأعضاء.
--  الباقي يضيفون مصاريفهم ويعدّلونها ويحذفونها (والمنشئ يعدّل الكل).
-- =====================================================================

-- التصنيفات
drop policy if exists categories_all on public.categories;
create policy categories_select on public.categories for select to authenticated using (public.is_member(household_id));
create policy categories_insert on public.categories for insert to authenticated with check (public.is_owner(household_id));
create policy categories_update on public.categories for update to authenticated
  using (public.is_owner(household_id)) with check (public.is_owner(household_id));
create policy categories_delete on public.categories for delete to authenticated using (public.is_owner(household_id));

-- العائلة (الاسم، الميزانية)
drop policy if exists households_update on public.households;
create policy households_update on public.households for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

-- البطاقات
drop policy if exists cards_write on public.cards;
create policy cards_insert on public.cards for insert to authenticated with check (public.is_owner(household_id));
create policy cards_update on public.cards for update to authenticated
  using (public.is_owner(household_id)) with check (public.is_owner(household_id));
create policy cards_delete on public.cards for delete to authenticated using (public.is_owner(household_id));

-- قواعد المتاجر: الحذف للمنشئ
drop policy if exists merchant_rules_delete on public.merchant_rules;
create policy merchant_rules_delete on public.merchant_rules for delete to authenticated using (public.is_owner(household_id));

-- العمليات: كل شخص يعدّل ويحذف ما أضافه، والمنشئ يعدّل الكل
drop policy if exists expenses_update on public.expenses;
drop policy if exists expenses_delete on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (public.is_member(household_id) and (created_by = (select auth.uid()) or public.is_owner(household_id)))
  with check (public.is_member(household_id));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_member(household_id) and (created_by = (select auth.uid()) or public.is_owner(household_id)));

-- الأعضاء: المنشئ يزيل عضواً (غير نفسه)
create or replace function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_household uuid := (select household_id from household_members where user_id = auth.uid() and role = 'owner');
begin
  if v_household is null then raise exception 'only the owner can do this'; end if;
  if p_user = auth.uid() then raise exception 'owner cannot remove themselves'; end if;
  delete from push_subscriptions where user_id = p_user;
  delete from household_members where household_id = v_household and user_id = p_user;
  if not found then raise exception 'member not found'; end if;
  delete from sms_tokens where user_id = p_user;
end $$;

-- نقل الإدارة لعضو آخر
create or replace function public.transfer_ownership(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_household uuid := (select household_id from household_members where user_id = auth.uid() and role = 'owner');
begin
  if v_household is null then raise exception 'only the owner can do this'; end if;
  if not exists (select 1 from household_members where household_id = v_household and user_id = p_user) then
    raise exception 'member not found';
  end if;
  update household_members set role = 'member' where household_id = v_household and user_id = auth.uid();
  update household_members set role = 'owner'  where household_id = v_household and user_id = p_user;
end $$;

revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.transfer_ownership(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.transfer_ownership(uuid) to authenticated;

-- تحديث لحظي لقائمة الأعضاء (الإضافة/الإزالة/الأدوار)
alter publication supabase_realtime add table public.household_members;
