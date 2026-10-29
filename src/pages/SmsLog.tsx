import { useState } from 'react';
import { ChatCircleText, CheckCircle, Prohibit, Sparkle, Warning, CalendarCheck } from '@phosphor-icons/react';
import { useExpenseSheet } from '../components/Layout';
import { EmptyState, Spinner, cx } from '../components/ui';
import { useSmsMessages } from '../hooks/queries';
import { deleteSmsMessage } from '../lib/api';
import { formatDayLabel, todayISO } from '../lib/dates';
import type { SmsMessage } from '../lib/types';

const STATUS: Record<SmsMessage['status'], { label: string; className: string; Icon: typeof CheckCircle }> = {
  added: { label: 'انسجلت', className: 'text-brand', Icon: CheckCircle },
  renewal: { label: 'تجديد', className: 'text-[#2563EB]', Icon: CalendarCheck },
  ignored: { label: 'تجاهلناها', className: 'text-muted', Icon: Prohibit },
  failed: { label: 'ما انسجلت', className: 'text-danger', Icon: Warning },
};

export default function SmsLogPage() {
  const { data = [], isPending, refetch } = useSmsMessages();
  const [filter, setFilter] = useState<'all' | 'failed'>('all');
  const list = filter === 'failed' ? data.filter((m) => m.status === 'failed') : data;
  const failed = data.filter((m) => m.status === 'failed').length;

  return (
    <div className="space-y-4 pt-4">
      <h1 className="text-xl font-bold">رسائل البنك</h1>
      <p className="text-sm leading-relaxed text-muted">
        كل رسالة أرسلها اختصار الآيفون. يقرأها Claude (وإن ما رد نقرأها محلياً)، ونخفي الرصيد قبل الإرسال.
        رسائلك تظهر لك فقط.
      </p>
      <div className="flex gap-2">
        {(['all', 'failed'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cx('h-9 rounded-full px-4 text-sm font-semibold', filter === f ? 'bg-ink text-bg' : 'bg-surface-2')}>
            {f === 'all' ? 'الكل' : `ما انسجلت (${failed})`}
          </button>
        ))}
      </div>

      {isPending ? <Spinner /> : list.length === 0 ? (
        <EmptyState icon={ChatCircleText} title="ما في رسائل">جهّز الاختصار من الإعدادات ← رسائل البنك.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {list.map((m) => <SmsRow key={m.id} m={m} onDeleted={() => refetch()} />)}
        </ul>
      )}
    </div>
  );
}

function SmsRow({ m, onDeleted }: { m: SmsMessage; onDeleted: () => void }) {
  const openSheet = useExpenseSheet();
  const s = STATUS[m.status];
  const parsed = m.parsed as { amount?: number; currency?: string; merchant?: string; date?: string } | null;
  const sarGuess = parsed?.amount && (!parsed.currency || parsed.currency === 'SAR') ? Math.round(parsed.amount * 100) : undefined;

  return (
    <li className="rounded-card bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className={cx('inline-flex items-center gap-1 font-semibold', s.className)}>
          <s.Icon className="size-4" weight="fill" /> {s.label}{m.reason && ` · ${m.reason}`}
        </span>
        <span className="flex items-center gap-1 text-muted">
          {m.parser === 'claude' && <Sparkle className="size-3.5" weight="fill" aria-label="قرأها Claude" />}
          {formatDayLabel(m.created_at.slice(0, 10), todayISO())} {m.created_at.slice(11, 16)}
        </span>
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed" dir="auto">{m.body}</p>
      {(m.status === 'failed' || m.status === 'ignored') && (
        <div className="mt-3 flex gap-3 text-sm font-semibold">
          <button type="button" className="text-brand" onClick={() => openSheet(undefined, {
            amount: sarGuess, description: parsed?.merchant ?? null, expense_date: parsed?.date ?? undefined,
          })}>أضفها يدوياً</button>
          <button type="button" className="text-muted" onClick={() => deleteSmsMessage(m.id).then(onDeleted)}>حذف</button>
        </div>
      )}
    </li>
  );
}
