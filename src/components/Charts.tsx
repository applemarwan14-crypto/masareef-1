import { motion } from 'motion/react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { formatMonthShort } from '../lib/dates';
import type { CategorySlice } from '../lib/stats';
import type { MonthKey } from '../lib/types';
import { CategoryIcon, Money, cx } from './ui';

const FALLBACK = '#77807B';

/** شريط طيفي واحد: كل تصنيف قطعة بعرض نسبته (بديل الدائرة في الرئيسية) */
export function SpectrumBar({ slices, className }: { slices: CategorySlice[]; className?: string }) {
  const visible = slices.filter((s) => s.percent > 0);
  return (
    <div className={cx('flex h-3.5 gap-[3px] overflow-hidden rounded-full', className)} role="img"
      aria-label={visible.map((s) => `${s.category?.name ?? '—'} ${s.percent}%`).join('، ')}>
      {visible.map((s, i) => (
        <motion.span key={s.categoryId} className="h-full first:rounded-s-full last:rounded-e-full"
          style={{ background: s.category?.color ?? FALLBACK, flexGrow: s.percent, flexBasis: 0 }}
          initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.05 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
      ))}
    </div>
  );
}

/** قائمة التصنيفات: أيقونة، اسم، نسبة كشريط رفيع، ومبلغ */
export function CategoryBreakdown({ slices, limit, onSelect }: {
  slices: CategorySlice[]; limit?: number; onSelect?: (categoryId: string) => void;
}) {
  const shown = limit ? slices.slice(0, limit) : slices;
  const max = Math.max(...shown.map((s) => s.total), 1);
  return (
    <ul className="space-y-1">
      {shown.map((s, i) => (
        <motion.li key={s.categoryId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 * i, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <button type="button" disabled={!onSelect} onClick={() => onSelect?.(s.categoryId)}
            className="tap-row flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start disabled:pointer-events-none">
            <CategoryIcon category={s.category} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[14px] font-medium">{s.category?.name ?? 'بدون تصنيف'}</span>
                <Money value={s.total} className="shrink-0 text-[14px] font-semibold" />
              </span>
              <span className="mt-1.5 flex items-center gap-2">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
                  <motion.span className="block h-full rounded-full" style={{ background: s.category?.color ?? FALLBACK }}
                    initial={{ width: 0 }} animate={{ width: `${(s.total / max) * 100}%` }}
                    transition={{ delay: 0.1 + 0.03 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
                </span>
                <span className="num w-8 text-end text-[11px] text-muted">{s.percent}%</span>
              </span>
            </span>
          </button>
        </motion.li>
      ))}
    </ul>
  );
}

/** دائرة رفيعة مع المجموع في وسطها (صفحات الرحلة والكشف) */
export function CategoryDonut({ slices, total }: { slices: CategorySlice[]; total: number }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-52">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={slices} dataKey="total" nameKey="categoryId" innerRadius="80%" outerRadius="100%"
            paddingAngle={slices.length > 1 ? 2.5 : 0} cornerRadius={6} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
            {slices.map((s) => <Cell key={s.categoryId} fill={s.category?.color ?? FALLBACK} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="eyebrow">{slices.length} تصنيفات</span>
        <Money value={total} className="mt-1 text-xl font-semibold" />
      </div>
    </div>
  );
}

/** أعمدة الأشهر: الشهر المختار بالحبر، والبقية هادئة، والقيمة فوق المختار */
export function MonthlyBars({ data, selected, onSelect }: {
  data: { month: MonthKey; total: number }[]; selected: MonthKey; onSelect: (m: MonthKey) => void;
}) {
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <div className="flex h-44 items-end gap-2" dir="rtl">
      {data.map((d, i) => {
        const active = d.month === selected;
        return (
          <button key={d.month} type="button" onClick={() => onSelect(d.month)} aria-pressed={active}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className={cx('text-[10px] font-medium transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
              <Money value={d.total} decimals="never" glyph={false} />
            </span>
            <span className="relative flex w-full flex-1 items-end">
              <motion.span
                className={cx('w-full rounded-[10px] transition-colors', active ? 'bg-panel' : 'bg-sunken group-hover:bg-line-strong')}
                initial={{ height: 0 }} animate={{ height: `${Math.max((d.total / max) * 100, 4)}%` }}
                transition={{ delay: 0.04 * i, duration: 0.55, ease: [0.22, 1, 0.36, 1] }} />
            </span>
            <span className={cx('text-[11px]', active ? 'font-semibold text-ink' : 'text-muted')}>{formatMonthShort(d.month)}</span>
          </button>
        );
      })}
    </div>
  );
}
