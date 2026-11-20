import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AirplaneTilt, CalendarDots, FilePdf, FileXls, FunnelSimple, MagnifyingGlass, Receipt, User, X } from '@phosphor-icons/react';
import { ExpenseGroups } from '../components/ExpenseList';
import { Button, EmptyState, IconButton, Money, MonthSwitcher, PageHeader, Select, Spinner, cx, fieldClass } from '../components/ui';
import { useHousehold } from '../hooks/household';
import { useCategories, useExpenses, useTrips } from '../hooks/queries';
import { exportExcel, printReport } from '../lib/export';
import { formatDayShort, formatMonth, monthEnd, monthOf, todayISO } from '../lib/dates';
import { sumHalalas } from '../lib/money';
import { filterExpenses } from '../lib/stats';
import type { MonthKey } from '../lib/types';

export default function Expenses() {
  const today = todayISO();
  const { household, members } = useHousehold();
  const { data: categories = [] } = useCategories();

  const [month, setMonth] = useState<MonthKey>(monthOf(today));
  const [custom, setCustom] = useState(false);
  const [range, setRange] = useState({ from: month, to: monthEnd(month) });
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [scope, setScope] = useState<'all' | 'monthly' | 'trips'>('all');
  const { data: trips = [] } = useTrips();
  const tripNames = useMemo(() => new Map(trips.map((t) => [t.id, t.name])), [trips]);
  const [exporting, setExporting] = useState(false);

  const from = custom ? range.from : month;
  const to = custom ? range.to : monthEnd(month);
  const { data = [], isPending } = useExpenses(from, to);

  const filtered = useMemo(
    () => filterExpenses(data, { query, categoryId: categoryId || null, memberId: memberId || null, scope }, categories),
    [data, query, categoryId, memberId, scope, categories],
  );
  const total = sumHalalas(filtered.map((e) => e.amount));
  const periodLabel = custom ? `${formatDayShort(from)} – ${formatDayShort(to)}` : formatMonth(month);
  const hasFilters = Boolean(query || categoryId || memberId || scope !== 'all');

  const report = () => ({ title: `مصاريف ${household.name}`, periodLabel, expenses: filtered, categories, members });

  async function onExcel() {
    setExporting(true);
    try {
      await exportExcel(report(), `مصاريف-${from}-${to}.xlsx`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  function onPdf() {
    try { printReport(report()); } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="العمليات" subtitle={periodLabel}
        actions={<>
          {!custom && <MonthSwitcher month={month} onChange={setMonth} />}
          <IconButton label={custom ? 'العودة للعرض الشهري' : 'نطاق تاريخ مخصص'}
            onClick={() => { setCustom(!custom); setRange({ from: month, to: monthEnd(month) }); }}
            className={custom ? 'bg-panel text-panel-ink hover:bg-panel-2 hover:text-panel-ink' : 'bg-surface shadow-[var(--shadow-card)]'}>
            <CalendarDots className="size-5" weight={custom ? 'fill' : 'regular'} />
          </IconButton>
        </>} />

      {custom && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[13px] font-medium text-ink-2">من
            <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
              className={cx(fieldClass, 'mt-1.5')} />
          </label>
          <label className="text-[13px] font-medium text-ink-2">إلى
            <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
              className={cx(fieldClass, 'mt-1.5')} />
          </label>
        </div>
      )}

      {/* شريط المجموع: الرقم أولاً، والتصدير كأزرار صغيرة */}
      <section className="surface flex items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{filtered.length} عملية{hasFilters && ' مطابقة'}</p>
          <Money value={total} className="display mt-1.5 text-[30px]" />
        </div>
        <IconButton label="تصدير Excel" onClick={onExcel} disabled={!filtered.length || exporting} className="size-11 bg-surface-2">
          <FileXls className="size-[22px] text-[#1D7044]" weight="duotone" />
        </IconButton>
        <IconButton label="تقرير PDF" onClick={onPdf} disabled={!filtered.length} className="size-11 bg-surface-2">
          <FilePdf className="size-[22px] text-[#C2410C]" weight="duotone" />
        </IconButton>
      </section>

      <div className="space-y-3">
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالمتجر أو الوصف أو المبلغ"
            className={cx(fieldClass, 'bg-surface ps-11 shadow-[var(--shadow-card)]')} />
        </div>
        {/* التصنيفات كشرائح قابلة للتمرير */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={!categoryId} onClick={() => setCategoryId('')}>الكل</Chip>
          {categories.filter((c) => !c.is_archived).map((c) => (
            <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)} color={c.color}>
              {c.name}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select label="الشخص" icon={User} value={memberId} onChange={setMemberId}
            options={[{ value: '', label: 'الجميع' }, ...members.map((m) => ({ value: m.user_id, label: m.display_name }))]} />
          {trips.length > 0 ? (
            <Select label="النوع" icon={AirplaneTilt} value={scope} onChange={setScope}
              options={[{ value: 'all', label: 'كل العمليات' }, { value: 'monthly', label: 'مصروف الشهر' }, { value: 'trips', label: 'الرحلات' }]} />
          ) : hasFilters ? (
            <Button variant="ghost" className="h-12" onClick={() => { setQuery(''); setCategoryId(''); setMemberId(''); setScope('all'); }}>
              <X className="size-4" weight="bold" /> مسح التصفية
            </Button>
          ) : <span />}
        </div>
      </div>

      {isPending ? <Spinner /> : filtered.length === 0
        ? <div className="surface"><EmptyState icon={hasFilters ? FunnelSimple : Receipt} title={hasFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد عمليات في هذه الفترة'}>
            {hasFilters ? 'جرّب تغيير كلمات البحث أو التصفية' : 'اضغط زر + لإضافة مصروف'}
          </EmptyState></div>
        : <ExpenseGroups expenses={filtered} categories={categories} tripNames={tripNames} />}
    </div>
  );
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cx('press inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium',
        active ? 'bg-panel text-panel-ink' : 'bg-surface text-ink-2 shadow-[var(--shadow-card)]')}>
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}
