import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { animate } from 'motion';
import { motion, type Variants } from 'motion/react';
import { CaretDown, CaretLeft, CaretRight, CircleNotch, type Icon } from '@phosphor-icons/react';
import { addMonths, formatMonth, monthOf, todayISO } from '../lib/dates';
import { iconFor } from '../lib/icons';
import type { Category, MonthKey } from '../lib/types';
import { Riyal } from './Riyal';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// =====================================================================
//  المبالغ: علامة الريال الرسمية، والهللات أصغر وأهدأ من الريالات
// =====================================================================

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** يقسم المبلغ (بالهللة) إلى ريالات وهللات للعرض */
export function splitAmount(h: number) {
  const abs = Math.abs(Math.round(h));
  return { neg: h < 0, int: intFmt.format(Math.floor(abs / 100)), frac: String(abs % 100).padStart(2, '0') };
}

export function Money({ value, className, decimals = 'auto', sign, glyph = true, fracClass }: {
  value: number;              // بالهللة
  className?: string;
  decimals?: 'auto' | 'always' | 'never';
  sign?: boolean;             // يظهر + للموجب
  glyph?: boolean;
  fracClass?: string;
}) {
  const { neg, int, frac } = splitAmount(value);
  const showFrac = decimals === 'always' || (decimals === 'auto' && frac !== '00');
  return (
    <span dir="ltr" className={cx('num inline-flex items-baseline gap-[0.2em] whitespace-nowrap', className)}>
      {glyph && <Riyal className="h-[0.72em] w-auto shrink-0 self-center opacity-80" title="ريال" />}
      <span>
        {neg ? '−' : sign && value > 0 ? '+' : ''}{int}
        {showFrac && <span className={cx('text-[0.62em] font-normal opacity-55', fracClass)}>.{frac}</span>}
      </span>
    </span>
  );
}

/** مبلغ يتحرك عدّاً عند تغيّره */
export function AnimatedAmount({ value, className, decimals }: { value: number; className?: string; decimals?: 'auto' | 'always' | 'never' }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const controls = animate(shown, value, { duration: 0.7, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <Money value={shown} className={className} decimals={decimals} />;
}

// =====================================================================
//  الأزرار
// =====================================================================

type Variant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-panel text-panel-ink hover:bg-panel-2',
  brand: 'bg-brand text-brand-ink hover:brightness-110',
  secondary: 'bg-surface-2 text-ink hover:bg-sunken',
  outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger-soft text-danger hover:brightness-95',
};

export function Button({
  variant = 'primary', loading, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'press inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium disabled:pointer-events-none disabled:opacity-45',
        variants[variant], className,
      )}
    >
      {loading && <CircleNotch className="size-4 animate-spin" weight="bold" />}
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
      className={cx('press inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-30', className)}
    >
      {children}
    </button>
  );
}

/** زر حذف يحتاج ضغطتين: أسرع من نافذة تأكيد وأأمن من الحذف المباشر */
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
    <Button type="button" variant="danger" loading={loading}
      className={cx(armed && 'bg-danger text-white', className)}
      onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmText : children}
    </Button>
  );
}

