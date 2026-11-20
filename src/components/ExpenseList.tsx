import { AnimatePresence, motion } from 'motion/react';
import { AirplaneTilt, ChatCircleText, Paperclip, Repeat } from '@phosphor-icons/react';
import { useMemberName } from '../hooks/household';
import { formatDayLabel } from '../lib/dates';
import { flag } from '../lib/labels';
import { formatAmount } from '../lib/money';
import { groupByDay } from '../lib/stats';
import type { Category, Expense } from '../lib/types';
import { useExpenseSheet } from './Layout';
import { CategoryIcon, Money } from './ui';

/** عنوان العملية: المتجر، ثم الوصف، ثم التصنيف */
export const expenseTitle = (e: Expense, category?: Category) =>
  e.merchant || e.description?.replace(/^📩\s*/, '') || category?.name || 'مصروف';

export function ExpenseRow({ expense, category, tripName }: { expense: Expense; category?: Category; tripName?: string }) {
  const openSheet = useExpenseSheet();
  const memberName = useMemberName();
  const hasTitle = Boolean(expense.merchant || expense.description);
  return (
    <button type="button" onClick={() => openSheet(expense)}
      className="tap-row flex w-full items-center gap-3 rounded-[16px] px-2.5 py-2.5 text-start">
      <span className="relative">
        <CategoryIcon category={category} />
        {expense.source === 'sms' && (
          <span className="absolute -bottom-1 -end-1 flex size-[18px] items-center justify-center rounded-full bg-surface text-brand ring-2 ring-surface"
            aria-label="من رسالة البنك">
            <ChatCircleText className="size-3" weight="fill" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{expenseTitle(expense, category)}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          {hasTitle && <span className="truncate">{category?.name}</span>}
          {hasTitle && <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-muted" />}
          <span className="shrink-0">{memberName(expense.created_by)}</span>
          {expense.trip_id && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand">
              <AirplaneTilt className="size-3" weight="bold" aria-label="رحلة" />{tripName}
            </span>
          )}
          {expense.recurring_id && <Repeat className="size-3.5 shrink-0" weight="bold" aria-label="مصروف ثابت" />}
          {expense.receipt_path && <Paperclip className="size-3.5 shrink-0" weight="bold" aria-label="فاتورة مرفقة" />}
        </span>
      </span>
      <span className="shrink-0 text-end">
        <Money value={expense.amount} className="block text-[15px] font-semibold" />
        {expense.original_currency && (
          <span className="num mt-0.5 block text-[11px] text-muted" dir="ltr">
            {flag(expense.country)} {formatAmount(expense.original_amount!)} {expense.original_currency}
          </span>
        )}
      </span>
    </button>
  );
}

/** العمليات مجمّعة حسب اليوم: عنوان اليوم يلتصق أعلى الشاشة أثناء التمرير */
export function ExpenseGroups({ expenses, categories, tripNames }: {
  expenses: Expense[]; categories: Category[]; tripNames?: Map<string, string>;
}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (
    <div className="space-y-5">
      {groupByDay(expenses).map((g, gi) => (
        <motion.section key={g.date} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(gi, 8) * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <header className="sticky top-0 z-10 -mx-1 mb-1.5 flex items-center justify-between bg-bg/90 px-2 py-1.5 backdrop-blur-sm">
            <h3 className="text-[13px] font-semibold text-ink-2">{formatDayLabel(g.date)}</h3>
            <span className="text-xs text-muted"><Money value={g.total} /></span>
          </header>
          <div className="surface p-1.5">
            <AnimatePresence initial={false}>
              {g.items.map((e) => (
                <motion.div key={e.id} layout exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
                  <ExpenseRow expense={e} category={byId.get(e.category_id)} tripName={e.trip_id ? tripNames?.get(e.trip_id) : undefined} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.section>
      ))}
    </div>
  );
}
