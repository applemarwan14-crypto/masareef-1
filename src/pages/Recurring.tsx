import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArrowCounterClockwise, CheckCircle, Plus, Repeat } from '@phosphor-icons/react';
import {
  Button, ConfirmButton, EmptyState, Field, Meter, Money, MonthSwitcher, PageHeader, SectionTitle, Select, Sheet, Spinner, Stagger,
  StaggerItem, Toggle, cx,
} from '../components/ui';
import {
  useCategories, useDeleteExpense, useDeleteRecurring, useMarkPaid, useRecurring, useRecurringPayments, useSaveRecurring,
} from '../hooks/queries';
import { formatDayShort, monthOf, todayISO } from '../lib/dates';
import { parseAmount, sumHalalas, toInputValue } from '../lib/money';
import { recurringForMonth, type RecurringRow } from '../lib/recurring';
import type { Category, Recurring } from '../lib/types';

export default function RecurringPage() {
  const today = todayISO();
  const [month, setMonth] = useState(monthOf(today));
  const [editing, setEditing] = useState<{ open: boolean; item?: Recurring }>({ open: false });

  const { data: categories = [] } = useCategories();
  const recurring = useRecurring();
  const payments = useRecurringPayments(month);
  const rows = recurringForMonth(recurring.data ?? [], payments.data ?? [], month, today);

  const total = sumHalalas(rows.map((r) => r.item.amount));
  const paid = sumHalalas(rows.filter((r) => r.payment).map((r) => r.payment!.amount));
  const paidCount = rows.filter((r) => r.payment).length;
  const pending = rows.filter((r) => !r.payment);
  const done = rows.filter((r) => r.payment);

  return (
    <div className="space-y-5">
      <PageHeader title="الثابتة" subtitle="رواتب، فواتير، اشتراكات: تُسجَّل مرة، وتدفعها كل شهر بضغطة"
        actions={<MonthSwitcher month={month} onChange={setMonth} />} />

      {/* لوحة التقدم: كم دفعت من التزامات الشهر */}
      <section className="panel p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[13px] text-panel-muted">مدفوع هذا الشهر</p>
            <Money value={paid} className="display mt-2 text-[36px]" />
          </div>
          <div className="text-end">
            <p className="text-[13px] text-panel-muted">من</p>
            <Money value={total} className="mt-2 text-[17px] font-medium text-panel-muted" />
          </div>
        </div>
        <Meter ratio={total ? paid / total : 0} segments={Math.max(rows.length, 1)} track="bg-white/10" tone="panel" className="mt-5 h-2" />
        <p className="mt-3 text-xs text-panel-muted">{paidCount} من {rows.length} مدفوعة{total - paid > 0 && <> · باقي <Money value={total - paid} /></>}</p>
      </section>

      {recurring.isPending || payments.isPending ? <Spinner /> : rows.length === 0 ? (
        <div className="surface"><EmptyState icon={Repeat} title="لا توجد مصاريف ثابتة بعد">
          أضف رواتب العمالة والفواتير والاشتراكات مرة واحدة، ثم سجّل دفعها كل شهر بضغطة.
        </EmptyState></div>
      ) : (<>
        {pending.length > 0 && (
          <section>
            <SectionTitle hint="مرتبة حسب يوم الاستحقاق">بانتظار الدفع</SectionTitle>
            <Stagger className="space-y-2.5">
              {pending.map((row) => (
                <StaggerItem key={row.item.id}>
                  <RecurringItem row={row} month={month} today={today}
                    category={categories.find((c) => c.id === row.item.category_id)}
                    onEdit={() => setEditing({ open: true, item: row.item })} />
                </StaggerItem>
              ))}
            </Stagger>
          </section>
        )}
        {done.length > 0 && (
          <section>
            <SectionTitle>تم دفعها</SectionTitle>
            <div className="space-y-2.5">
              {done.map((row) => (
                <RecurringItem key={row.item.id} row={row} month={month} today={today}
                  category={categories.find((c) => c.id === row.item.category_id)}
                  onEdit={() => setEditing({ open: true, item: row.item })} />
              ))}
            </div>
          </section>
        )}
      </>)}

      <Button variant="outline" className="w-full" onClick={() => setEditing({ open: true })}>
        <Plus className="size-[18px]" weight="bold" /> مصروف ثابت جديد
      </Button>

      <Sheet open={editing.open} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))}
        title={editing.item ? 'تعديل المصروف الثابت' : 'مصروف ثابت جديد'}>
        <RecurringForm key={editing.item?.id ?? 'new'} item={editing.item} onDone={() => setEditing({ open: false })} />
      </Sheet>
    </div>
  );
}

const monthShort = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'short', timeZone: 'UTC' });

