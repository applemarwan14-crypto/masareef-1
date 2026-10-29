import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { CreditCard, Plus } from '@phosphor-icons/react';
import { Button, ConfirmButton, EmptyState, Field, Select, Sheet, Spinner } from '../components/ui';
import { useHousehold, useIsOwner } from '../hooks/household';
import { useCards, useDeleteCard, useSaveCard } from '../hooks/queries';
import { CARD_TYPES } from '../lib/labels';
import type { Card, CardType } from '../lib/types';

export default function CardsPage() {
  const owner = useIsOwner();
  const { members } = useHousehold();
  const { data: cards = [], isPending } = useCards();
  const [editing, setEditing] = useState<{ open: boolean; item?: Card }>({ open: false });
  const who = (id: string | null) => members.find((m) => m.user_id === id)?.display_name;

  return (
    <div className="space-y-4 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">البطاقات</h1>
        {owner && (
          <Button variant="secondary" className="h-10 px-3 text-sm" onClick={() => setEditing({ open: true })}>
            <Plus className="size-4" weight="bold" /> بطاقة
          </Button>
        )}
      </header>
      <p className="text-sm leading-relaxed text-muted">
        كل بطاقة تظهر في رسالة بنك تنحفظ هنا تلقائياً. حدّد نسبة الرسوم الدولية لكل بطاقة، ونضيفها على المشتريات بعملة أجنبية بعد التحويل للريال بسعر اليوم.
      </p>

      {isPending ? <Spinner /> : cards.length === 0 ? (
        <EmptyState icon={CreditCard} title="ما في بطاقات بعد">تنضاف أول ما توصل رسالة شراء من البنك.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={!owner} onClick={() => setEditing({ open: true, item: c })}
                className="relative w-full overflow-hidden rounded-card bg-gradient-to-br from-[#14211E] to-[#2E4440] p-5 text-start text-white shadow-lg disabled:cursor-default">
                <div className="flex items-start justify-between">
                  <span className="font-semibold">{c.nickname || c.bank || 'بطاقة'}</span>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">{CARD_TYPES[c.card_type]}</span>
                </div>
                <p className="num mt-6 text-xl tracking-[.25em]" dir="ltr">•••• {c.last4}</p>
                <div className="mt-3 flex justify-between text-xs text-white/70">
                  <span>{c.bank}{who(c.user_id) && ` · ${who(c.user_id)}`}</span>
                  <span>رسوم دولية {c.intl_fee_bps / 100}%</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!owner && cards.length > 0 && <p className="text-xs text-muted">تعديل البطاقات لمنشئ العائلة.</p>}

      <Sheet open={editing.open} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))} title={editing.item ? 'تعديل البطاقة' : 'بطاقة جديدة'}>
        <CardForm key={editing.item?.id ?? 'new'} item={editing.item} onDone={() => setEditing({ open: false })} />
      </Sheet>
    </div>
  );
}

function CardForm({ item, onDone }: { item?: Card; onDone: () => void }) {
  const { members } = useHousehold();
  const save = useSaveCard();
  const remove = useDeleteCard();
  const [nickname, setNickname] = useState(item?.nickname ?? '');
  const [bank, setBank] = useState(item?.bank ?? '');
  const [last4, setLast4] = useState(item?.last4 ?? '');
  const [type, setType] = useState<CardType>(item?.card_type ?? 'credit');
  const [fee, setFee] = useState(item ? String(item.intl_fee_bps / 100) : '2.75');
  const [owner, setOwner] = useState(item?.user_id ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(last4)) return toast.error('آخر 4 أرقام من البطاقة');
    const pct = Number(fee.replace('٫', '.') || 0);
    if (!(pct >= 0 && pct <= 10)) return toast.error('النسبة بين 0 و 10%');
    save.mutate({
      id: item?.id,
      input: { nickname: nickname.trim() || null, bank: bank.trim(), last4, card_type: type, intl_fee_bps: Math.round(pct * 100), user_id: owner || null },
    }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Field label="اسم مختصر" value={nickname} maxLength={30} onChange={(e) => setNickname(e.target.value)} placeholder="فيزا السفر" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="البنك" value={bank} maxLength={40} onChange={(e) => setBank(e.target.value)} placeholder="الراجحي" />
        <Field label="آخر 4 أرقام" inputMode="numeric" dir="ltr" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />
        <Select label="النوع" showLabel value={type} onChange={setType}
          options={Object.entries(CARD_TYPES).map(([value, label]) => ({ value: value as CardType, label }))} />
        <Field label="الرسوم الدولية %" inputMode="decimal" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} hint="مثال: 2.75" />
      </div>
      <Select label="صاحب البطاقة" showLabel value={owner} onChange={setOwner}
        options={[{ value: '', label: '—' }, ...members.map((m) => ({ value: m.user_id, label: m.display_name }))]} />
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" loading={save.isPending}>حفظ</Button>
        {item && <ConfirmButton loading={remove.isPending} confirmText="تأكيد" onConfirm={() => remove.mutate(item.id, { onSuccess: onDone })}>حذف</ConfirmButton>}
      </div>
    </form>
  );
}
