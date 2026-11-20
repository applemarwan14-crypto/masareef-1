import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  AirplaneTilt, Bell, CalendarCheck, ChartLineUp, ChatCircleText, CreditCard, GearSix, House, ListBullets,
  Plus, Repeat, SquaresFour, Stack, type Icon,
} from '@phosphor-icons/react';
import { useHousehold } from '../hooks/household';
import { useUnreadCount } from '../hooks/queries';
import { useRealtimeSync } from '../hooks/realtime';
import { setBadge } from '../lib/push';
import type { Expense } from '../lib/types';
import { cx } from './ui';
import { ExpenseSheet } from './ExpenseSheet';
import { Logo } from './Logo';

const SheetCtx = createContext<(expense?: Expense, preset?: Partial<Expense>) => void>(() => {});
/** يفتح نافذة إضافة مصروف جديد (مع قيم مبدئية اختيارية)، أو تعديل مصروف موجود */
export const useExpenseSheet = () => useContext(SheetCtx);

export interface NavItem { to: string; label: string; icon: Icon; end?: boolean; group?: 'main' | 'plan' | 'more' }

export const NAV: NavItem[] = [
  { to: '/', label: 'الرئيسية', icon: House, end: true, group: 'main' },
  { to: '/expenses', label: 'العمليات', icon: ListBullets, group: 'main' },
  { to: '/recurring', label: 'الثابتة', icon: Repeat, group: 'main' },
  { to: '/insights', label: 'قراءات', icon: ChartLineUp, group: 'main' },
  { to: '/trips', label: 'الرحلات', icon: AirplaneTilt, group: 'plan' },
  { to: '/renewals', label: 'التجديدات', icon: CalendarCheck, group: 'plan' },
  { to: '/years', label: 'السنوات', icon: Stack, group: 'plan' },
  { to: '/cards', label: 'البطاقات', icon: CreditCard, group: 'more' },
  { to: '/sms', label: 'رسائل البنك', icon: ChatCircleText, group: 'more' },
  { to: '/notifications', label: 'الإشعارات', icon: Bell, group: 'more' },
  { to: '/settings', label: 'الإعدادات', icon: GearSix, group: 'more' },
];

const DOCK: NavItem[] = [NAV[0]!, NAV[1]!, NAV[3]!, { to: '/more', label: 'المزيد', icon: SquaresFour }];
const GROUPS: { key: NonNullable<NavItem['group']>; label: string }[] = [
  { key: 'main', label: 'يومي' }, { key: 'plan', label: 'تخطيط' }, { key: 'more', label: 'الحساب' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { household, me } = useHousehold();
  useRealtimeSync(household.id, me.user_id);
  const unread = useUnreadCount();
  useEffect(() => setBadge(unread), [unread]);
  const location = useLocation();

  const [state, setState] = useState<{ open: boolean; expense?: Expense; preset?: Partial<Expense> }>({ open: false });
  const open = useCallback((expense?: Expense, preset?: Partial<Expense>) => setState({ open: true, expense, preset }), []);

  // العودة لأعلى الصفحة عند التنقل
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  return (
    <SheetCtx.Provider value={open}>
      <div className="mx-auto flex min-h-dvh max-w-[1180px]">
        {/* شريط جانبي للكمبيوتر */}
        <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col overflow-y-auto px-4 pb-6 pt-7 md:flex">
          <div className="mb-7 flex items-center gap-3 px-2">
            <Logo className="size-9" />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-tight">مصاريف البيت</div>
              <div className="truncate text-xs text-muted">{household.name}</div>
            </div>
          </div>
          <button onClick={() => open()}
            className="press mb-6 flex h-11 items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-medium text-brand-ink">
            <Plus className="size-[18px]" weight="bold" /> مصروف جديد
          </button>
          {GROUPS.map((g) => (
            <div key={g.key} className="mb-5">
              <p className="eyebrow mb-1.5 px-3">{g.label}</p>
              {NAV.filter((n) => n.group === g.key).map(({ to, label, icon: NavIcon, end }) => (
                <NavLink key={to} to={to} end={end}
                  className={({ isActive }) => cx(
                    'relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors',
                    isActive ? 'font-medium text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )}>
                  {({ isActive }) => (<>
                    {isActive && (
                      <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-surface shadow-[var(--shadow-card)]"
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                    )}
                    <NavIcon className={cx('relative size-[19px]', isActive && 'text-brand')} weight={isActive ? 'fill' : 'regular'} />
                    <span className="relative flex-1">{label}</span>
                    {to === '/notifications' && unread > 0 && <span className="relative"><CountBadge n={unread} /></span>}
                  </>)}
                </NavLink>
              ))}
            </div>
          ))}
        </aside>

        <main className="pt-safe min-w-0 flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+84px)] md:px-10 md:pb-16">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={location.pathname}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* شريط التبويبات: ملتصق بأسفل الشاشة بعرضها كامل مثل تطبيقات الآيفون، ويحسب مساحة مؤشر الرجوع */}
      <nav aria-label="التنقل"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto grid h-[58px] max-w-md grid-cols-5 items-center px-1">
          {DOCK.slice(0, 2).map((n) => <DockLink key={n.to} {...n} />)}
          <div className="flex justify-center">
            <button onClick={() => open()} aria-label="إضافة مصروف"
              className="press flex h-11 w-14 items-center justify-center rounded-2xl bg-brand text-brand-ink">
              <Plus className="size-6" weight="bold" />
            </button>
          </div>
          {DOCK.slice(2).map((n) => <DockLink key={n.to} {...n} badge={n.to === '/more' ? unread : 0} />)}
        </div>
      </nav>

      <ExpenseSheet
        open={state.open}
        expense={state.expense}
        preset={state.preset}
        onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}
      />
    </SheetCtx.Provider>
  );
}

export function CountBadge({ n }: { n: number }) {
  return (
    <span className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}

function DockLink({ to, label, icon: NavIcon, end, badge = 0 }: NavItem & { badge?: number }) {
  return (
    <NavLink to={to} end={end} className="relative flex h-full flex-col items-center justify-center gap-[3px]">
      {({ isActive }) => (<>
        <NavIcon className={cx('size-[25px] transition-colors', isActive ? 'text-brand' : 'text-muted')}
          weight={isActive ? 'fill' : 'regular'} />
        <span className={cx('text-[10px] font-medium transition-colors', isActive ? 'text-brand' : 'text-muted')}>{label}</span>
        {badge > 0 && <span className="absolute end-[22%] top-1.5"><CountBadge n={badge} /></span>}
      </>)}
    </NavLink>
  );
}
