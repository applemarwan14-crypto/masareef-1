import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Car, CalendarCheck, CheckCircle, IdentificationCard, House, MagicWand, Plus, ShieldCheck, Television, Umbrella,
  type Icon,
} from '@phosphor-icons/react';
import { Button, ConfirmButton, EmptyState, Field, Select, Sheet, Spinner, cx } from '../components/ui';
import { useDeleteRenewal, useRenewals, useSaveRenewal } from '../hooks/queries';
import { parseRenewalText, type ParsedRenewalText } from '../lib/api';
import { formatDayShort, todayISO } from '../lib/dates';
import { RENEWAL_KINDS } from '../lib/labels';
import { formatSAR, parseAmount, toInputValue } from '../lib/money';
import type { Renewal, RenewalKind } from '../lib/types';

const KIND_ICON: Record<RenewalKind, Icon> = {
  insurance: Umbrella, istimara: Car, license: IdentificationCard, passport: IdentificationCard, iqama: IdentificationCard,
  national_id: IdentificationCard, subscription: Television, rent: House, warranty: ShieldCheck, other: CalendarCheck,
};

const hijriFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const hijri = (d: string) => hijriFmt.format(new Date(`${d}T00:00:00Z`));
const daysLeft = (d: string, today: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);

function leftLabel(n: number) {
  if (n < 0) return `انتهى قبل ${-n} يوم`;
  if (n === 0) return 'اليوم';
  if (n === 1) return 'بكرة';
  if (n < 60) return `بعد ${n} يوم`;
  return `بعد ${Math.round(n / 30)} شهر`;
}

export default function RenewalsPage() {
  const today = todayISO();
  const { data = [], isPending } = useRenewals();
  const [editing, setEditing] = useState<{ open: boolean; item?: Partial<Renewal> & { id?: string } }>({ open: false });
  const [showDone, setShowDone] = useState(false);
  const active = data.filter((r) => r.status === 'active');
  const done = data.filter((r) => r.status !== 'active');

  return (
    <div className="space-y-4 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">التجديدات والضمانات</h1>
        <Button variant="secondary" className="h-10 px-3 text-sm" onClick={() => setEditing({ open: true })}>
          <Plus className="size-4" weight="bold" /> إضافة
        </Button>
      </header>

      <QuickAdd onParsed={(p) => setEditing({ open: true, item: {
        kind: p.kind, title: p.title, due_date: p.due_date ?? undefined, person: p.person, notes: p.notes,
        amount: p.amount ? Math.round(p.amount * 100) : null, source: 'text',
      } })} />

      {isPending ? <Spinner /> : active.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="ما في تجديدات قريبة">
          تنضاف تلقائياً من رسائل البنك وأبشر، وكل جهاز تشترونه بـ 300 ر.س أو أكثر نسجّل له ضمان سنتين.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {active.map((r) => <RenewalRow key={r.id} r={r} today={today} onOpen={() => setEditing({ open: true, item: r })} />)}
        </ul>
      )}

      {done.length > 0 && (
        <button type="button" onClick={() => setShowDone(!showDone)} className="text-sm font-medium text-brand">
          {showDone ? 'إخفاء' : `عرض المنتهية (${done.length})`}
        </button>
      )}
      {showDone && (
        <ul className="space-y-2 opacity-60">
          {done.map((r) => <RenewalRow key={r.id} r={r} today={today} onOpen={() => setEditing({ open: true, item: r })} />)}
        </ul>
      )}

      <Sheet open={editing.open} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))}
        title={editing.item?.id ? 'تعديل' : 'تجديد جديد'}>
        <RenewalForm key={editing.item?.id ?? JSON.stringify(editing.item ?? {})} item={editing.item} onDone={() => setEditing({ open: false })} />
      </Sheet>
    </div>
  );
}

