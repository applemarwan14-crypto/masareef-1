import { percentages, sumHalalas } from './money';
import { daysInMonth, monthOf } from './dates';
import type { Category, Expense, Halalas, ISODate, MonthKey, MonthlyTotal } from './types';

export interface CategorySlice {
  categoryId: string;
  category: Category | undefined;
  total: Halalas;
  count: number;
  percent: number;
}

/** توزيع المصروفات على التصنيفات، مرتبة تنازلياً */
export function byCategory(expenses: readonly Expense[], categories: readonly Category[]): CategorySlice[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const e of expenses) {
    const cur = map.get(e.category_id) ?? { total: 0, count: 0 };
    cur.total += e.amount;
    cur.count += 1;
    map.set(e.category_id, cur);
  }
  const catById = new Map(categories.map((c) => [c.id, c]));
  const rows = [...map.entries()]
    .map(([categoryId, v]) => ({ categoryId, category: catById.get(categoryId), ...v }))
    .sort((a, b) => b.total - a.total);
  const pct = percentages(rows.map((r) => r.total));
  return rows.map((r, i) => ({ ...r, percent: pct[i] ?? 0 }));
}

export type BudgetLevel = 'none' | 'ok' | 'warn' | 'over';

export interface BudgetStatus {
  budget: Halalas | null;
  spent: Halalas;
  remaining: Halalas | null;
  ratio: number; // 0..1+ نسبة المصروف من الميزانية
  level: BudgetLevel;
  /** المتاح يومياً لبقية الشهر (للشهر الحالي فقط) */
  dailyAllowance: Halalas | null;
}

export function budgetStatus(spent: Halalas, budget: Halalas | null, month: MonthKey, today: ISODate): BudgetStatus {
  if (!budget) return { budget: null, spent, remaining: null, ratio: 0, level: 'none', dailyAllowance: null };
  const remaining = budget - spent;
  const ratio = spent / budget;
  const level: BudgetLevel = ratio > 1 ? 'over' : ratio >= 0.85 ? 'warn' : 'ok';
  let dailyAllowance: Halalas | null = null;
  if (monthOf(today) === month && remaining > 0) {
    const daysLeft = daysInMonth(month) - Number(today.slice(8, 10)) + 1;
    dailyAllowance = Math.floor(remaining / daysLeft);
  }
  return { budget, spent, remaining, ratio, level, dailyAllowance };
}

/** سلسلة إجمالي كل شهر (تملأ الأشهر الفارغة بصفر) */
export function monthlySeries(rows: readonly MonthlyTotal[], months: readonly MonthKey[]) {
  const totals = new Map<MonthKey, number>();
  for (const r of rows) totals.set(r.month, (totals.get(r.month) ?? 0) + r.total);
  return months.map((month) => ({ month, total: totals.get(month) ?? 0 }));
}

/** نسبة التغير بين شهرين؛ null إذا لم يكن هناك صرف في الشهر السابق */
export function changeRatio(current: Halalas, previous: Halalas): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export interface DayGroup {
  date: ISODate;
  total: Halalas;
  items: Expense[];
}

/** تجميع العمليات حسب اليوم (يفترض أنها مرتبة تنازلياً بالتاريخ) */
export function groupByDay(expenses: readonly Expense[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of expenses) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.expense_date) last.items.push(e);
    else groups.push({ date: e.expense_date, total: 0, items: [e] });
  }
  for (const g of groups) g.total = sumHalalas(g.items.map((i) => i.amount));
  return groups;
}

export interface ExpenseFilter {
  query?: string;
  categoryId?: string | null;
  memberId?: string | null;
  /** monthly: بدون الرحلات، trips: الرحلات فقط */
  scope?: 'all' | 'monthly' | 'trips';
}

export function filterExpenses(
  expenses: readonly Expense[],
  filter: ExpenseFilter,
  categories: readonly Category[],
): Expense[] {
  const q = filter.query?.trim().toLowerCase();
  const catName = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));
  return expenses.filter((e) => {
    if (filter.categoryId && e.category_id !== filter.categoryId) return false;
    if (filter.memberId && e.created_by !== filter.memberId) return false;
    if (filter.scope === 'monthly' && e.trip_id) return false;
    if (filter.scope === 'trips' && !e.trip_id) return false;
    if (q) {
      const hay = `${e.merchant ?? ''} ${e.description ?? ''} ${catName.get(e.category_id) ?? ''} ${e.amount / 100}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface YearComparison {
  months: { month: number; current: Halalas; previous: Halalas }[];
  current: Halalas;
  previous: Halalas;
  change: number | null;
}

/**
 * مقارنة سنوية عادلة: نفس الأشهر من السنتين فقط (يناير حتى `uptoMonth`).
 * مثلاً في أكتوبر تُقارن يناير–أكتوبر هذه السنة بيناير–أكتوبر السنة الماضية، لا بالسنة الماضية كاملة.
 */
export function yearComparison(rows: readonly MonthlyTotal[], year: number, uptoMonth: number): YearComparison {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.month, (totals.get(r.month) ?? 0) + r.total);
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
  const months = Array.from({ length: uptoMonth }, (_, i) => ({
    month: i + 1,
    current: totals.get(key(year, i + 1)) ?? 0,
    previous: totals.get(key(year - 1, i + 1)) ?? 0,
  }));
  const current = sumHalalas(months.map((m) => m.current));
  const previous = sumHalalas(months.map((m) => m.previous));
  return { months, current, previous, change: changeRatio(current, previous) };
}
