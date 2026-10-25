import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlarmClock, TrendingDown, TrendingUp } from 'lucide-react';
import { CategoryDonut, MonthlyBars } from '../components/Charts';
import { ExpenseRow } from '../components/ExpenseList';
import { useExpenseSheet } from '../components/Layout';
import { Card, CategoryIcon, EmptyState, MonthSwitcher, Spinner, cx } from '../components/ui';
import { useHousehold } from '../hooks/household';
import { useCategories, useMonthExpenses, useMonthlyTotals, useRecurring, useRecurringPayments } from '../hooks/queries';
import { addMonths, formatMonth, lastMonths, monthOf, todayISO } from '../lib/dates';
import { formatSAR, sumHalalas } from '../lib/money';
import { recurringForMonth } from '../lib/recurring';
import { budgetStatus, byCategory, changeRatio, monthlySeries } from '../lib/stats';

export default function Dashboard() {
  const today = todayISO();
  const [month, setMonth] = useState(monthOf(today));
  const { household, me } = useHousehold();
  const openSheet = useExpenseSheet();

  const { data: categories = [] } = useCategories();
  const expenses = useMonthExpenses(month);
  const monthly = useMonthlyTotals(monthOf(today), 6);
  const recurring = useRecurring();
  const payments = useRecurringPayments(month);

  const list = expenses.data ?? [];
  const total = sumHalalas(list.map((e) => e.amount));
  const slices = useMemo(() => byCategory(list, categories), [list, categories]);
  const series = monthlySeries(monthly.data ?? [], lastMonths(monthOf(today), 6));
  const previous = series.find((s) => s.month === addMonths(month, -1))?.total ?? 0;
  const change = changeRatio(total, previous);
  const budget = budgetStatus(total, household.monthly_budget, month, today);
  const unpaid = recurringForMonth(recurring.data ?? [], payments.data ?? [], month, today).filter((r) => r.status !== 'paid');

  return (
    <div className="space-y-5 pt-4">
      <header className="flex items-center justify-between">
        <p className="text-muted">أهلاً {me.display_name}</p>
        <MonthSwitcher month={month} onChange={setMonth} />
      </header>

      {/* الملخص: إجمالي الشهر ومقياس الميزانية */}
      <Card className="space-y-4">
        <div>
          <p className="text-sm text-muted">إجمالي مصروف {formatMonth(month)}</p>
          <p className="num mt-1 text-4xl font-bold tracking-tight md:text-5xl">{formatSAR(total)}</p>
          {change !== null && (
            <p className={cx('mt-2 inline-flex items-center gap-1 text-sm', change > 0 ? 'text-danger' : 'text-brand')}>
              {change > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              {change > 0 ? 'أكثر' : 'أقل'} من الشهر السابق بـ {Math.abs(Math.round(change * 100))}%
            </p>
          )}
        </div>

        {budget.level === 'none' ? (
          <Link to="/settings" className="block rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted hover:text-ink">
            حدّد ميزانية شهرية لمتابعة المبلغ المتبقي
          </Link>
        ) : (
          <div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(budget.ratio, 1) * 100)}>
              <div
                className={cx('h-full rounded-full transition-[width] duration-500',
                  budget.level === 'over' ? 'bg-danger' : budget.level === 'warn' ? 'bg-warn' : 'bg-brand')}
                style={{ width: `${Math.min(budget.ratio, 1) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <span className={cx('font-semibold', budget.level === 'over' && 'text-danger')}>
                {budget.remaining! >= 0
                  ? <>متبقٍ <span className="num">{formatSAR(budget.remaining!)}</span></>
                  : <>تجاوزت الميزانية بـ <span className="num">{formatSAR(-budget.remaining!)}</span></>}
              </span>
              <span className="text-muted">من <span className="num">{formatSAR(budget.budget!)}</span></span>
            </div>
            {budget.dailyAllowance !== null && (
              <p className="mt-1 text-sm text-muted">
                يمكنكم صرف <span className="num font-medium text-ink">{formatSAR(budget.dailyAllowance)}</span> يومياً حتى نهاية الشهر
              </p>
            )}
          </div>
        )}
      </Card>

      {unpaid.length > 0 && (
        <Link to="/recurring"
          className="flex items-center gap-3 rounded-card bg-warn-soft px-5 py-4 text-sm hover:opacity-90">
          <AlarmClock className="size-5 shrink-0 text-warn" />
          <span className="flex-1">
            {unpaid.length === 1 ? 'مصروف ثابت واحد لم يُدفع' : `${unpaid.length} مصاريف ثابتة لم تُدفع`} هذا الشهر
          </span>
          <span className="num font-semibold">{formatSAR(sumHalalas(unpaid.map((u) => u.item.amount)))}</span>
        </Link>
      )}

      {expenses.isPending ? <Spinner /> : list.length === 0 ? (
        <EmptyState title="لا توجد مصروفات في هذا الشهر">
          <button onClick={() => openSheet()} className="font-semibold text-brand">أضف أول مصروف</button>
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 font-bold">حسب التصنيف</h2>
            <CategoryDonut slices={slices} total={total} />
            <ul className="mt-5 space-y-3">
              {slices.map((s) => (
                <li key={s.categoryId} className="flex items-center gap-3">
                  <CategoryIcon category={s.category} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{s.category?.name ?? '—'}</span>
                      <span className="num shrink-0 font-semibold">{formatSAR(s.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${s.percent}%`, background: s.category?.color }} />
                      </div>
                      <span className="num w-9 text-end text-xs text-muted">{s.percent}%</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-5">
            <Card>
              <h2 className="mb-2 font-bold">آخر 6 أشهر</h2>
              <MonthlyBars data={series} selected={month} onSelect={setMonth} />
            </Card>
            <Card className="p-3">
              <div className="mb-1 flex items-center justify-between px-2 pt-2">
                <h2 className="font-bold">أحدث العمليات</h2>
                <Link to="/expenses" className="text-sm font-medium text-brand">كل العمليات</Link>
              </div>
              {list.slice(0, 6).map((e) => (
                <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.id === e.category_id)} />
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
