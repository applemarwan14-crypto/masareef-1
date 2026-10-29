import { AnimatePresence, motion } from 'motion/react';
import { AirplaneTilt, ChatCircleText, Paperclip, Repeat } from '@phosphor-icons/react';
import { useMemberName } from '../hooks/household';
import { formatDayLabel } from '../lib/dates';
import { flag } from '../lib/labels';
import { formatAmount, formatSAR } from '../lib/money';
import { groupByDay } from '../lib/stats';
import type { Category, Expense } from '../lib/types';
import { useExpenseSheet } from './Layout';
import { CategoryIcon } from './ui';

/** عنوان العملية: المتجر، ثم الوصف، ثم التصنيف */
export const expenseTitle = (e: Expense, category?: Category) =>
  e.merchant || e.description?.replace(/^📩\s*/, '') || category?.name || 'مصروف';

export function ExpenseRow({ expense, category, tripName }: { expense: Expense; category?: Category; tripName?: string }) {
  const openSheet = useExpenseSheet();
  const memberName = useMemberName();
  const hasTitle = Boolean(expense.merchant || expense.description);
  return (
    <button type="button" onClick={() => openSheet(expense)}
      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-start transition hover:bg-surface-2 active:bg-surface-2">
      <CategoryIcon category={category} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{expenseTitle(expense, category)}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {hasTitle && <span className="truncate">{category?.name}</span>}
          {hasTitle && <span aria-hidden>•</span>}
          <span className="shrink-0">{memberName(expense.created_by)}</span>
          {expense.trip_id && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-brand">
              <AirplaneTilt className="size-3.5" weight="bold" aria-label="رحلة" />{tripName}
            </span>
          )}
          {expense.recurring_id && <Repeat className="size-3.5 shrink-0" weight="bold" aria-label="مصروف ثابت" />}
          {expense.receipt_path && <Paperclip className="size-3.5 shrink-0" weight="bold" aria-label="فاتورة مرفقة" />}
          {expense.source === 'sms' && <ChatCircleText className="size-3.5 shrink-0" weight="bold" aria-label="من رسالة البنك" />}
        </span>
      </span>
      <span className="shrink-0 text-end">
        <span className="num block font-semibold">{formatSAR(expense.amount)}</span>
        {expense.original_currency && (
          <span className="num block text-[11px] text-muted" dir="ltr">
            {flag(expense.country)} {formatAmount(expense.original_amount!)} {expense.original_currency}
          </span>
        )}
      </span>
    </button>
  );
}

export function ExpenseGroups({ expenses, categories, tripNames }: {
  expenses: Expense[]; categories: Category[]; tripNames?: Map<string, string>;
}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (
    <div className="space-y-5">
      {groupByDay(expenses).map((g) => (
        <section key={g.date}>
          <header className="mb-1 flex items-center justify-between px-2 text-sm text-muted">
            <h3 className="font-semibold text-ink">{formatDayLabel(g.date)}</h3>
            <span className="num">{formatSAR(g.total)}</span>
          </header>
          <div className="rounded-card bg-surface p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
            <AnimatePresence initial={false}>
              {g.items.map((e) => (
                <motion.div key={e.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
                  <ExpenseRow expense={e} category={byId.get(e.category_id)} tripName={e.trip_id ? tripNames?.get(e.trip_id) : undefined} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      ))}
    </div>
  );
}
