import { Link } from 'react-router';
import { CaretLeft } from '@phosphor-icons/react';
import { CountBadge, NAV } from '../components/Layout';
import { Logo } from '../components/Logo';
import { PageHeader, Stagger, StaggerItem } from '../components/ui';
import { useHousehold } from '../hooks/household';
import { useUnreadCount } from '../hooks/queries';

// لون خفيف لكل قسم حتى تتعرف عليه العين بسرعة
const TINT: Record<string, string> = {
  '/recurring': '#0C7A57', '/trips': '#2563EB', '/renewals': '#C2410C', '/years': '#7C3AED',
  '/cards': '#121714', '/sms': '#0891B2', '/notifications': '#DB2777', '/settings': '#77807B',
};

/** صفحة «المزيد» في الجوال: باقي الأقسام كبلاطات */
export default function MorePage() {
  const unread = useUnreadCount();
  const { household, me } = useHousehold();
  const dock = ['/', '/expenses', '/insights'];
  const items = NAV.filter((n) => !dock.includes(n.to));
  const tiles = items.filter((n) => n.to !== '/settings');
  return (
    <div className="space-y-6">
      <PageHeader title="المزيد" />
      <Stagger className="grid grid-cols-2 gap-3">
        {tiles.map(({ to, label, icon: Glyph }) => (
          <StaggerItem key={to}>
            <Link to={to} className="press surface relative flex aspect-[1.35] flex-col justify-between p-4">
              <span className="flex size-10 items-center justify-center rounded-[13px]"
                style={{ background: `color-mix(in srgb, ${TINT[to] ?? '#77807B'} 12%, transparent)`, color: TINT[to] }}>
                <Glyph className="size-[22px]" weight="duotone" />
              </span>
              <span className="flex items-center justify-between">
                <span className="text-[15px] font-medium">{label}</span>
                {to === '/notifications' && unread > 0 ? <CountBadge n={unread} /> : <CaretLeft className="size-4 text-muted" weight="bold" />}
              </span>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
      <Link to="/settings" className="press surface flex items-center gap-3.5 p-4">
        <Logo className="size-11" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">الإعدادات</span>
          <span className="block truncate text-xs text-muted">{household.name} · {me.display_name}</span>
        </span>
        <CaretLeft className="size-4 text-muted" weight="bold" />
      </Link>
    </div>
  );
}
