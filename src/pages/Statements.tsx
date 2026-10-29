import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, CaretLeft, CaretRight, ChatCircleText, FileText, MagnifyingGlass } from '@phosphor-icons/react';
import { CategoryDonut } from '../components/Charts';
import { Card, CategoryIcon, ConfirmButton, EmptyState, IconButton, Select, Sheet, Spinner, cx } from '../components/ui';
import { useIsOwner } from '../hooks/household';
import { useCategories, useInvalidate, useStatementRows, useStatements } from '../hooks/queries';
import { deleteStatement, setStatementRowCategory } from '../lib/api';
import { formatDayLabel, formatDayShort } from '../lib/dates';
import { formatSAR, percentages, sumHalalas } from '../lib/money';
import type { Category, StatementImport, StatementRow } from '../lib/types';

/** كشوفات البنك: قسم منفصل تماماً، لا يدخل في المصاريف ولا الميزانية ولا الإحصائيات */
export default function StatementsPage() {
  const { id } = useParams();
  return id ? <StatementDetail id={id} /> : <StatementList />;
}

const period = (s: StatementImport) =>
  s.period_from && s.period_to ? `${formatDayShort(s.period_from)} – ${formatDayShort(s.period_to)}` : formatDayShort(s.created_at.slice(0, 10));