/** بطاقة فاتورة: ورقة تقويم بيوم الاستحقاق، ثم الاسم والمبلغ وزر الدفع */
function RecurringItem({ row, month, today, category, onEdit }: {
  row: RecurringRow; month: string; today: string; category?: Category; onEdit: () => void;
}) {
  const markPaid = useMarkPaid();
  const undo = useDeleteExpense();
  const { item, payment, status, dueDate } = row;
  // الشهر الحالي: تاريخ اليوم. شهر سابق: تاريخ الاستحقاق.
  const payDate = monthOf(today) === month ? today : dueDate;
  const overdue = status === 'overdue';

  return (
    <div className={cx('surface flex items-center gap-3.5 p-3 pe-3.5', payment && 'opacity-75')}>
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3.5 text-start">
        <span className={cx('flex w-12 shrink-0 flex-col items-center overflow-hidden rounded-[14px] border',
          overdue ? 'border-danger/30' : 'border-line')}>
          <span className={cx('w-full py-0.5 text-center text-[10px] font-medium',
            payment ? 'bg-brand text-brand-ink' : overdue ? 'bg-danger text-white' : 'bg-panel text-panel-ink')}>
            {monthShort.format(new Date(`${dueDate}T00:00:00Z`))}
          </span>
          <span className="num py-1 text-[18px] font-semibold leading-tight">{Number(dueDate.slice(8, 10))}</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">{item.name}</span>
          <span className={cx('mt-0.5 flex items-center gap-1.5 text-xs', overdue ? 'text-danger' : 'text-muted')}>
            {category && <span className="size-1.5 rounded-full" style={{ background: category.color }} />}
            {payment ? `دُفع ${formatDayShort(payment.expense_date)}` : overdue ? 'متأخر' : category?.name}
          </span>
          <Money value={payment?.amount ?? item.amount} className="mt-1 text-[15px] font-semibold" />
        </span>
      </button>
      {payment ? (
        <ConfirmButton className="h-10 gap-1 bg-brand-soft px-3.5 text-[13px] text-brand" confirmText="إلغاء الدفع؟" loading={undo.isPending}
          onConfirm={() => undo.mutate(payment)}>
          <CheckCircle className="size-[18px]" weight="fill" /> مدفوع <ArrowCounterClockwise className="size-3 opacity-60" weight="bold" />
        </ConfirmButton>
      ) : (
        <Button variant={overdue ? 'primary' : 'outline'} className="h-10 px-4 text-[13px]" loading={markPaid.isPending}
          onClick={() => markPaid.mutate(
            { recurringId: item.id, period: month, date: payDate },
            { onSuccess: () => toast.success(`تم تسجيل دفع ${item.name}`) },
          )}>
          ادفع
        </Button>
      )}
    </div>
  );
}

function RecurringForm({ item, onDone }: { item?: Recurring; onDone: () => void }) {
  const { data: categories = [] } = useCategories();
  const save = useSaveRecurring();
  const remove = useDeleteRecurring();
  const [name, setName] = useState(item?.name ?? '');
  const [amountText, setAmountText] = useState(item ? toInputValue(item.amount) : '');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '');
  const [day, setDay] = useState(String(item?.day_of_month ?? 1));
  const [active, setActive] = useState(item?.is_active ?? true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(amountText);
    const d = Number(day);
    if (!name.trim()) return toast.error('أدخل اسم المصروف');
    if (!amount) return toast.error('أدخل مبلغاً صحيحاً');
    if (!categoryId) return toast.error('اختر التصنيف');
    if (!(d >= 1 && d <= 31)) return toast.error('يوم الاستحقاق بين 1 و 31');
    await save.mutateAsync({ id: item?.id, input: { name: name.trim(), amount, category_id: categoryId, day_of_month: d, is_active: active } })
      .then(onDone).catch(() => {});
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <Field label="الاسم" value={name} onChange={(e) => setName(e.target.value)} placeholder="راتب العاملة، اشتراك الإنترنت…" maxLength={60} autoFocus={!item} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="المبلغ الشهري" inputMode="decimal" dir="ltr" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0" />
        <Field label="يوم الاستحقاق" inputMode="numeric" dir="ltr" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, ''))}
          hint="إذا كان الشهر أقصر يُعتبر آخر يوم فيه" />
      </div>
      <Select label="التصنيف" showLabel value={categoryId} onChange={setCategoryId}
        options={[
          { value: '', label: 'اختر التصنيف', disabled: true },
          ...categories.filter((c) => !c.is_archived || c.id === item?.category_id).map((c) => ({ value: c.id, label: c.name })),
        ]} />
      {item && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <span>
            <span className="block font-medium">نشط</span>
            <span className="text-xs text-muted">أوقفه إذا انتهى (يبقى سجل الدفعات السابقة)</span>
          </span>
          <Toggle checked={active} onChange={setActive} label="نشط" />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending} className="flex-1">{item ? 'حفظ التعديل' : 'إضافة'}</Button>
        {item && (
          <ConfirmButton loading={remove.isPending} confirmText="تأكيد الحذف"
            onConfirm={() => remove.mutate(item.id, { onSuccess: onDone })}>حذف</ConfirmButton>
        )}
      </div>
    </form>
  );
}
