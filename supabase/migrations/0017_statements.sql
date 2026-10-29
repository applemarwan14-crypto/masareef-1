-- =====================================================================
--  0017 — كشوفات البنك (قسم منفصل تماماً)
--  كل كشف يُرفع يُحفظ باسم ملفه مع عملياته في جداول خاصة به،
--  ولا يدخل في المصاريف ولا الميزانية ولا الإحصائيات ولا الإشعارات.
-- =====================================================================

create table if not exists public.statement_imports (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 120), -- اسم الملف
  bank         text check (bank is null or char_length(bank) <= 40),
  period_from  date,
  period_to    date,
  notes        text check (notes is null or char_length(notes) <= 300),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.statement_rows (
  id           uuid primary key default gen_random_uuid(),
  import_id    uuid not null references public.statement_imports(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  txn_date     date not null,
  direction    text not null default 'debit' check (direction in ('debit', 'credit')),
  amount       bigint not null check (amount > 0),  -- بالهللة
  kind         text,                                -- شراء، سداد، حوالة، سحب، إيداع…
  description  text not null check (char_length(description) <= 300),
  merchant     text check (merchant is null or char_length(merchant) <= 80),
  category_id  uuid references public.categories(id) on delete set null,
  matched_expense_id uuid references public.expenses(id) on delete set null, -- نفس العملية مسجلة من رسالة البنك
  sort_order   int not null default 0
);
create index if not exists statement_rows_import_idx on public.statement_rows (import_id, txn_date desc, sort_order);

alter table public.statement_imports enable row level security;
alter table public.statement_rows    enable row level security;

create policy statement_imports_select on public.statement_imports for select to authenticated using (public.is_member(household_id));
create policy statement_imports_delete on public.statement_imports for delete to authenticated using (public.is_owner(household_id));
create policy statement_rows_select    on public.statement_rows    for select to authenticated using (public.is_member(household_id));
create policy statement_rows_update    on public.statement_rows    for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke update on public.statement_rows from authenticated;
grant update (category_id) on public.statement_rows to authenticated;