/** شرائح اختيار متجاورة (مثل: مدين / دائن / الكل) مع مؤشر ينزلق */
export function Segmented<T extends string>({ value, onChange, options, className, layoutId = 'seg' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string; layoutId?: string;
}) {
  return (
    <div role="tablist" className={cx('inline-flex rounded-full bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('relative h-9 rounded-full px-4 text-sm font-medium transition-colors', value === o.value ? 'text-ink' : 'text-muted hover:text-ink-2')}>
          {value === o.value && (
            <motion.span layoutId={layoutId} className="absolute inset-0 rounded-full bg-surface shadow-[var(--shadow-lift)]"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// =====================================================================
//  الحقول (16px على الأقل حتى لا يكبّر الآيفون الشاشة عند الكتابة)
// =====================================================================

export const fieldClass =
  'h-12 w-full rounded-2xl border border-transparent bg-surface-2 px-4 text-base text-ink outline-none transition placeholder:text-muted/70 focus:border-brand/40 focus:bg-surface focus:ring-4 focus:ring-brand/10 disabled:opacity-60';

export function Field({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      <input {...rest} className={fieldClass} />
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** قائمة اختيار أصلية (أفضل تجربة على الجوال) */
export function Select<T extends string>({ label, value, onChange, options, showLabel, icon: LeadIcon }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[];
  showLabel?: boolean; icon?: Icon;
}) {
  return (
    <label className="block min-w-0">
      <span className={showLabel ? 'mb-1.5 block text-[13px] font-medium text-ink-2' : 'sr-only'}>{label}</span>
      <span className="relative block">
        {LeadIcon && <LeadIcon className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />}
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}
          className={cx(fieldClass, 'appearance-none truncate pe-9', LeadIcon && 'ps-10')}>
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        <CaretDown className="pointer-events-none absolute end-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" weight="bold" />
      </span>
    </label>
  );
}

/** مفتاح تشغيل/إيقاف */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-sunken')}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 35 }}
        className={cx('absolute top-0.5 size-6 rounded-full bg-white shadow', checked ? 'start-[22px]' : 'start-0.5')} />
    </button>
  );
}

// =====================================================================
//  التحميل والحالات الفارغة
// =====================================================================

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('skeleton block', className)} />;
}

/** هيكل قائمة أثناء التحميل (بدل دائرة تدور) */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="surface space-y-1 p-2" role="status" aria-label="جارٍ التحميل">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2.5" style={{ opacity: 1 - i * 0.15 }}>
          <Skeleton className="size-11 rounded-[14px]" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-1/4" /></div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ full }: { full?: boolean }) {
  if (full) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="relative flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand/15" />
          <span className="flex size-12 items-center justify-center rounded-full bg-brand text-brand-ink">
            <Riyal className="h-5 w-auto" />
          </span>
        </div>
      </div>
    );
  }
  return <SkeletonRows />;
}

export function FullScreenMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-xl font-semibold">{title}</h1>
        <p className="leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

/** حالة فارغة: أيقونة داخل حلقات متحدة المركز، ثم عنوان وشرح */
export function EmptyState({ icon: EmptyIcon, title, children, compact }: { icon?: Icon; title: string; children?: ReactNode; compact?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cx('flex flex-col items-center text-center', compact ? 'py-8' : 'px-6 py-14')}>
      {EmptyIcon && (
        <span className="relative mb-5 flex size-24 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-dashed border-line-strong" />
          <span className="absolute inset-3 rounded-full bg-surface-2" />
          <span className="relative flex size-12 items-center justify-center rounded-2xl bg-surface text-brand shadow-[var(--shadow-lift)]">
            <EmptyIcon className="size-6" weight="duotone" />
          </span>
        </span>
      )}
      <p className="text-[17px] font-semibold">{title}</p>
      {children && <div className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{children}</div>}
    </motion.div>
  );
}

// =====================================================================
//  أيقونة التصنيف: مربع ناعم بلون التصنيف
// =====================================================================

export function CategoryIcon({ category, size = 'md' }: { category?: Category; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const Glyph = iconFor(category?.icon ?? 'circle');
  const color = category?.color ?? '#77807B';
  const dims = { xs: 'size-7 rounded-[9px]', sm: 'size-9 rounded-[12px]', md: 'size-11 rounded-[14px]', lg: 'size-14 rounded-[18px]' }[size];
  const glyph = { xs: 'size-4', sm: 'size-5', md: 'size-[22px]', lg: 'size-7' }[size];
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center', dims)}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      <Glyph className={glyph} weight="duotone" />
    </span>
  );
}

// =====================================================================
//  الشهر
// =====================================================================

export function MonthSwitcher({ month, onChange, tone = 'default' }: {
  month: MonthKey; onChange: (m: MonthKey) => void; tone?: 'default' | 'panel';
}) {
  const current = monthOf(todayISO());
  const isCurrent = month >= current;
  const btn = tone === 'panel' ? 'text-panel-muted hover:bg-white/10 hover:text-panel-ink' : '';
  return (
    <div className={cx('flex items-center rounded-full p-1', tone === 'panel' ? 'bg-white/[.07]' : 'bg-surface shadow-[var(--shadow-card)]')}>
      {/* في الاتجاه RTL: السهم الأيمن = الشهر السابق */}
      <IconButton label="الشهر السابق" className={cx('size-8', btn)} onClick={() => onChange(addMonths(month, -1))}>
        <CaretRight className="size-4" weight="bold" />
      </IconButton>
      <button type="button" onClick={() => onChange(current)} title="العودة للشهر الحالي"
        className={cx('min-w-[6.5rem] px-1 text-center text-[13px] font-medium', tone === 'panel' ? 'text-panel-ink' : 'text-ink')}>
        {formatMonth(month)}
      </button>
      <IconButton label="الشهر التالي" disabled={isCurrent} className={cx('size-8', btn)} onClick={() => onChange(addMonths(month, 1))}>
        <CaretLeft className="size-4" weight="bold" />
      </IconButton>
    </div>
  );
}

