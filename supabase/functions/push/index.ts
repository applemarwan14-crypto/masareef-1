// يرسل الإشعارات الجديدة إلى أجهزة أصحابها (Web Push).
// تستدعيه قاعدة البيانات عند كل إشعار جديد وكل 10 دقائق (0016) بترويسة x-cron-secret.
// أسرار مطلوبة: VAPID_PUBLIC_KEY، VAPID_PRIVATE_KEY، VAPID_SUBJECT (mailto:you@example.com).

import webpush from 'npm:web-push@3.6.7';
import { cors, json, serviceClient } from '../_shared/supabase.ts';

const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
if (publicKey && privateKey) {
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', publicKey, privateKey);
}

// الإشعارات المستعجلة تصل فوراً حتى في وضع توفير الطاقة
const URGENT = new Set(['sms_added', 'duplicate', 'budget', 'sms_failed', 'test']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // المفتاح العام ليس سراً: التطبيق يطلبه ليشترك في الإشعارات
  if (req.method === 'GET') return publicKey ? json({ publicKey }) : json({ error: 'VAPID keys are not set' }, 503);
  const db = serviceClient();
  const secret = req.headers.get('x-cron-secret') ?? '';
  const { data: ok } = await db.rpc('verify_cron_secret', { p: secret });
  if (!ok) return json({ error: 'forbidden' }, 403);
  if (!publicKey || !privateKey) return json({ error: 'VAPID keys are not set' }, 500);

  // نحجز الإشعارات أولاً (pushed_at) حتى لا تُرسل مرتين إن تزامن استدعاءان
  const since = new Date(Date.now() - 86400000).toISOString();
  const { data: pending } = await db.from('notifications').select('id')
    .is('pushed_at', null).gt('created_at', since).order('created_at').limit(300);
  if (!pending?.length) return json({ sent: 0 });
  const { data: claimed } = await db.from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('id', pending.map((p) => p.id)).is('pushed_at', null)
    .select('id, user_id, kind, title, body, data');
  if (!claimed?.length) return json({ sent: 0 });

  const users = [...new Set(claimed.map((n) => n.user_id as string))];
  const [{ data: subs }, { data: unread }] = await Promise.all([
    db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', users),
    db.from('notifications').select('user_id').in('user_id', users).is('read_at', null),
  ]);
  const badge = new Map<string, number>();
  for (const u of unread ?? []) badge.set(u.user_id, (badge.get(u.user_id) ?? 0) + 1);

  let sent = 0;
  const dead: string[] = [];
  const used: string[] = [];
  await Promise.all(claimed.flatMap((n) =>
    (subs ?? []).filter((s) => s.user_id === n.user_id).map(async (s) => {
      const payload = JSON.stringify({
        id: n.id, title: n.title, body: n.body, kind: n.kind,
        url: (n.data as { url?: string })?.url ?? '#/notifications', badge: badge.get(n.user_id) ?? 0,
      });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 24 * 3600, urgency: URGENT.has(n.kind) ? 'high' : 'normal', topic: n.kind.slice(0, 32),
        });
        sent++;
        used.push(s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id); // الاشتراك انتهى (حُذف التطبيق مثلاً)
        else console.warn('push failed', status, (e as Error).message);
      }
    })
  ));

  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead);
  if (used.length) await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).in('id', [...new Set(used)]);
  return json({ sent, notifications: claimed.length, removed: dead.length });
});
