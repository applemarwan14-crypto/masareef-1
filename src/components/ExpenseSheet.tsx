import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AirplaneTilt, ArrowSquareOut, Camera, CheckCircle, CreditCard, CurrencyCircleDollar, ShieldCheck, Trash } from '@phosphor-icons/react';
import { useCards, useCategories, useDeleteExpense, useInvalidate, useSaveExpense, useTrips } from '../hooks/queries';
import { useHousehold, useMemberName } from '../hooks/household';
import { addWarranty, applyRuleToPast, fxRate, receiptUrl } from '../lib/api';
import { addDays, formatDayLabel, todayISO } from '../lib/dates';
import { CARD_TYPES, CURRENCIES, PAYMENT_METHODS, countryName, flag } from '../lib/labels';
import { formatAmount, formatSAR, parseAmount, toInputValue } from '../lib/money';
import type { Expense } from '../lib/types';
import { Button, CategoryIcon, ConfirmButton, Select, Sheet, cx } from './ui';

export function ExpenseSheet({ open, onOpenChange, expense, preset }: {
  open: boolean; onOpenChange: (o: boolean) => void; expense?: Expense; preset?: Partial<Expense>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={expense ? 'تعديل المصروف' : 'مصروف جديد'}>
      <ExpenseForm key={expense?.id ?? `new-${open}`} expense={expense} preset={preset} onDone={() => onOpenChange(false)} />
    </Sheet>
  );
}