// =====================================================================
//  اللوحة السفلية
// =====================================================================

/** لوحة سفلية على الجوال، ونافذة بعرض محدود على الكمبيوتر */
export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-[rgb(10_14_12/.45)]" />
        <Drawer.Content
          dir="rtl"
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] w-full max-w-lg flex-col rounded-t-[32px] bg-bg outline-none md:bottom-6 md:rounded-[32px]"
        >
          <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-line-strong md:hidden" />
          <Drawer.Title className="px-6 pt-4 text-[19px] font-semibold">{title}</Drawer.Title>
          <Drawer.Description className="sr-only">{title}</Drawer.Description>
          <div className="overflow-y-auto overflow-x-hidden px-5 pb-safe pt-4">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// =====================================================================
//  التخطيط: عنوان الصفحة، الأقسام، البطاقات
// =====================================================================

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-1 pt-5">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="display text-[28px] md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

/** عنوان قسم: سطر صغير هادئ، مع رابط أو زر على الطرف */
export function SectionTitle({ children, action, hint }: { children: ReactNode; action?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2 px-1">
      <div>
        <h2 className="text-[15px] font-semibold">{children}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('surface p-5', className)}>{children}</section>;
}

/** مجموعة صفوف داخل بطاقة واحدة مع فواصل رفيعة (مثل إعدادات iOS لكن أهدأ) */
export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('surface overflow-hidden', className)}>{children}</div>;
}

type Tone = 'brand' | 'warn' | 'danger' | 'neutral' | 'gold';
const toneRail: Record<Tone, string> = {
  brand: 'bg-brand', warn: 'bg-gold', danger: 'bg-danger', neutral: 'bg-line-strong', gold: 'bg-gold',
};
const toneIcon: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-2 text-ink-2', gold: 'bg-warn-soft text-warn',
};

/** تنبيه بخط ملوّن على طرفه: للثابتة غير المدفوعة، التجديدات، الرحلة المفتوحة… */
export function Callout({ icon: CIcon, tone = 'neutral', title, children, trailing, className }: {
  icon: Icon; tone?: Tone; title: ReactNode; children?: ReactNode; trailing?: ReactNode; className?: string;
}) {
  return (
    <div className={cx('surface relative flex items-center gap-3.5 overflow-hidden py-3.5 pe-4 ps-5', className)}>
      <span className={cx('absolute inset-y-3 start-0 w-1 rounded-e-full', toneRail[tone])} />
      <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-[13px]', toneIcon[tone])}>
        <CIcon className="size-5" weight="duotone" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        {children && <span className="mt-0.5 block truncate text-xs text-muted">{children}</span>}
      </span>
      {trailing}
    </div>
  );
}

/** مؤشر من شرائح صغيرة (بدل شريط تقدم عادي) */
export function Meter({ ratio, segments = 28, tone = 'brand', className, track = 'bg-sunken' }: {
  ratio: number; segments?: number; tone?: 'brand' | 'warn' | 'danger' | 'panel'; className?: string; track?: string;
}) {
  const filled = Math.round(Math.min(Math.max(ratio, 0), 1) * segments);
  const on = { brand: 'bg-brand', warn: 'bg-gold', danger: 'bg-danger', panel: 'bg-brand-bright' }[tone];
  return (
    <div className={cx('flex h-2.5 gap-[3px]', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}>
      {Array.from({ length: segments }, (_, i) => (
        <motion.span key={i} className={cx('h-full flex-1 rounded-[2px]', i < filled ? on : track)}
          initial={{ scaleY: 0.3, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }}
          transition={{ delay: i * 0.012, duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />
      ))}
    </div>
  );
}

// =====================================================================
//  الحركة: ظهور متتابع للعناصر
// =====================================================================

const staggerParent: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } } };
const staggerChild: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
};

export function Stagger({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'ul' }) {
  const M = as === 'ul' ? motion.ul : motion.div;
  return <M className={className} variants={staggerParent} initial="hidden" animate="show">{children}</M>;
}

export function StaggerItem({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' }) {
  const M = as === 'li' ? motion.li : motion.div;
  return <M className={className} variants={staggerChild}>{children}</M>;
}
