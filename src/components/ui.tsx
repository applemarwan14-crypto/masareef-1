import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { addMonths, formatMonth, monthOf, todayISO } from '../lib/dates';
import { iconFor } from '../lib/icons';
import type { Category, MonthKey } from '../lib/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'bg-surface-2 text-ink hover:bg-line',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger hover:opacity-90',
};

export function Button({
  variant = 'primary', loading, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold transition active:scale-[.98] disabled:opacity-50',
        variants[variant], className,
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx('inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink', className)}
    >
      {children}
    </button>
  );
}

/** زر حذف يحتاج ضغطتين، أسرع من نافذة تأكيد وأأمن من الحذف المباشر */
export function ConfirmButton({ onConfirm, children, confirmText = 'اضغط مرة أخرى للتأكيد', loading, className }: {
  onConfirm: () => void; children: ReactNode; confirmText?: string; loading?: boolean; className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button type="button" variant="danger" loading={loading} className={className}
      onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmText : children}
    </Button>
  );
}

export function Field({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      <input
        {...rest}
        className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none transition focus:border-brand"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Spinner({ full }: { full?: boolean }) {
  return (
    <div className={cx('flex items-center justify-center text-brand', full ? 'min-h-dvh' : 'py-20')}>
      <LoaderCircle className="size-7 animate-spin" aria-label="جارٍ التحميل" />
    </div>
  );
}

export function FullScreenMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold">{title}</h1>
        <p className="leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function CategoryIcon({ category, size = 'md' }: { category?: Category; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = iconFor(category?.icon ?? 'circle');
  const color = category?.color ?? '#64748B';
  const dims = { sm: 'size-8 rounded-xl', md: 'size-10 rounded-2xl', lg: 'size-12 rounded-2xl' }[size];
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center', dims)}
      style={{ backgroundColor: `${color}1F`, color }}>
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} strokeWidth={2} />
    </span>
  );
}

export function MonthSwitcher({ month, onChange }: { month: MonthKey; onChange: (m: MonthKey) => void }) {
  const current = monthOf(todayISO());
  const isCurrent = month >= current;
  return (
    <div className="flex items-center gap-1">
      {/* في الاتجاه RTL: السهم الأيمن = الشهر السابق */}
      <IconButton label="الشهر السابق" onClick={() => onChange(addMonths(month, -1))}><ChevronRight className="size-5" /></IconButton>
      <button type="button" onClick={() => onChange(current)}
        className="min-w-32 rounded-full px-3 py-1.5 text-center font-semibold hover:bg-surface-2"
        title="العودة للشهر الحالي">
        {formatMonth(month)}
      </button>
      <IconButton label="الشهر التالي" disabled={isCurrent} className="disabled:opacity-30"
        onClick={() => onChange(addMonths(month, 1))}><ChevronLeft className="size-5" /></IconButton>
    </div>
  );
}

/** لوحة سفلية على الجوال، ونافذة وسطية على الكمبيوتر */
export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          dir="rtl"
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-surface outline-none md:bottom-6 md:rounded-[28px]"
        >
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-line md:hidden" />
          <Drawer.Title className="px-5 pt-4 text-lg font-bold">{title}</Drawer.Title>
          <Drawer.Description className="sr-only">{title}</Drawer.Description>
          <div className="overflow-y-auto px-5 pb-safe pt-3">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-card bg-surface p-5', className)}>{children}</section>;
}

export function Select<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}
        className="h-11 w-full appearance-none rounded-2xl border border-line bg-surface px-4 text-sm outline-none focus:border-brand">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
