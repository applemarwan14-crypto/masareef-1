// عامل الخدمة: يستقبل إشعارات push ويعرضها، ويفتح الصفحة المناسبة عند الضغط.
// لا يخزّن صفحات الموقع (التطبيق يحتاج الإنترنت أصلاً لقاعدة البيانات).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'مصاريف', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'مصاريف';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    lang: 'ar',
    dir: 'rtl',
    tag: data.id || undefined,
    data: { url: data.url || '#/notifications', id: data.id },
  };
  const badge = typeof data.badge === 'number' && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(data.badge).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.url) || '#/';
  const target = new URL(self.registration.scope);
  target.hash = hash.replace(/^#/, '');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        client.postMessage({ type: 'navigate', hash: target.hash });
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
