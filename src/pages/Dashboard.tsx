import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AirplaneTilt, Alarm, ArrowDownRight, ArrowUpRight, Bell, CalendarCheck, CaretLeft, Receipt, Sparkle, Target } from '@phosphor-icons/react';
import { CategoryBreakdown, MonthlyBars, SpectrumBar } from '../components/Charts';
import { ExpenseRow } from '../components/ExpenseList';
import { CountBadge, useExpenseSheet } from '../components/Layout';
import { Logo } from '../components/Logo';
import {
  AnimatedAmount, Button, Callout, EmptyState, ListGroup, Meter, Money, MonthSwitcher, SectionTitle, Skeleton, SkeletonRows,
  Stagger, StaggerItem, cx,
} from '../components/ui';
import { useHousehold } from '../hooks/household';
import {
  useCategories, useMonthExpenses, useMonthlyTotals, useRecurring, useRecurringPayments, useRenewals, useTrips, useUnreadCount,
} from '../hooks/queries';
import { addDays, addMonths, daysInMonth, formatDayShort, formatMonth, lastMonths, monthOf, todayISO } from '../lib/dates';
import { sumHalalas } from '../lib/money';
import { recurringForMonth } from '../lib/recurring';
import { budgetStatus, byCategory, changeRatio, monthlySeries } from '../lib/stats';

const dayFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' });

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
  const { data: trips = [] } = useTrips();
  const { data: renewals = [] } = useRenewals();
  const unread = useUnreadCount();

  const openTrip = trips.find((t) => t.status === 'open');
  const soonRenewals = renewals.filter((r) => r.status === 'active' && r.due_date >= today && r.due_date <= addDays(today, r.remind_days));

  // مصاريف الرحلات منفصلة عن مصروف الشهر وميزانيته
  const all = expenses.data ?? [];
  const list = useMemo(() => all.filter((e) => !e.trip_id), [all]);
  const tripTotal = sumHalalas(all.filter((e) => e.trip_id).map((e) => e.amount));
  const total = sumHalalas(list.map((e) => e.amount));
  const slices = useMemo(() => byCategory(list, categories), [list, categories]);
  const series = monthlySeries(monthly.data ?? [], lastMonths(monthOf(today), 6));
  const previous = series.find((s) => s.month === addMonths(month, -1))?.total ?? 0;
  const change = changeRatio(total, previous);
  const budget = budgetStatus(total, household.monthly_budget, month, today);
  const unpaid = recurringForMonth(recurring.data ?? [], payments.data ?? [], month, today).filter((r) => r.status !== 'paid');
  const isCurrent = month === monthOf(today);
  const daysCounted = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(month);
  const perDay = daysCounted ? Math.round(total / daysCounted) : 0;
  const initials = me.display_name.trim().slice(0, 1);

  return (
    <div className="space-y-6 pt-5">
      {/* رأس الصفحة: التحية والتاريخ والإشعارات */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo className="size-10 md:hidden" />
          <div>
            <p className="text-xs text-muted">{dayFmt.format(new Date())}</p>
            <p className="text-[19px] font-semibold leading-tight">أهلاً {me.display_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/notifications" aria-label="الإشعارات"
            className="press relative flex size-11 items-center justify-center rounded-full bg-surface text-ink-2 shadow-[var(--shadow-card)]">
            <Bell className="size-5" weight={unread ? 'fill' : 'regular'} />
            {unread > 0 && <span className="absolute -end-0.5 -top-0.5"><CountBadge n={unread} /></span>}
          </Link>
          <Link to="/settings" aria-label="الإعدادات"
            className="press flex size-11 items-center justify-center rounded-full bg-brand-soft text-[15px] font-semibold text-brand">
            {initials}
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-start [&>*]:min-w-0">
        <div className="space-y-6">
          {/* لوحة الحبر: مصروف الشهر والميزانية */}
          <section className="panel p-6 shadow-[var(--shadow-dock)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-panel-muted">{isCurrent ? 'مصروف الشهر' : 'مصروف'}</p>
              <MonthSwitcher month={month} onChange={setMonth} tone="panel" />
            </div>

            {expenses.isPending ? <Skeleton className="mt-4 h-12 w-48 bg-white/10" /> : (
              <AnimatedAmount value={total} className="display mt-4 text-[44px] md:text-[52px]" />
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {change !== null && (
                <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium',
                  change > 0 ? 'bg-gold/15 text-gold' : 'bg-brand-bright/15 text-brand-bright')}>
                  {change > 0 ? <ArrowUpRight className="size-3.5" weight="bold" /> : <ArrowDownRight className="size-3.5" weight="bold" />}
                  {Math.abs(Math.round(change * 100))}% {change > 0 ? 'أكثر' : 'أقل'} من الشهر السابق
                </span>
              )}
              <span className="rounded-full bg-white/[.07] px-2.5 py-1 text-panel-muted">{list.length} عملية</span>
              {tripTotal > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[.07] px-2.5 py-1 text-panel-muted">
                  <AirplaneTilt className="size-3.5" /> <Money value={tripTotal} /> خارج الميزانية
                </span>
              )}
            </div>

            {budget.level === 'none' ? (
              <Link to="/settings" className="press mt-6 flex items-center gap-3 rounded-2xl bg-white/[.06] px-4 py-3.5 text-sm">
                <Target className="size-5 text-brand-bright" weight="duotone" />
                <span className="flex-1">حدّد ميزانية شهرية لتتابع المتبقي</span>
                <CaretLeft className="size-4 text-panel-muted" weight="bold" />
              </Link>
            ) : (
              <div className="mt-6">
                <Meter ratio={budget.ratio} segments={32} track="bg-white/10"
                  tone={budget.level === 'over' ? 'danger' : budget.level === 'warn' ? 'warn' : 'panel'} />
                <div className="mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-white/10 text-center">
                  <PanelStat label={budget.remaining! >= 0 ? 'المتبقي' : 'تجاوز'}
                    value={<Money value={Math.abs(budget.remaining!)} decimals="never" className={budget.level === 'over' ? 'text-danger' : ''} />} />
                  <PanelStat label="يومياً متاح" value={budget.dailyAllowance !== null ? <Money value={budget.dailyAllowance} decimals="never" /> : '—'} />
                  <PanelStat label="الميزانية" value={<Money value={budget.budget!} decimals="never" />} />
                </div>
              </div>
            )}
            {budget.level === 'none' && (
              <div className="mt-4 grid grid-cols-2 divide-x divide-x-reverse divide-white/10 text-center">
                <PanelStat label="متوسط اليوم" value={<Money value={perDay} decimals="never" />} />
                <PanelStat label="أكثر تصنيف" value={slices[0]?.category?.name ?? '—'} />
              </div>
            )}
          </section>

          {/* تنبيهات تحتاج انتباهك */}
          {(unpaid.length > 0 || openTrip || soonRenewals.length > 0) && (
            <Stagger className="space-y-2.5">
              {unpaid.length > 0 && (
                <StaggerItem>
                  <Link to="/recurring" className="press block">
                    <Callout icon={Alarm} tone="warn"
                      title={unpaid.length === 1 ? 'مصروف ثابت واحد لم يُدفع' : `${unpaid.length} مصاريف ثابتة لم تُدفع`}
                      trailing={<Money value={sumHalalas(unpaid.map((u) => u.item.amount))} className="text-[15px] font-semibold" />}>
                      {unpaid.slice(0, 3).map((u) => u.item.name).join('، ')}
                    </Callout>
                  </Link>
                </StaggerItem>
              )}
              {openTrip && (
                <StaggerItem>
                  <Link to={`/trips/${openTrip.id}`} className="press block">
                    <Callout icon={AirplaneTilt} tone="brand" title={openTrip.name}
                      trailing={<CaretLeft className="size-4 text-muted" weight="bold" />}>
                      رحلة مفتوحة منذ {formatDayShort(openTrip.started_on)}، مصاريفها خارج الشهر
                    </Callout>
                  </Link>
                </StaggerItem>
              )}
              {soonRenewals.length > 0 && (
                <StaggerItem>
                  <Link to="/renewals" className="press block">
                    <Callout icon={CalendarCheck} tone="gold" title={soonRenewals.map((r) => r.title).join('، ')}
                      trailing={<CaretLeft className="size-4 text-muted" weight="bold" />}>
                      أقرب موعد {formatDayShort(soonRenewals[0]!.due_date)}
                    </Callout>
                  </Link>
                </StaggerItem>
              )}
            </Stagger>
          )}

          {/* وين راحت الفلوس */}
          {expenses.isPending ? <SkeletonRows rows={4} /> : list.length === 0 ? (
            <div className="surface">
              <EmptyState icon={Receipt} title={`لا توجد مصروفات في ${formatMonth(month)}`}>
                سجّل أول مصروف، وتظهر هنا الإحصائيات.
                <div className="mt-5"><Button variant="brand" onClick={() => openSheet()}>إضافة مصروف</Button></div>
              </EmptyState>
            </div>
          ) : (
            <section className="surface p-5">
              <SectionTitle hint={`${slices.length} تصنيفات هذا الشهر`}
                action={<Link to="/expenses" className="text-[13px] font-medium text-brand">التفاصيل</Link>}>
                وين راحت الفلوس
              </SectionTitle>
              <SpectrumBar slices={slices} className="mb-4" />
              <CategoryBreakdown slices={slices} limit={6} />
            </section>
          )}
        </div>

        <div className="space-y-6">
          {/* قراءة الشهر */}
          <Link to="/insights" className="press surface group relative flex items-center gap-4 overflow-hidden p-5 [contain:paint]">
            <span className="absolute -top-10 start-3 size-24 rounded-full bg-gold/15" />
            <span className="relative flex size-11 items-center justify-center rounded-[14px] bg-panel text-gold">
              <Sparkle className="size-[22px]" weight="fill" />
            </span>
            <span className="relative flex-1">
              <span className="block text-[15px] font-semibold">قراءة الشهر</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">متى تصرف أكثر، المتكرر، والأعلى من المعتاد</span>
            </span>
            <CaretLeft className="relative size-4 text-muted transition-transform group-hover:-translate-x-1" weight="bold" />
          </Link>

          <section className="surface p-5">
            <SectionTitle hint="اضغط على شهر لعرضه">آخر 6 أشهر</SectionTitle>
            <MonthlyBars data={series} selected={month} onSelect={setMonth} />
          </section>

          {list.length > 0 && (
            <section>
              <SectionTitle action={<Link to="/expenses" className="inline-flex items-center gap-0.5 text-[13px] font-medium text-brand">الكل <CaretLeft className="size-3.5" weight="bold" /></Link>}>
                أحدث العمليات
              </SectionTitle>
              <ListGroup className="p-1.5">
                {all.slice(0, 6).map((e) => (
                  <ExpenseRow key={e.id} expense={e} category={categories.find((c) => c.id === e.category_id)}
                    tripName={trips.find((t) => t.id === e.trip_id)?.name} />
                ))}
              </ListGroup>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 px-2">
      <p className="text-[11px] text-panel-muted">{label}</p>
      <p className="mt-1 truncate text-[15px] font-semibold">{value}</p>
    </div>
  );
}
