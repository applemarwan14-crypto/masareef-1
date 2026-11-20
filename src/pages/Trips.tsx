import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirplaneTilt, ArrowCounterClockwise, CaretRight, Flag, PencilSimple, Plus } from '@phosphor-icons/react';
import { CategoryDonut } from '../components/Charts';
import { ExpenseGroups } from '../components/ExpenseList';
import { useExpenseSheet } from '../components/Layout';
import { Button, Card, CategoryIcon, ConfirmButton, EmptyState, Field, IconButton, Meter, Money, PageHeader, Sheet, Spinner, Stagger, StaggerItem, cx } from '../components/ui';
import { useCategories, useDeleteTrip, useInvalidate, useSaveTrip, useTripExpenses, useTrips } from '../hooks/queries';
import { reopenTrip } from '../lib/api';
import { formatDayShort, todayISO } from '../lib/dates';
import { countryName, flag } from '../lib/labels';
import { parseAmount, sumHalalas, toInputValue } from '../lib/money';
import { byCategory } from '../lib/stats';
import type { Trip } from '../lib/types';

export default function TripsPage() {
  const { id } = useParams();
  return id ? <TripDetail id={id} /> : <TripList />;
}

function tripDates(t: Trip) {
  const end = t.ended_on ?? (t.status === 'open' ? null : t.last_foreign_on);
  return `${formatDayShort(t.started_on)}${end ? ` – ${formatDayShort(end)}` : ' – الآن'}`;
}

