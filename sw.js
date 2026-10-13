/* The Research Archive: same-origin static app shell only. No research data cached here. */
const CACHE = 'research-archive-shell-0.19.14-1';
const SHELL = ['./', './index.html', './styles.css', './js/app.js?v=0.19.14', './js/dialog-accessibility.js', './js/data.js', './js/cloud.js', './js/backup.js', './js/investigation.js', './js/search-index.js', './js/editorial-review.js', './js/publication.js', './js/publication-compare.js', './js/reading-sections.js', './js/editorial-queue.js', './js/case-workflow.js', './js/editorial-triage.js', './js/source-workflow.js', './js/entities.js', './js/claim-evidence.js', './js/source-picker.js', './js/source-intake.js', './js/navigation-trail.js', './js/recovery-readiness.js', './js/board-layout.js', './js/provenance.js', './js/directory-backup.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon.svg','./icons/apple-touch-icon.png','./icons/favicon-32.png','./icons/brand/full-logo.png','./icons/brand/emblem-transparent-512.png','./icons/icon-maskable-192.png','./icons/icon-maskable-512.png','./icons/ui/research-desk.png','./icons/ui/archive.png','./icons/ui/new-case.png','./icons/ui/search.png','./icons/ui/source.png','./icons/ui/notes.png','./icons/ui/attachments.png','./icons/ui/investigation-board.png','./icons/ui/timeline.png','./icons/ui/tags.png','./icons/ui/cloud-sync.png','./icons/ui/backup.png','./icons/ui/restore.png','./icons/ui/export.png','./icons/ui/trash.png','./icons/ui/settings.png'];
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
    // Keep the current worker in control until existing research tabs are closed.
    // Forcing activation mid-edit can mix old HTML/modules with an updated shell.
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('research-archive-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
    const req = event.request;
    if (req.mode === 'navigate') {
        event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    } else {
        // Prefer current same-origin files while connected. Cache-first can pair
        // a newly fetched entry module with obsolete dependency modules during
        // an update. Installed offline clients still use the pre-cached shell.
        // Never add runtime/private responses to CacheStorage.
        event.respondWith(fetch(req).catch(() => caches.match(req)));
    }
});
