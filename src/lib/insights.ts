// حسابات صفحة «قراءات» — كلها أرقام دقيقة من العمليات نفسها (بالهللة).
// Claude يكتب الملاحظات عليها فقط ولا يحسب شيئاً.

import { addDays, addMonths, daysInMonth, monthOf } from './dates';
import { percentages, sumHalalas } from './money';
import type { Category, Expense, Halalas, ISODate, MonthKey, Recurring } from './types';

export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const weekday = (d: ISODate) => new Date(`${d}T00:00:00Z`).getUTCDay();
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/** نفس منطق قاعدة البيانات normalize_merchant (مختصر): لتجميع فروع المتجر الواحد */
export const merchantKey = (m: string | null | undefined): string | null => {
  if (!m) return null;
  const k = m.toLowerCase()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  return k || null;
};

const label = (e: Expense) => e.merchant ?? e.description ?? null;

// ---------- أيام الأسبوع ----------
export interface WeekdayStat { day: number; name: string; total: Halalas; avgPerDay: Halalas; percent: number }

/** متوسط الصرف لكل يوم أسبوع خلال الفترة [from, to] */
export function weekdayStats(expenses: readonly Expense[], from: ISODate, to: ISODate): WeekdayStat[] {
  const totals = Array(7).fill(0) as number[];
  const occurrences = Array(7).fill(0) as number[];
  for (let d = from; d <= to; d = addDays(d, 1)) occurrences[weekday(d)]!++;
  for (const e of expenses) if (e.expense_date >= from && e.expense_date <= to) totals[weekday(e.expense_date)]! += e.amount;
  const pct = percentages(totals);
  return totals.map((total, day) => ({
    day, name: WEEKDAYS[day]!, total, percent: pct[day] ?? 0,
    avgPerDay: occurrences[day] ? Math.round(total / occurrences[day]!) : 0,
  }));
}

// ---------- أول الشهر بعد الراتب ----------
export interface SalaryStat {
  salaryDay: number;
  cycles: number;
  firstWeekDaily: Halalas; // متوسط الصرف اليومي في أول 7 أيام بعد الراتب
  restDaily: Halalas;      // متوسط باقي الدورة
  ratio: number | null;    // كم ضعف
}