function TripList() {
  const { data: trips = [], isPending } = useTrips();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader title="الرحلات" subtitle="تنفتح تلقائياً مع أول شراء من الخارج، ومصاريفها خارج ميزانية الشهر"
        actions={<Button variant="outline" className="h-10 px-4 text-[13px]" onClick={() => setCreating(true)}>
          <Plus className="size-4" weight="bold" /> رحلة</Button>} />

      {isPending ? <Spinner /> : trips.length === 0 ? (
        <div className="surface"><EmptyState icon={AirplaneTilt} title="ما في رحلات بعد">رحلتكم الجاية تنفتح هنا تلقائياً من رسائل البنك.</EmptyState></div>
      ) : (
        <Stagger className="space-y-3">
          {trips.map((t) => (
            <StaggerItem key={t.id}>
              <BoardingPass trip={t} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <Sheet open={creating} onOpenChange={setCreating} title="رحلة جديدة">
        <TripForm onDone={() => setCreating(false)} />
      </Sheet>
    </div>
  );
}

/** بطاقة الرحلة على شكل بطاقة صعود الطائرة */
function BoardingPass({ trip: t }: { trip: Trip }) {
  const open = t.status === 'open';
  return (
    <Link to={`/trips/${t.id}`} className={cx('press ticket block', open ? 'panel' : 'surface')} style={{ ['--notch-at' as string]: '66%' }}>
      <div className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="min-w-0">
          <p className={cx('text-[11px]', open ? 'text-panel-muted' : 'text-muted')}>{open ? 'رحلة مفتوحة' : 'رحلة منتهية'}</p>
          <p className="mt-1 truncate text-[19px] font-semibold">{t.name}</p>
        </div>
        <span className="text-[34px] leading-none">{t.countries.map(flag).slice(0, 3).join('') || '✈️'}</span>
      </div>
      <div className="mx-4 perforation opacity-60" />
      <div className="grid grid-cols-3 gap-2 p-5 pt-4 text-[11px]">
        <PassField label="من" value={formatDayShort(t.started_on)} dark={open} />
        <PassField label="إلى" value={t.ended_on ? formatDayShort(t.ended_on) : 'الآن'} dark={open} />
        <PassField label="الدول" value={t.countries.length ? t.countries.length : '—'} dark={open} />
      </div>
    </Link>
  );
}

function PassField({ label, value, dark }: { label: string; value: ReactNode; dark?: boolean }) {
  return (
    <div>
      <p className={dark ? 'text-panel-muted' : 'text-muted'}>{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold">{value}</p>
    </div>
  );
}

function TripDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const openSheet = useExpenseSheet();
  const invalidate = useInvalidate();
  const { data: trips = [] } = useTrips();
  const { data: categories = [] } = useCategories();
  const { data: expenses = [], isPending } = useTripExpenses(id);
  const save = useSaveTrip();
  const remove = useDeleteTrip();
  const [editing, setEditing] = useState(false);
  const trip = trips.find((t) => t.id === id);

  const total = sumHalalas(expenses.map((e) => e.amount)) + (trip?.archived_total ?? 0);
  const fees = sumHalalas(expenses.map((e) => e.fee_amount ?? 0));
  const slices = useMemo(() => byCategory(expenses, categories), [expenses, categories]);
  const byCurrency = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) if (e.original_currency) m.set(e.original_currency, (m.get(e.original_currency) ?? 0) + e.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  if (!trip) return trips.length ? <EmptyState title="الرحلة غير موجودة" /> : <Spinner />;
  const ratio = trip.budget ? total / trip.budget : 0;

  async function toggle() {
    try {
      if (trip!.status === 'open') {
        await save.mutateAsync({ id: trip!.id, input: { status: 'closed', ended_on: trip!.last_foreign_on ?? todayISO(), auto: false } });
        toast.success('قفلنا الرحلة');
      } else {
        await reopenTrip(trip!.id);
        await invalidate('trips');
        toast.success('فتحنا الرحلة من جديد');
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2 pt-4">
        <IconButton label="رجوع" onClick={() => navigate('/trips')}><CaretRight className="size-5" weight="bold" /></IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate display text-[28px]">{trip.name}</h1>
          <p className="text-xs text-muted">{tripDates(trip)} · {trip.countries.map((c) => `${flag(c)} ${countryName(c)}`).join('، ')}</p>
        </div>
        <IconButton label="تعديل" onClick={() => setEditing(true)}><PencilSimple className="size-5" /></IconButton>
      </header>

      <section className="panel p-6">
        <p className="text-[13px] text-panel-muted">إجمالي الرحلة</p>
        <Money value={total} className="display mt-3 text-[42px]" />
        {fees > 0 && <p className="mt-2 text-xs text-panel-muted">منها رسوم بطاقات دولية <Money value={fees} /></p>}
        {trip.budget ? (
          <div className="mt-6">
            <Meter ratio={ratio} segments={28} track="bg-white/10" tone={ratio > 1 ? 'danger' : ratio >= 0.8 ? 'warn' : 'panel'} />
            <div className="mt-3 flex justify-between text-xs text-panel-muted">
              <span>{total <= trip.budget ? <>باقي <Money value={trip.budget - total} /></> : <>تجاوزت بـ <Money value={total - trip.budget} /></>}</span>
              <span>من <Money value={trip.budget} /></span>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="press mt-5 rounded-full bg-white/[.08] px-4 py-2.5 text-[13px] font-medium">
            حدّد ميزانية للرحلة
          </button>
        )}
      </section>

      <div className="flex gap-2">
        <Button variant="brand" className="flex-1" onClick={() => openSheet(undefined, { trip_id: trip.id })}>
          <Plus className="size-5" weight="bold" /> مصروف للرحلة
        </Button>
        <Button variant="secondary" onClick={toggle} loading={save.isPending}>
          {trip.status === 'open' ? <><Flag className="size-5" /> قفل الرحلة</> : <><ArrowCounterClockwise className="size-5" /> إعادة فتح</>}
        </Button>
      </div>

      {expenses.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CategoryDonut slices={slices} total={sumHalalas(expenses.map((e) => e.amount))} />
            <ul className="mt-4 space-y-2.5">
              {slices.map((s) => (
                <li key={s.categoryId} className="flex items-center gap-3 text-sm">
                  <CategoryIcon category={s.category} size="sm" />
                  <span className="flex-1 font-medium">{s.category?.name}</span>
                  <span className="num font-semibold"><Money value={s.total} /></span>
                  <span className="num w-9 text-end text-xs text-muted">{s.percent}%</span>
                </li>
              ))}
            </ul>
          </Card>
          {byCurrency.length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold">حسب العملة</h2>
              <ul className="space-y-2 text-sm">
                {byCurrency.map(([cur, v]) => (
                  <li key={cur} className="flex justify-between"><span>{cur}</span><span className="num font-semibold"><Money value={v} /></span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {isPending ? <Spinner /> : expenses.length === 0
        ? <EmptyState icon={AirplaneTilt} title="ما في مصاريف للرحلة بعد" />
        : <ExpenseGroups expenses={expenses} categories={categories} />}

      <Sheet open={editing} onOpenChange={setEditing} title="تعديل الرحلة">
        <TripForm trip={trip} onDone={() => setEditing(false)} />
        <div className="pb-4">
          <ConfirmButton className="w-full" loading={remove.isPending} confirmText="تأكيد: المصاريف ترجع لمصروف الشهر"
            onConfirm={() => remove.mutate(trip.id, { onSuccess: () => navigate('/trips') })}>حذف الرحلة</ConfirmButton>
        </div>
      </Sheet>
    </div>
  );
}

function TripForm({ trip, onDone }: { trip?: Trip; onDone: () => void }) {
  const navigate = useNavigate();
  const save = useSaveTrip();
  const { data: trips = [] } = useTrips();
  const [name, setName] = useState(trip?.name ?? '');
  const [budget, setBudget] = useState(trip?.budget ? toInputValue(trip.budget) : '');
  const [start, setStart] = useState(trip?.started_on ?? todayISO());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('اكتب اسم الرحلة');
    if (!trip && trips.some((t) => t.status === 'open')) return toast.error('في رحلة مفتوحة، اقفلها أولاً');
    const b = budget.trim() ? parseAmount(budget) : null;
    if (budget.trim() && !b) return toast.error('أدخل ميزانية صحيحة');
    const saved = await save.mutateAsync({ id: trip?.id, input: { name: name.trim(), budget: b, started_on: start } }).catch(() => null);
    if (!saved) return;
    toast.success('تم الحفظ');
    onDone();
    if (!trip) navigate(`/trips/${saved.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Field label="الاسم" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="رحلة جورجيا" autoFocus={!trip} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="الميزانية (ر.س)" inputMode="decimal" dir="ltr" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="اختياري" />
        <Field label="البداية" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" loading={save.isPending}>{trip ? 'حفظ' : 'إنشاء'}</Button>
    </form>
  );
}
