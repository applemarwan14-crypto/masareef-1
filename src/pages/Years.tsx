import { useState } from 'react';
import { toast } from 'sonner';
import { Archive, FileXls, Stack, TrendDown, TrendUp } from '@phosphor-icons/react';
import { Button, Card, ConfirmButton, EmptyState, Spinner, cx } from '../components/ui';
import { useHousehold, useIsOwner } from '../hooks/household';
import { useCategories, useInvalidate, useMonthlyTotals, useTrips, useYearOverview } from '../hooks/queries';
import { archiveYear, fetchExpenses } from '../lib/api';
import { formatMonthShort, monthOf, todayISO } from '../lib/dates';
import { exportExcel } from '../lib/export';
import { formatSAR } from '../lib/money';
import { yearComparison } from '../lib/stats';

export default function YearsPage() {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const upto = Number(today.slice(5, 7));
  const { data: years = [], isPending } = useYearOverview();
  // من يناير السنة الماضية حتى الآن
  const monthly = useMonthlyTotals(monthOf(today), 12 + upto);
  const cmp = yearComparison(monthly.data ?? [], year, upto);
  const max = Math.max(...cmp.months.flatMap((m) => [m.current, m.previous]), 1);

  return (
    <div className="space-y-4 pt-4">
      <h1 className="text-xl font-bold">السنوات</h1>

      <Card>
        <h2 className="font-bold">{year} مقابل {year - 1}</h2>
        <p className="mb-4 text-xs text-muted">مقارنة عادلة بنفس الأشهر: يناير حتى {formatMonthShort(monthOf(today))} من السنتين (بدون الرحلات)</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-brand-soft p-3">
            <p className="text-xs text-muted">{year}</p>
            <p className="num text-xl font-bold text-brand">{formatSAR(cmp.current)}</p>
          </div>
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-xs text-muted">{year - 1} (نفس الفترة)</p>
            <p className="num text-xl font-bold">{formatSAR(cmp.previous)}</p>
          </div>
        </div>
        {cmp.change !== null && (
          <p className={cx('mt-3 inline-flex items-center gap-1 text-sm font-semibold', cmp.change > 0 ? 'text-warn' : 'text-brand')}>
            {cmp.change > 0 ? <TrendUp className="size-4" weight="bold" /> : <TrendDown className="size-4" weight="bold" />}
            {cmp.change > 0 ? 'أكثر' : 'أقل'} بـ {Math.abs(Math.round(cmp.change * 100))}%
          </p>
        )}
        <div className="mt-4 space-y-2">
          {cmp.months.map((m) => (
            <div key={m.month} className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 text-muted">{formatMonthShort(`2000-${String(m.month).padStart(2, '0')}-01`)}</span>
              <div className="flex-1 space-y-1">
                <div className="h-2 rounded-full bg-brand" style={{ width: `${(m.current / max) * 100}%` }} />
                <div className="h-2 rounded-full bg-line" style={{ width: `${(m.previous / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {isPending ? <Spinner /> : years.length === 0 ? <EmptyState icon={Stack} title="ما في بيانات بعد" /> : (
        <Card className="p-3">
          <h2 className="px-2 pt-2 font-bold">كل السنوات</h2>
          <ul className="mt-2">
            {years.map((y) => <YearRow key={y.year} row={y} current={year} />)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function YearRow({ row, current }: { row: { year: number; total: number; tx_count: number; months: number; archived: boolean }; current: number }) {
  const { household, members } = useHousehold();
  const owner = useIsOwner();
  const { data: categories = [] } = useCategories();
  const { data: trips = [] } = useTrips();
  const invalidate = useInvalidate();
  const [exported, setExported] = useState(false);
  const [busy, setBusy] = useState(false);
  const canArchive = owner && row.year < current;

  async function download() {
    setBusy(true);
    try {
      const expenses = await fetchExpenses(household.id, `${row.year}-01-01`, `${row.year}-12-31`);
      if (!expenses.length) throw new Error('عمليات هذه السنة مؤرشفة، يبقى الملخص فقط');
      await exportExcel({ title: `مصاريف ${household.name} ${row.year}`, periodLabel: String(row.year), expenses, categories, members, trips },
        `مصاريف-${row.year}-كامل.xlsx`);
      setExported(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    try {
      const files = await archiveYear(row.year);
      await invalidate('years', 'monthly', 'expenses', 'trips');
      toast.success(`أرشفنا ${row.year}${files ? ` وحذفنا ${files} صورة فاتورة` : ''}. الملخص الشهري باقي.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-2xl px-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className="font-bold">{row.year}</span>
          {row.archived && <span className="ms-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">مؤرشفة</span>}
          <span className="block text-xs text-muted">{row.tx_count} عملية · {row.months} أشهر · متوسط {formatSAR(Math.round(row.total / Math.max(row.months, 1)))}/شهر</span>
        </span>
        <span className="num font-bold">{formatSAR(row.total)}</span>
      </div>
      {canArchive && !row.archived && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" className="h-10 px-3 text-sm" loading={busy && !exported} onClick={download}>
            <FileXls className="size-5 text-[#1D7044]" weight="duotone" /> 1. Excel كامل
          </Button>
          {exported ? (
            <ConfirmButton className="h-10 px-3 text-sm" loading={busy} confirmText="تأكيد: حذف العمليات وإبقاء الملخص" onConfirm={archive}>
              <Archive className="size-5" /> 2. أرشفة
            </ConfirmButton>
          ) : (
            <span className="self-center text-xs text-muted">نزّل الملف أولاً، بعدها تقدر تأرشف</span>
          )}
        </div>
      )}
    </li>
  );
}
