import { useNavigate } from 'react-router';
import {
  AirplaneTilt, Bell, CalendarCheck, ChartPieSlice, ChatCircleText, Checks, Copy, Repeat, Sun, Target, UsersThree, Warning,
  type Icon,
} from '@phosphor-icons/react';
import { Button, EmptyState, Spinner, cx } from '../components/ui';
import { useInvalidate, useNotifications } from '../hooks/queries';
import { markAllRead, markNotificationRead } from '../lib/api';
import { formatDayLabel, todayISO } from '../lib/dates';
import type { AppNotification, NotificationKind } from '../lib/types';

const ICONS: Record<NotificationKind, Icon> = {
  sms_added: ChatCircleText, family_expense: UsersThree, budget: Target, recurring_due: Repeat, month_summary: ChartPieSlice,
  sms_failed: Warning, trip: AirplaneTilt, renewal: CalendarCheck, duplicate: Copy, daily: Sun, test: Bell,
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const { data = [], isPending } = useNotifications();
  const unread = data.some((n) => !n.read_at);

  async function open(n: AppNotification) {
    if (!n.read_at) await markNotificationRead(n.id).catch(() => {});
    invalidate('notifications');
    const url = n.data?.url?.replace(/^#/, '');
    if (url && url !== '/notifications') navigate(url);
  }

  return (
    <div className="space-y-4 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الإشعارات</h1>
        {unread && (
          <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => markAllRead().then(() => invalidate('notifications'))}>
            <Checks className="size-4" weight="bold" /> قراءة الكل
          </Button>
        )}
      </header>
      {isPending ? <Spinner /> : data.length === 0 ? (
        <EmptyState icon={Bell} title="ما في إشعارات">فعّل إشعارات الجوال من الإعدادات حتى توصلك حتى والتطبيق مقفول.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {data.map((n) => {
            const Glyph = ICONS[n.kind] ?? Bell;
            return (
              <li key={n.id}>
                <button type="button" onClick={() => open(n)}
                  className={cx('flex w-full items-start gap-3 rounded-2xl p-3 text-start transition hover:bg-surface-2', !n.read_at && 'bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]')}>
                  <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-2xl',
                    n.kind === 'duplicate' || n.kind === 'sms_failed' || n.kind === 'budget' ? 'bg-warn/15 text-warn' : 'bg-brand-soft text-brand')}>
                    <Glyph className="size-5" weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cx('truncate', !n.read_at ? 'font-bold' : 'font-medium')}>{n.title}</span>
                      <span className="shrink-0 text-[11px] text-muted">{formatDayLabel(n.created_at.slice(0, 10), todayISO())}</span>
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted">{n.body}</span>
                  </span>
                  {!n.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="غير مقروء" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