/** بداية دورة الراتب في شهر معيّن (اليوم محدود بطول الشهر) */
export const salaryDate = (month: MonthKey, day: number): ISODate =>
  `${month.slice(0, 8)}${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;

/** يقارن أول أسبوع بعد الراتب بباقي الدورة، لآخر `count` دورات مكتملة قبل اليوم */
export function salaryEffect(expenses: readonly Expense[], salaryDay: number, today: ISODate, count = 3): SalaryStat {
  const starts: ISODate[] = [];
  let m = monthOf(today);
  while (starts.length < count + 1) {
    const s = salaryDate(m, salaryDay);
    if (s <= today) starts.push(s);
    m = addMonths(m, -1);
  }
  // starts مرتبة من الأحدث؛ الدورة المكتملة = من بداية إلى بداية التالية
  let firstSum = 0, firstDays = 0, restSum = 0, restDays = 0;
  for (let i = 1; i <= count; i++) {
    const start = starts[i]!, next = starts[i - 1]!;
    const weekEnd = addDays(start, 6);
    for (let d = start; d < next; d = addDays(d, 1)) d <= weekEnd ? firstDays++ : restDays++;
    for (const e of expenses) {
      if (e.expense_date < start || e.expense_date >= next) continue;
      if (e.expense_date <= weekEnd) firstSum += e.amount; else restSum += e.amount;
    }
  }
  const firstWeekDaily = firstDays ? Math.round(firstSum / firstDays) : 0;
  const restDaily = restDays ? Math.round(restSum / restDays) : 0;
  return { salaryDay, cycles: count, firstWeekDaily, restDaily, ratio: restDaily > 0 ? firstWeekDaily / restDaily : null };
}

// ---------- مدفوعات تتكرر كل شهر ----------
export interface RecurringCandidate {
  key: string;
  name: string;
  amount: Halalas;   // الوسيط
  day: number;       // اليوم المعتاد في الشهر
  months: number;
  categoryId: string;
}

/** متاجر تظهر في 3 أشهر أو أكثر من آخر 4 أشهر بمبلغ متقارب (±20%)، وليست مضافة للثابتة */
export function recurringCandidates(
  expenses: readonly Expense[], recurring: readonly Recurring[], today: ISODate,
): RecurringCandidate[] {
  const current = monthOf(today);
  const fromMonth = addMonths(current, -4);
  const known = new Set(recurring.map((r) => merchantKey(r.name)).filter(Boolean) as string[]);
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) {
    if (e.recurring_id || e.trip_id || e.expense_date < fromMonth) continue;
    const k = merchantKey(label(e));
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: RecurringCandidate[] = [];
  for (const [key, items] of groups) {
    if ([...known].some((n) => n.includes(key) || key.includes(n))) continue;
    // دفعة واحدة لكل شهر (الأكبر) حتى لا تُحسب المشتريات المتكررة في الشهر كاشتراك
    const byMonth = new Map<MonthKey, Expense[]>();
    for (const e of items) byMonth.set(monthOf(e.expense_date), [...(byMonth.get(monthOf(e.expense_date)) ?? []), e]);
    if (byMonth.size < 3 || [...byMonth.values()].some((v) => v.length > 2)) continue;
    const monthly = [...byMonth.values()].map((v) => v.reduce((a, b) => (b.amount > a.amount ? b : a)));
    const amounts = monthly.map((e) => e.amount);
    const mid = median(amounts);
    if (mid < 1000 || (Math.max(...amounts) - Math.min(...amounts)) / mid > 0.2) continue;
    const last = monthly.sort((a, b) => b.expense_date.localeCompare(a.expense_date))[0]!;
    out.push({
      key, name: label(last)!, amount: mid, months: byMonth.size, categoryId: last.category_id,
      day: median(monthly.map((e) => Number(e.expense_date.slice(8, 10)))),
    });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 8);
}

// ---------- العادات ----------
export interface Habit { key: string; name: string; count: number; total: Halalas; avg: Halalas; categoryId: string }

/** المتاجر الأكثر زيارة في الفترة (3 مرات أو أكثر) */
export function habits(expenses: readonly Expense[], from: ISODate, to: ISODate): Habit[] {
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) {
    if (e.expense_date < from || e.expense_date > to || e.recurring_id) continue;
    const k = merchantKey(label(e));
    if (k) groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.length >= 3)
    .map(([key, v]) => {
      const total = sumHalalas(v.map((e) => e.amount));
      return { key, name: label(v[0]!)!, count: v.length, total, avg: Math.round(total / v.length), categoryId: v[0]!.category_id };
    })
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, 6);
}

// ---------- الأعلى من المعتاد ----------
export interface Anomaly { expense: Expense; typical: Halalas; times: number; basis: 'merchant' | 'category' }

/** عمليات الفترة الأعلى بوضوح من المعتاد لنفس المتجر (أو التصنيف) في التاريخ السابق */
export function anomalies(expenses: readonly Expense[], from: ISODate, to: ISODate): Anomaly[] {
  const history = expenses.filter((e) => e.expense_date < from && !e.recurring_id);
  const byMerchant = new Map<string, number[]>();
  const byCategory = new Map<string, number[]>();
  for (const e of history) {
    const k = merchantKey(label(e));
    if (k) byMerchant.set(k, [...(byMerchant.get(k) ?? []), e.amount]);
    byCategory.set(e.category_id, [...(byCategory.get(e.category_id) ?? []), e.amount]);
  }
  const out: Anomaly[] = [];
  for (const e of expenses) {
    if (e.expense_date < from || e.expense_date > to || e.recurring_id || e.amount < 10000) continue;
    const k = merchantKey(label(e));
    const m = k ? byMerchant.get(k) : undefined;
    if (m && m.length >= 3) {
      const typical = median(m);
      if (e.amount >= typical * 2.5) out.push({ expense: e, typical, times: e.amount / typical, basis: 'merchant' });
      continue;
    }
    const c = byCategory.get(e.category_id);
    if (c && c.length >= 8) {
      const typical = median(c);
      if (e.amount >= typical * 4) out.push({ expense: e, typical, times: e.amount / typical, basis: 'category' });
    }
  }
  return out.sort((a, b) => b.times - a.times).slice(0, 5);
}

// ---------- الحقائق المرسلة لـ Claude ----------
export function buildFacts(input: {
  month: MonthKey; today: ISODate; expenses: readonly Expense[]; categories: readonly Category[];
  budget: Halalas | null; salaryDay: number; recurring: readonly Recurring[];
}) {
  const { month, today, expenses, categories } = input;
  const sar = (h: number) => Math.round(h) / 100;
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const monthly = expenses.filter((e) => !e.trip_id);
  const end = monthOf(today) === month ? today : `${month.slice(0, 8)}${daysInMonth(month)}`;
  const inMonth = monthly.filter((e) => e.expense_date >= month && e.expense_date <= end);
  const total = sumHalalas(inMonth.map((e) => e.amount));

  // نفس عدد الأيام من الشهر السابق (مقارنة عادلة لشهر لم ينتهِ)
  const prevMonth = addMonths(month, -1);
  const dayN = Math.min(Number(end.slice(8, 10)), daysInMonth(prevMonth));
  const prevEnd = `${prevMonth.slice(0, 8)}${String(dayN).padStart(2, '0')}`;
  const prevTotal = sumHalalas(monthly.filter((e) => e.expense_date >= prevMonth && e.expense_date <= prevEnd).map((e) => e.amount));

  const byCat = new Map<string, number>();
  for (const e of inMonth) byCat.set(e.category_id, (byCat.get(e.category_id) ?? 0) + e.amount);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const pct = percentages(cats.map(([, v]) => v));

  const ninety = addDays(end, -89);
  const week = weekdayStats(monthly, ninety, end);
  const salary = salaryEffect(monthly, input.salaryDay, today);
  const candidates = recurringCandidates(monthly, input.recurring, today);

  return {
    month,
    days_counted: Number(end.slice(8, 10)),
    month_finished: end !== today,
    total_sar: sar(total),
    transactions: inMonth.length,
    same_days_last_month_sar: sar(prevTotal),
    change_vs_last_month_percent: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
    budget_sar: input.budget ? sar(input.budget) : null,
    budget_used_percent: input.budget ? Math.round((total / input.budget) * 100) : null,
    top_categories: cats.slice(0, 5).map(([id, v], i) => ({ name: catName.get(id) ?? '—', sar: sar(v), percent: pct[i] })),
    weekday_avg_sar_last_90_days: week.map((w) => ({ day: w.name, avg_per_day_sar: sar(w.avgPerDay) })),
    salary: {
      salary_day: salary.salaryDay,
      first_week_daily_avg_sar: sar(salary.firstWeekDaily),
      rest_of_cycle_daily_avg_sar: sar(salary.restDaily),
      times_more_first_week: salary.ratio ? Math.round(salary.ratio * 10) / 10 : null,
    },
    repeating_monthly_payments_not_in_fixed: candidates.map((c) => ({ name: c.name, typical_sar: sar(c.amount), months_seen: c.months })),
    frequent_merchants_this_month: habits(monthly, month, end).map((h) => ({ name: h.name, visits: h.count, total_sar: sar(h.total), avg_sar: sar(h.avg) })),
    higher_than_usual: anomalies(monthly, month, end).map((a) => ({
      name: label(a.expense) ?? catName.get(a.expense.category_id), sar: sar(a.expense.amount), usual_sar: sar(a.typical),
      times: Math.round(a.times * 10) / 10, date: a.expense.expense_date,
    })),
  };
}