function ExpenseForm({ expense, preset, onDone }: { expense?: Expense; preset?: Partial<Expense>; onDone: () => void }) {
  const today = todayISO();
  const { me } = useHousehold();
  const { data: categories = [] } = useCategories();
  const { data: cards = [] } = useCards();
  const { data: trips = [] } = useTrips();
  const save = useSaveExpense();
  const remove = useDeleteExpense();
  const invalidate = useInvalidate();
  const memberName = useMemberName();
  const fileRef = useRef<HTMLInputElement>(null);
  const start = expense ?? preset;

  const [amountText, setAmountText] = useState(start?.amount ? toInputValue(start.amount) : '');
  const [categoryId, setCategoryId] = useState(start?.category_id ?? '');
  const [date, setDate] = useState(start?.expense_date ?? today);
  const [description, setDescription] = useState(start?.description ?? '');
  const [merchant, setMerchant] = useState(start?.merchant ?? '');
  const [cardId, setCardId] = useState(start?.card_id ?? '');
  const [tripId, setTripId] = useState(start?.trip_id ?? '');
  const [currency, setCurrency] = useState('SAR');
  const [rate, setRate] = useState<number | null>(null);
  const [device, setDevice] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);

  // العضو يعدّل ما أضافه هو فقط، والمنشئ يعدّل الكل
  const readOnly = Boolean(expense && expense.created_by !== me.user_id && me.role !== 'owner');
  const foreign = !expense && currency !== 'SAR';
  const entered = parseAmount(amountText);
  const amount = foreign ? (entered && rate ? Math.round(entered * rate) : null) : entered;
  const visible = useMemo(
    () => categories.filter((c) => !c.is_archived || c.id === expense?.category_id),
    [categories, expense?.category_id],
  );
  const openTrip = trips.find((t) => t.status === 'open');
  const tripChoices = trips.filter((t) => t.status === 'open' || t.id === start?.trip_id || t.started_on >= addDays(today, -60));
  const card = cards.find((c) => c.id === cardId);

  // سعر صرف اليوم للعملة الأجنبية، واقتراح الرحلة المفتوحة
  useEffect(() => {
    if (!foreign) return setRate(null);
    let alive = true;
    setRate(null);
    fxRate(currency).then((r) => alive && setRate(r.rate)).catch((e: Error) => alive && toast.error(e.message));
    if (openTrip && !tripId) setTripId(openTrip.id);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (readOnly) return;
    if (!amount) return toast.error(foreign && !rate ? 'انتظر سعر الصرف' : 'أدخل مبلغاً صحيحاً');
    if (!categoryId) return toast.error('اختر التصنيف');
    if (date > today) return toast.error('لا يمكن تسجيل مصروف بتاريخ مستقبلي');
    const saved = await save.mutateAsync({
      id: expense?.id,
      receipt,
      input: {
        amount, category_id: categoryId, expense_date: date, description: description.trim() || null,
        merchant: merchant.trim() || null, card_id: cardId || null, trip_id: tripId || null,
        ...(foreign ? { original_amount: entered!, original_currency: currency, fx_rate: rate } : {}),
      },
    }).catch(() => null);
    if (!saved) return;

    if (device && !expense) await addWarranty(saved.id).then(() => invalidate('renewals')).catch(() => {});
    const learned = expense && expense.merchant && categoryId !== expense.category_id;
    if (learned) {
      const cat = categories.find((c) => c.id === categoryId)?.name;
      const m = expense.merchant!;
      toast.success(`حفظت التعديل، والمرات الجاية «${m}» يتصنّف ${cat}`, {
        action: {
          label: 'طبّقه على السابقة',
          onClick: () => applyRuleToPast(m)
            .then((n) => { toast.success(n ? `تم نقل ${n} عملية` : 'ما في عمليات سابقة تحتاج نقل'); invalidate('expenses', 'monthly'); })
            .catch((err: Error) => toast.error(err.message)),
        },
        duration: 8000,
      });
    } else {
      toast.success(expense ? 'تم حفظ التعديل' : `تمت إضافة ${formatSAR(saved.amount)}`);
    }
    onDone();
  }

  async function openReceipt() {
    if (!expense?.receipt_path) return;
    const win = window.open('', '_blank'); // تُفتح مباشرة حتى لا يحجبها المتصفح
    try {
      const url = await receiptUrl(expense.receipt_path);
      if (win) win.location.href = url;
    } catch (err) {
      win?.close();
      toast.error((err as Error).message);
    }
  }

  const dateChips = [today, addDays(today, -1)];
  const inputClass = 'h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-brand focus:ring-4 focus:ring-brand/10';

  return (
    <form onSubmit={submit} className="space-y-5 pb-2">
      {readOnly && (
        <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm">أضافه {memberName(expense!.created_by)}. التعديل لصاحب العملية أو منشئ العائلة.</p>
      )}

      {/* المبلغ: أكبر عنصر في الشاشة لأنه أول ما يُكتب */}
      <div className="rounded-3xl bg-surface-2 px-4 py-5 text-center">
        <label className="flex items-baseline justify-center gap-2" dir="ltr">
          <span className="sr-only">المبلغ</span>
          <input
            autoFocus={!expense}
            inputMode="decimal"
            enterKeyHint="done"
            placeholder="0"
            value={amountText}
            disabled={readOnly}
            onChange={(e) => setAmountText(e.target.value)}
            className={cx(
              'num w-full max-w-[12ch] bg-transparent text-center text-5xl font-bold tracking-tight outline-none placeholder:text-line',
              touched && !amount && 'text-danger',
            )}
          />
          {expense ? <span className="text-lg font-semibold text-muted">ر.س</span> : (
            <select aria-label="العملة" value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="rounded-xl bg-transparent text-lg font-semibold text-muted outline-none">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c === 'SAR' ? 'ر.س' : c}</option>)}
            </select>
          )}
        </label>
        {foreign && (
          <p className="mt-2 text-sm text-muted">
            {rate ? <>≈ <span className="num font-semibold text-ink">{amount ? formatSAR(amount) : '—'}</span>
              {' '}بسعر اليوم (<span className="num" dir="ltr">1 {currency} = {rate.toFixed(rate < 0.1 ? 4 : 2)}</span>)
              {card?.intl_fee_bps ? ` + رسوم البطاقة ${card.intl_fee_bps / 100}%` : ''}</> : 'جارٍ جلب سعر الصرف…'}
          </p>
        )}
        {expense?.original_currency && (
          <p className="mt-2 text-sm text-muted">
            <CurrencyCircleDollar className="me-1 inline size-4" />
            <span className="num">{formatAmount(expense.original_amount!)} {expense.original_currency}</span>
            {expense.fee_amount ? <> + رسوم <span className="num">{formatSAR(expense.fee_amount)}</span></> : null}
          </p>
        )}
      </div>

      <fieldset disabled={readOnly}>
        <legend className="mb-2 text-sm font-medium text-muted">التصنيف</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {visible.map((c) => (
            <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} aria-pressed={categoryId === c.id}
              className={cx(
                'flex flex-col items-center gap-1.5 rounded-2xl border-2 px-1 py-2.5 text-center text-xs font-semibold leading-tight transition active:scale-95',
                categoryId === c.id ? 'border-brand bg-brand-soft text-brand' : 'border-transparent bg-surface-2 hover:border-line',
              )}>
              <CategoryIcon category={c} size="sm" />
              <span className="line-clamp-2">{c.name}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        {dateChips.map((d) => (
          <button key={d} type="button" disabled={readOnly} onClick={() => setDate(d)}
            className={cx('h-10 rounded-full px-4 text-sm font-semibold transition', date === d ? 'bg-ink text-bg' : 'bg-surface-2')}>
            {formatDayLabel(d, today)}
          </button>
        ))}
        <label className="relative">
          <span className="sr-only">تاريخ آخر</span>
          <input type="date" value={date} max={today} disabled={readOnly} onChange={(e) => e.target.value && setDate(e.target.value)}
            className={cx('h-10 rounded-full px-4 text-base', !dateChips.includes(date) ? 'bg-ink text-bg' : 'bg-surface-2')} />
        </label>
      </div>

      {(expense?.merchant || expense?.source === 'sms') && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-muted">المتجر</span>
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={80} disabled={readOnly} className={cx(inputClass, 'w-full')} />
        </label>
      )}

      <div className="flex gap-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          disabled={readOnly}
          placeholder="وصف (اختياري): الدانوب، فاتورة الكهرباء…"
          className={inputClass}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={readOnly}
          aria-label={receipt ? 'تم إرفاق الفاتورة' : 'إرفاق صورة الفاتورة'}
          className={cx('flex size-12 shrink-0 items-center justify-center rounded-2xl', receipt ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-muted')}>
          {receipt ? <CheckCircle className="size-6" weight="fill" /> : <Camera className="size-6" weight="duotone" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
      </div>

      {(cards.length > 0 || tripChoices.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          {cards.length > 0 && (
            <Select label="البطاقة" icon={CreditCard} value={cardId} onChange={setCardId}
              options={[{ value: '', label: 'بدون بطاقة' }, ...cards.map((c) => ({
                value: c.id, label: c.nickname || `${c.bank || CARD_TYPES[c.card_type]} ••${c.last4}`,
              }))]} />
          )}
          {tripChoices.length > 0 && (
            <Select label="الرحلة" icon={AirplaneTilt} value={tripId} onChange={setTripId}
              options={[{ value: '', label: 'مصروف الشهر' }, ...tripChoices.map((t) => ({ value: t.id, label: t.name }))]} />
          )}
        </div>
      )}

      {!expense && amount !== null && amount >= 30000 && (
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <span className="flex items-center gap-3">
            <ShieldCheck className="size-6 text-brand" weight="duotone" />
            <span>
              <span className="block font-medium">جهاز؟</span>
              <span className="text-xs text-muted">نسجّل له ضمان سنتين وننبهك قبل ما ينتهي</span>
            </span>
          </span>
          <input type="checkbox" checked={device} onChange={(e) => setDevice(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
        </label>
      )}

      {expense && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span className="flex flex-wrap items-center gap-x-2">
            <span>أضافه {memberName(expense.created_by)}</span>
            {expense.source === 'sms' && <span>· من رسالة {expense.bank ?? 'البنك'}</span>}
            {expense.payment_method && <span>· {PAYMENT_METHODS[expense.payment_method]}</span>}
            {expense.country && expense.country !== 'SA' && <span>· {flag(expense.country)} {countryName(expense.country)}</span>}
          </span>
          {expense.receipt_path && (
            <button type="button" onClick={openReceipt} className="inline-flex items-center gap-1 font-medium text-brand">
              <ArrowSquareOut className="size-4" weight="bold" /> عرض الفاتورة
            </button>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending} className="flex-1">
            {expense ? 'حفظ التعديل' : amount ? `إضافة ${formatSAR(amount)}` : 'إضافة'}
          </Button>
          {expense && (
            <ConfirmButton loading={remove.isPending} confirmText="تأكيد الحذف"
              onConfirm={() => remove.mutate(expense, { onSuccess: onDone })}>
              <Trash className="size-5" weight="bold" /><span className="sr-only">حذف</span>
            </ConfirmButton>
          )}
        </div>
      )}
      {expense?.recurring_id && (
        <p className="text-xs text-muted">هذه دفعة مصروف ثابت. حذفها يعيد حالته إلى «غير مدفوع» لهذا الشهر.</p>
      )}
    </form>
  );
}
