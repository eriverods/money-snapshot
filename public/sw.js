const CACHE = 'lt-v3'
const SHELL = ['/', '/index.html']

// Pre-cache the app shell, but do NOT call skipWaiting(). A freshly deployed
// service worker stays in the "waiting" state until every open tab/window of the
// app is closed, so it never takes over while the user is mid-session. The new
// version only activates on the next cold launch (i.e. a new session).
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)))
})

// Clean up old caches when this worker finally activates (next launch). We do NOT
// call clients.claim() here either — claiming would hijack an already-open page,
// which is exactly the unexpected reload behaviour we want to avoid.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
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
  // only handle same-origin requests
  if (url.origin !== location.origin) return

  // Navigations === a session start. Go to the network so a fresh launch picks up
  // the latest build, falling back to the cached shell when offline. Because the
  // app never re-navigates mid-session, this can never reload a running session.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, copy))
        return res
      }).catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    )
    return
  }

  // Everything else (hashed JS/CSS, icons, etc.) is content-addressed and
  // immutable, so serve cache-first for speed and stability, then cache any miss.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.ok) {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, copy))
      }
      return res
    }))
  )
})