function StatementList() {
  const { data = [], isPending } = useStatements();
  return (
    <div className="space-y-4 pt-4">
      <h1 className="text-xl font-bold">كشوفات البنك</h1>
      <p className="text-sm leading-relaxed text-muted">
        كل كشف ينحفظ هنا باسم ملفه لحاله. عملياته منفصلة تماماً عن مصاريفك، وما تدخل في الميزانية ولا الإحصائيات.
      </p>
      {isPending ? <Spinner /> : data.length === 0 ? (
        <EmptyState icon={FileText} title="ما في كشوفات بعد">أرسل كشف البنك لـ Claude، ويظهر هنا.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {data.map((s) => (
            <li key={s.id}>
              <Link to={`/statements/${s.id}`}
                className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] active:opacity-80">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand"><FileText className="size-6" weight="duotone" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold" dir="auto">{s.name}</span>
                  <span className="text-xs text-muted">{s.bank ? `${s.bank} · ` : ''}{period(s)}</span>
                </span>
                <CaretLeft className="size-4 text-muted" weight="bold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatementDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const owner = useIsOwner();
  const invalidate = useInvalidate();
  const { data: statements = [] } = useStatements();
  const { data: categories = [] } = useCategories();
  const { data: rows = [], isPending } = useStatementRows(id);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'debit' | 'credit' | 'all'>('debit');
  const [editing, setEditing] = useState<StatementRow | null>(null);
  const s = statements.find((x) => x.id === id);

  const debits = rows.filter((r) => r.direction === 'debit');
  const credits = rows.filter((r) => r.direction === 'credit');
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // توزيع المشتريات (المدين فقط) على التصنيفات
  const slices = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const r of debits) {
      const k = r.category_id ?? 'none';
      const cur = m.get(k) ?? { total: 0, count: 0 };
      cur.total += r.amount;
      cur.count++;
      m.set(k, cur);
    }
    const list = [...m.entries()].sort((a, b) => b[1].total - a[1].total);
    const pct = percentages(list.map(([, v]) => v.total));
    return list.map(([k, v], i) => ({ categoryId: k, category: catById.get(k), ...v, percent: pct[i] ?? 0 }));
  }, [debits, catById]);

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (view === 'all' || r.direction === view)
    && (!q || `${r.description} ${r.merchant ?? ''} ${r.amount / 100}`.toLowerCase().includes(q)));
  const byDay = useMemo(() => {
    const g: { date: string; items: StatementRow[] }[] = [];
    for (const r of shown) {
      const last = g[g.length - 1];
      if (last?.date === r.txn_date) last.items.push(r); else g.push({ date: r.txn_date, items: [r] });
    }
    return g;
  }, [shown]);

  if (!s) return statements.length ? <EmptyState title="الكشف غير موجود" /> : <Spinner />;
  const matched = debits.filter((r) => r.matched_expense_id).length;

  return (
    <div className="space-y-4 pt-4">
      <header className="flex items-center gap-2">
        <IconButton label="رجوع" onClick={() => navigate('/statements')}><CaretRight className="size-5" weight="bold" /></IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold" dir="auto">{s.name}</h1>
          <p className="text-xs text-muted">{s.bank ? `${s.bank} · ` : ''}{period(s)} · منفصل عن مصاريفك</p>
        </div>
      </header>

      <section className="hero rounded-card p-5 shadow-lg shadow-brand/20">
        <p className="text-sm text-white/75">المشتريات والمدفوعات</p>
        <p className="num mt-1 text-4xl font-bold">{formatSAR(sumHalalas(debits.map((r) => r.amount)))}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/80">
          <span>{debits.length} عملية</span>
          {credits.length > 0 && <span>وارد: <span className="num">{formatSAR(sumHalalas(credits.map((r) => r.amount)))}</span></span>}
          {matched > 0 && <span>{matched} منها مسجلة من رسائل البنك</span>}
        </div>
      </section>

      {debits.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold">حسب التصنيف</h2>
          <CategoryDonut slices={slices.map((x) => ({ ...x, category: x.category as Category }))} total={sumHalalas(debits.map((r) => r.amount))} />
          <ul className="mt-4 space-y-2.5">
            {slices.map((x) => (
              <li key={x.categoryId} className="flex items-center gap-3 text-sm">
                <CategoryIcon category={x.category} size="sm" />
                <span className="flex-1 font-medium">{x.category?.name ?? 'بدون تصنيف'} <span className="text-xs text-muted">({x.count})</span></span>
                <span className="num font-semibold">{formatSAR(x.total)}</span>
                <span className="num w-9 text-end text-xs text-muted">{x.percent}%</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex gap-2">
        {(['debit', 'credit', 'all'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={cx('h-9 rounded-full px-4 text-sm font-semibold', view === v ? 'bg-ink text-bg' : 'bg-surface-2')}>
            {v === 'debit' ? 'مدين' : v === 'credit' ? 'دائن' : 'الكل'}
          </button>
        ))}
      </div>
      <div className="relative">
        <MagnifyingGlass className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في الكشف"
          className="h-12 w-full rounded-2xl border border-line bg-surface ps-11 pe-4 text-base outline-none focus:border-brand" />
      </div>

      {isPending ? <Spinner /> : byDay.length === 0 ? <EmptyState title="لا توجد عمليات" /> : (
        <div className="space-y-4">
          {byDay.map((g) => (
            <section key={g.date}>
              <h3 className="mb-1 px-2 text-sm font-semibold">{formatDayLabel(g.date)}</h3>
              <div className="rounded-card bg-surface p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
                {g.items.map((r) => (
                  <button key={r.id} type="button" onClick={() => setEditing(r)}
                    className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-start hover:bg-surface-2">
                    {r.direction === 'credit'
                      ? <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand"><ArrowDown className="size-5" weight="bold" /></span>
                      : r.category_id ? <CategoryIcon category={catById.get(r.category_id)} />
                      : <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted"><ArrowUp className="size-5" weight="bold" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold" dir="auto">{r.merchant || r.description}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span className="truncate">{r.kind ?? (r.category_id ? catById.get(r.category_id)?.name : '')}</span>
                        {r.matched_expense_id && <ChatCircleText className="size-3.5 shrink-0 text-brand" weight="fill" aria-label="مسجلة من رسالة البنك" />}
                      </span>
                    </span>
                    <span className={cx('num shrink-0 font-semibold', r.direction === 'credit' && 'text-brand')}>
                      {r.direction === 'credit' ? '+' : ''}{formatSAR(r.amount)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {owner && (
        <ConfirmButton className="w-full" confirmText="تأكيد حذف الكشف وكل عملياته"
          onConfirm={() => deleteStatement(s.id).then(() => { invalidate('statements'); toast.success('تم حذف الكشف'); navigate('/statements'); })
            .catch((e: Error) => toast.error(e.message))}>
          حذف الكشف
        </ConfirmButton>
      )}

      <Sheet open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} title="عملية من الكشف">
        {editing && <RowSheet row={editing} categories={categories} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

function RowSheet({ row, categories, onDone }: { row: StatementRow; categories: Category[]; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [cat, setCat] = useState(row.category_id ?? '');
  return (
    <div className="space-y-4 pb-4">
      <div className="rounded-2xl bg-surface-2 p-4">
        <p className="num text-2xl font-bold">{row.direction === 'credit' ? '+' : ''}{formatSAR(row.amount)}</p>
        <p className="mt-1 text-sm text-muted">{formatDayLabel(row.txn_date)}{row.kind ? ` · ${row.kind}` : ''}</p>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed" dir="auto">{row.description}</p>
        {row.matched_expense_id && <p className="mt-2 text-xs font-medium text-brand">نفس العملية مسجلة في مصاريفك من رسالة البنك</p>}
      </div>
      {row.direction === 'debit' && (
        <Select label="التصنيف" showLabel value={cat}
          onChange={(v) => {
            setCat(v);
            setStatementRowCategory(row.id, v || null)
              .then(() => { invalidate('statement-rows'); toast.success('تم الحفظ'); onDone(); })
              .catch((e: Error) => toast.error(e.message));
          }}
          options={[{ value: '', label: 'بدون تصنيف' }, ...categories.filter((c) => !c.is_archived).map((c) => ({ value: c.id, label: c.name }))]} />
      )}
    </div>
  );
}
