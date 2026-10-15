'use strict';
/* Instalação como aplicativo (PWA): registra o service worker e oferece o botão "Instalar app". */
(function () {
  const btn = document.getElementById('btn-install');
  const hint = document.getElementById('install-hint');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  let deferred = null;

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = null; if (btn) btn.hidden = true; if (hint) hint.hidden = true; });

  if (btn) btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null; btn.hidden = true;
  });

  // iPhone/iPad (Safari) não dispara o evento: mostra a instrução manual
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  if (ios && hint) hint.hidden = false;
})();