function RenewalRow({ r, today, onOpen }: { r: Renewal; today: string; onOpen: () => void }) {
  const Glyph = KIND_ICON[r.kind];
  const n = daysLeft(r.due_date, today);
  const urgent = r.status === 'active' && n <= r.remind_days;
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-card bg-surface p-3.5 text-start shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-2xl', urgent ? 'bg-warn/15 text-warn' : 'bg-brand-soft text-brand')}>
          <Glyph className="size-6" weight="duotone" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{r.title}{r.person && <span className="font-normal text-muted"> · {r.person}</span>}</span>
          <span className="text-xs text-muted">{formatDayShort(r.due_date)} · {hijri(r.due_date)}</span>
        </span>
        <span className="shrink-0 text-end">
          <span className={cx('block text-sm font-semibold', n < 0 ? 'text-danger' : urgent ? 'text-warn' : 'text-muted')}>
            {r.status === 'done' ? 'تم' : leftLabel(n)}
          </span>
          {r.amount && <span className="num text-xs text-muted">{formatSAR(r.amount)}</span>}
        </span>
      </button>
    </li>
  );
}

/** «تأمين السيارة ينتهي ١٥ رمضان» → نموذج جاهز */
function QuickAdd({ onParsed }: { onParsed: (p: ParsedRenewalText) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const p = await parseRenewalText(text.trim());
      if (!p.due_date) toast.warning('ما فهمت التاريخ، اختره من النموذج');
      onParsed(p);
      setText('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
        placeholder="اكتب عادي: إقامة العاملة تنتهي ١٠ شوال ١٤٤٧"
        className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
      <Button type="submit" loading={busy} disabled={!text.trim()} aria-label="فهم النص">
        <MagicWand className="size-5" weight="duotone" />
      </Button>
    </form>
  );
}

function RenewalForm({ item, onDone }: { item?: Partial<Renewal> & { id?: string }; onDone: () => void }) {
  const save = useSaveRenewal();
  const remove = useDeleteRenewal();
  const [kind, setKind] = useState<RenewalKind>(item?.kind ?? 'other');
  const [title, setTitle] = useState(item?.title ?? '');
  const [due, setDue] = useState(item?.due_date ?? '');
  const [person, setPerson] = useState(item?.person ?? '');
  const [amount, setAmount] = useState(item?.amount ? toInputValue(item.amount) : '');
  const [remind, setRemind] = useState(item?.remind_days != null ? String(item.remind_days) : '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error('اكتب العنوان');
    if (!due) return toast.error('اختر التاريخ');
    const a = amount.trim() ? parseAmount(amount) : null;
    await save.mutateAsync({
      id: item?.id,
      input: {
        kind, title: title.trim(), due_date: due, person: person.trim() || null, amount: a,
        ...(remind ? { remind_days: Number(remind) } : {}),
        ...(item?.id ? {} : { source: item?.source ?? 'manual' }),
      },
    }).then(() => { toast.success('تم الحفظ'); onDone(); }).catch(() => {});
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Select label="النوع" showLabel value={kind} onChange={setKind}
        options={Object.entries(RENEWAL_KINDS).map(([value, label]) => ({ value: value as RenewalKind, label }))} />
      <Field label="العنوان" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="تأمين السيارة" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="التاريخ" type="date" value={due} onChange={(e) => setDue(e.target.value)} hint={due ? hijri(due) : undefined} />
        <Field label="لمين؟" value={person} maxLength={40} onChange={(e) => setPerson(e.target.value)} placeholder="اختياري" />
        <Field label="التكلفة (ر.س)" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="اختياري" />
        <Field label="ننبهك قبل (يوم)" inputMode="numeric" dir="ltr" value={remind} onChange={(e) => setRemind(e.target.value.replace(/\D/g, ''))}
          placeholder={['passport', 'iqama', 'national_id', 'license', 'istimara'].includes(kind) ? '30' : kind === 'warranty' ? '14' : '7'} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" loading={save.isPending}>حفظ</Button>
        {item?.id && item.status === 'active' && (
          <Button type="button" variant="secondary" onClick={() =>
            save.mutate({ id: item.id, input: { kind, title, due_date: due, status: 'done' } }, { onSuccess: () => { toast.success('تم التجديد 👍'); onDone(); } })}>
            <CheckCircle className="size-5" /> جدّدته
          </Button>
        )}
        {item?.id && (
          <ConfirmButton loading={remove.isPending} confirmText="تأكيد" onConfirm={() => remove.mutate(item.id!, { onSuccess: onDone })}>حذف</ConfirmButton>
        )}
      </div>
    </form>
  );
}
