import { Link } from 'react-router';
import { CaretLeft } from '@phosphor-icons/react';
import { CountBadge, NAV } from '../components/Layout';
import { useUnreadCount } from '../hooks/queries';

/** صفحة «المزيد» في الجوال: باقي الأقسام التي لا تتسع في الشريط السفلي */
export default function MorePage() {
  const unread = useUnreadCount();
  const items = NAV.filter((n) => !['/', '/expenses', '/recurring'].includes(n.to));
  return (
    <div className="space-y-4 pt-4">
      <h1 className="text-xl font-bold">المزيد</h1>
      <ul className="overflow-hidden rounded-card bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        {items.map(({ to, label, icon: Glyph }) => (
          <li key={to} className="border-b border-line/60 last:border-0">
            <Link to={to} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand"><Glyph className="size-5" weight="duotone" /></span>
              <span className="flex-1 font-medium">{label}</span>
              {to === '/notifications' && unread > 0 && <CountBadge n={unread} />}
              <CaretLeft className="size-4 text-muted" weight="bold" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
