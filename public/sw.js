const CACHE = 'lt-v2'
const SHELL = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('push', e => {
  if (!e.data) return
  const { title, body, url } = e.data.json()
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: url || '/' },
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = e.notification.data?.url || '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin))
      if (existing) return existing.focus().then(c => c.navigate(target))
      return clients.openWindow(target)
    })
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  // only cache same-origin requests
  if (url.origin !== location.origin) return
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone()
      caches.open(CACHE).then(c => c.put(e.request, copy))
      return res
    }).catch(() => caches.match(e.request))
  )
})
