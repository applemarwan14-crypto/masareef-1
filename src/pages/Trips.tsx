import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirplaneTilt, ArrowCounterClockwise, CaretLeft, CaretRight, Flag, PencilSimple, Plus } from '@phosphor-icons/react';
import { CategoryDonut } from '../components/Charts';
import { ExpenseGroups } from '../components/ExpenseList';
import { useExpenseSheet } from '../components/Layout';
import { Button, Card, CategoryIcon, ConfirmButton, EmptyState, Field, IconButton, Sheet, Spinner, cx } from '../components/ui';
import { useCategories, useDeleteTrip, useInvalidate, useSaveTrip, useTripExpenses, useTrips } from '../hooks/queries';
import { reopenTrip } from '../lib/api';
import { formatDayShort, todayISO } from '../lib/dates';
import { countryName, flag } from '../lib/labels';
import { formatSAR, parseAmount, sumHalalas, toInputValue } from '../lib/money';
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
    <div className="space-y-4 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الرحلات</h1>
        <Button variant="secondary" className="h-10 px-3 text-sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" weight="bold" /> رحلة جديدة
        </Button>
      </header>
      <p className="text-sm leading-relaxed text-muted">
        أول شراء من محل خارج السعودية يفتح رحلة تلقائياً، وأول شراء داخل السعودية أو 3 أيام بدون مشتريات من برا يقفلها.
        مصاريف الرحلة منفصلة عن مصروف الشهر وميزانيته.
      </p>

      {isPending ? <Spinner /> : trips.length === 0 ? (
        <EmptyState icon={AirplaneTilt} title="ما في رحلات بعد">رحلتكم الجاية تنفتح هنا تلقائياً من رسائل البنك.</EmptyState>
      ) : (
        <div className="space-y-2">
          {trips.map((t) => (
            <Link key={t.id} to={`/trips/${t.id}`}
              className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition active:opacity-80">
              <span className={cx('flex size-11 items-center justify-center rounded-2xl text-2xl', t.status === 'open' ? 'bg-brand-soft' : 'bg-surface-2')}>
                {flag(t.countries[0]) || <AirplaneTilt className="size-6 text-brand" weight="duotone" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{t.name}</span>
                  {t.status === 'open' && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] text-brand-ink">مفتوحة</span>}
                </span>
                <span className="text-xs text-muted">{tripDates(t)}{t.countries.length > 1 && ` · ${t.countries.map(flag).join(' ')}`}</span>
              </span>
              <CaretLeft className="size-4 text-muted" weight="bold" />
            </Link>
          ))}
        </div>
      )}

      <Sheet open={creating} onOpenChange={setCreating} title="رحلة جديدة">
        <TripForm onDone={() => setCreating(false)} />
      </Sheet>
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
    <div className="space-y-4 pt-4">
      <header className="flex items-center gap-2">
        <IconButton label="رجوع" onClick={() => navigate('/trips')}><CaretRight className="size-5" weight="bold" /></IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{trip.name}</h1>
          <p className="text-xs text-muted">{tripDates(trip)} · {trip.countries.map((c) => `${flag(c)} ${countryName(c)}`).join('، ')}</p>
        </div>
        <IconButton label="تعديل" onClick={() => setEditing(true)}><PencilSimple className="size-5" /></IconButton>
      </header>

      <section className="hero rounded-card p-5 shadow-lg shadow-brand/20">
        <p className="text-sm text-white/75">إجمالي الرحلة</p>
        <p className="num mt-1 text-4xl font-bold">{formatSAR(total)}</p>
        {fees > 0 && <p className="mt-1 text-xs text-white/75">منها رسوم بطاقات دولية <span className="num">{formatSAR(fees)}</span></p>}
        {trip.budget ? (
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs text-white/80">
              <span>{total <= trip.budget ? `باقي ${formatSAR(trip.budget - total)}` : `تجاوزتوا بـ ${formatSAR(total - trip.budget)}`}</span>
              <span>من {formatSAR(trip.budget)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
              <div className={cx('h-full rounded-full', ratio > 1 ? 'bg-[#FF8A7A]' : ratio >= 0.8 ? 'bg-gold' : 'bg-white')}
                style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="mt-4 rounded-2xl bg-white/12 px-4 py-2.5 text-sm font-medium">
            حدّد ميزانية للرحلة
          </button>
        )}
      </section>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => openSheet(undefined, { trip_id: trip.id })}>
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
                  <span className="num font-semibold">{formatSAR(s.total)}</span>
                  <span className="num w-9 text-end text-xs text-muted">{s.percent}%</span>
                </li>
              ))}
            </ul>
          </Card>
          {byCurrency.length > 0 && (
            <Card>
              <h2 className="mb-3 font-bold">حسب العملة</h2>
              <ul className="space-y-2 text-sm">
                {byCurrency.map(([cur, v]) => (
                  <li key={cur} className="flex justify-between"><span>{cur}</span><span className="num font-semibold">{formatSAR(v)}</span></li>
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
