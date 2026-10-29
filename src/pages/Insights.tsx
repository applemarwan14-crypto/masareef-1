import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowsClockwise, CalendarBlank, ChartLineUp, Lightbulb, Repeat, Sparkle, Storefront, ThumbsUp, Warning, Wallet } from '@phosphor-icons/react';
import { useExpenseSheet } from '../components/Layout';
import { Button, Card, EmptyState, MonthSwitcher, Spinner, cx } from '../components/ui';
import { useHousehold } from '../hooks/household';
import { useCategories, useExpenses, useRecurring, useSaveRecurring } from '../hooks/queries';
import { fetchInsightNotes } from '../lib/api';
import { addMonths, daysInMonth, formatDayShort, formatMonth, monthOf, todayISO } from '../lib/dates';
import { WEEKDAYS, anomalies, buildFacts, habits, recurringCandidates, salaryEffect, weekdayStats } from '../lib/insights';
import { formatSAR } from '../lib/money';

export default function InsightsPage() {
  const today = todayISO();
  const [month, setMonth] = useState(monthOf(today));
  const { household } = useHousehold();
  const { data: categories = [] } = useCategories();
  const { data: recurring = [] } = useRecurring();
  // 6 أشهر للخلفية (المعتاد، التكرار، الراتب)
  const end = monthOf(today) === month ? today : `${month.slice(0, 8)}${daysInMonth(month)}`;
  const { data: raw = [], isPending } = useExpenses(addMonths(month, -5), end);
  const expenses = useMemo(() => raw.filter((e) => !e.trip_id), [raw]);

  const facts = useMemo(() => buildFacts({
    month, today, expenses, categories, budget: household.monthly_budget, salaryDay: household.salary_day, recurring,
  }), [month, today, expenses, categories, household.monthly_budget, household.salary_day, recurring]);

  const week = useMemo(() => weekdayStats(expenses, `${addMonths(month, -2)}`, end), [expenses, month, end]);
  const salary = useMemo(() => salaryEffect(expenses, household.salary_day, end), [expenses, household.salary_day, end]);
  const candidates = useMemo(() => recurringCandidates(expenses, recurring, end), [expenses, recurring, end]);
  const habitList = useMemo(() => habits(expenses, month, end), [expenses, month, end]);
  const unusual = useMemo(() => anomalies(expenses, month, end), [expenses, month, end]);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  const [refresh, setRefresh] = useState(0);
  const notes = useQuery({
    queryKey: ['insight-notes', household.id, month, JSON.stringify(facts), refresh],
    queryFn: () => fetchInsightNotes(month, facts, refresh > 0),
    enabled: !isPending && facts.transactions > 0,
    staleTime: Infinity,
    retry: false,
  });

  const maxDay = Math.max(...week.map((w) => w.avgPerDay), 1);
  const topDay = [...week].sort((a, b) => b.avgPerDay - a.avgPerDay)[0];

  return (
    <div className="space-y-4 pt-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">قراءات</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
      </header>

      {isPending ? <Spinner /> : facts.transactions === 0 ? (
        <EmptyState icon={ChartLineUp} title={`ما في عمليات في ${formatMonth(month)}`} />
      ) : (<>
        {/* ملاحظات Claude */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-bold"><Sparkle className="size-5 text-brand" weight="duotone" />قراءة Claude للشهر</h2>
            <button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={notes.isFetching}
              className="text-muted" aria-label="قراءة جديدة"><ArrowsClockwise className={cx('size-5', notes.isFetching && 'animate-spin')} /></button>
          </div>
          {notes.isPending || notes.isFetching ? <p className="text-sm text-muted">Claude يقرأ أرقامكم…</p>
            : notes.isError ? <p className="text-sm text-danger">{(notes.error as Error).message}</p>
            : notes.data && (<>
              <p className="font-semibold leading-relaxed">{notes.data.headline}</p>
              <ul className="space-y-2.5">
                {notes.data.notes.map((n, i) => (
                  <li key={i} className="flex gap-3 rounded-2xl bg-surface-2 p-3">
                    <span className={cx('mt-0.5 shrink-0', n.tone === 'good' ? 'text-brand' : n.tone === 'warn' ? 'text-warn' : 'text-[#2563EB]')}>
                      {n.tone === 'good' ? <ThumbsUp className="size-5" weight="duotone" /> : n.tone === 'warn' ? <Warning className="size-5" weight="duotone" /> : <Lightbulb className="size-5" weight="duotone" />}
                    </span>
                    <span><span className="block font-semibold">{n.title}</span><span className="text-sm leading-relaxed text-muted">{n.body}</span></span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted">الأرقام محسوبة من عملياتكم بالضبط، وClaude يكتب الملاحظات فقط.</p>
            </>)}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* أيام الأسبوع */}
          <Card>
            <h2 className="mb-1 inline-flex items-center gap-2 font-bold"><CalendarBlank className="size-5 text-brand" weight="duotone" />متى تصرفون أكثر</h2>
            <p className="mb-4 text-xs text-muted">متوسط الصرف لكل يوم، آخر 3 أشهر{topDay && ` · الأعلى ${topDay.name}`}</p>
            <div className="flex h-36 items-end gap-2" dir="rtl">
              {week.map((w) => (
                <div key={w.day} className="flex h-full flex-1 flex-col items-center gap-1">
                  <span className="num text-[10px] text-muted">{Math.round(w.avgPerDay / 100)}</span>
                  <div className="flex w-full flex-1 items-end">
                    <div className={cx('w-full rounded-lg', w.day === topDay?.day ? 'bg-brand' : 'bg-line')}
                      style={{ height: `${Math.max((w.avgPerDay / maxDay) * 100, 3)}%` }} />
                  </div>
                  <span className="text-[11px] font-medium">{WEEKDAYS[w.day]!.replace('ال', '')}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* الراتب */}
          <Card>
            <h2 className="mb-1 inline-flex items-center gap-2 font-bold"><Wallet className="size-5 text-brand" weight="duotone" />أول الشهر بعد الراتب</h2>
            <p className="mb-4 text-xs text-muted">الراتب يوم {salary.salaryDay} (تغيّره من الإعدادات) · آخر {salary.cycles} رواتب</p>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-2xl bg-surface-2 p-3">
                <p className="text-xs text-muted">أول أسبوع (يومياً)</p>
                <p className="num mt-1 text-lg font-bold">{formatSAR(salary.firstWeekDaily)}</p>
              </div>
              <div className="rounded-2xl bg-surface-2 p-3">
                <p className="text-xs text-muted">باقي الشهر (يومياً)</p>
                <p className="num mt-1 text-lg font-bold">{formatSAR(salary.restDaily)}</p>
              </div>
            </div>
            {salary.ratio !== null && (
              <p className="mt-3 text-sm">
                {salary.ratio >= 1.2 ? <>تصرفون في أول أسبوع <b className="num">{salary.ratio.toFixed(1)}×</b> المعتاد.</>
                  : salary.ratio <= 0.8 ? 'صرفكم بعد الراتب أهدأ من باقي الشهر 👏' : 'صرفكم متوازن على مدار الشهر.'}
              </p>
            )}
          </Card>
        </div>

        {/* المدفوعات المتكررة */}
        {candidates.length > 0 && (
          <Card className="p-3">
            <h2 className="inline-flex items-center gap-2 px-2 pt-2 font-bold"><Repeat className="size-5 text-brand" weight="duotone" />تتكرر كل شهر</h2>
            <p className="px-2 pb-2 text-xs text-muted">مدفوعات بنفس المبلغ تقريباً كل شهر، وما هي في المصاريف الثابتة</p>
            <ul>
              {candidates.map((c) => <CandidateRow key={c.key} c={c} />)}
            </ul>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {habitList.length > 0 && (
            <Card className="p-3">
              <h2 className="inline-flex items-center gap-2 px-2 pt-2 font-bold"><Storefront className="size-5 text-brand" weight="duotone" />عاداتكم هذا الشهر</h2>
              <ul className="mt-2">
                {habitList.map((h) => (
                  <li key={h.key} className="flex items-center justify-between gap-2 rounded-2xl px-2 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.name}</span>
                      <span className="text-xs text-muted">{h.count} مرات · متوسط {formatSAR(h.avg)} · {catName(h.categoryId)}</span>
                    </span>
                    <span className="num shrink-0 font-semibold">{formatSAR(h.total)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {unusual.length > 0 && (
            <Card className="p-3">
              <h2 className="inline-flex items-center gap-2 px-2 pt-2 font-bold"><Warning className="size-5 text-warn" weight="duotone" />أعلى من المعتاد</h2>
              <ul className="mt-2">
                {unusual.map((a) => <AnomalyRow key={a.expense.id} a={a} />)}
              </ul>
            </Card>
          )}
        </div>
      </>)}
    </div>
  );
}

function CandidateRow({ c }: { c: ReturnType<typeof recurringCandidates>[number] }) {
  const save = useSaveRecurring();
  const [added, setAdded] = useState(false);
  return (
    <li className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{c.name}</span>
        <span className="text-xs text-muted">{formatSAR(c.amount)} · حوالي يوم {c.day} · ظهر في {c.months} أشهر</span>
      </span>
      <Button variant="secondary" className="h-9 px-3 text-sm" disabled={added} loading={save.isPending}
        onClick={() => save.mutate(
          { input: { name: c.name.slice(0, 60), amount: c.amount, category_id: c.categoryId, day_of_month: c.day, is_active: true } },
          { onSuccess: () => setAdded(true) },
        )}>
        {added ? 'أُضيف' : 'للثابتة'}
      </Button>
    </li>
  );
}

function AnomalyRow({ a }: { a: ReturnType<typeof anomalies>[number] }) {
  const openSheet = useExpenseSheet();
  return (
    <li>
      <button type="button" onClick={() => openSheet(a.expense)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-start hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{a.expense.merchant ?? a.expense.description ?? 'عملية'}</span>
          <span className="text-xs text-muted">
            {formatDayShort(a.expense.expense_date)} · المعتاد {formatSAR(a.typical)} {a.basis === 'category' && '(للتصنيف)'}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span className="num block font-semibold">{formatSAR(a.expense.amount)}</span>
          <span className="num text-xs text-warn">{a.times.toFixed(1)}×</span>
        </span>
      </button>
    </li>
  );
}
