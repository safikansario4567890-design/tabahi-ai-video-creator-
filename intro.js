(function () {
  'use strict';

  const intro = document.getElementById('intro-screen');
  const app = document.getElementById('app-shell');
  const enterButton = document.getElementById('explore-ai');
  if (!intro || !app || !enterButton) return;

  let dismissed = false;

  function revealApp() {
    if (dismissed) return;
    dismissed = true;
    intro.hidden = true;
    intro.inert = true;
    intro.setAttribute('aria-hidden', 'true');
    app.inert = false;
    app.setAttribute('aria-hidden', 'false');
    app.classList.add('is-entering');
    document.body.classList.remove('intro-active');
    window.dispatchEvent(new Event('resize'));
    const homeLink = app.querySelector('.brand');
    if (homeLink) homeLink.focus({ preventScroll: true });
    app.addEventListener('animationend', () => app.classList.remove('is-entering'), { once: true });
  }

  enterButton.addEventListener('click', () => {
    if (dismissed) return;
    enterButton.disabled = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealApp();
      return;
    }
    intro.classList.add('is-exiting');
    window.setTimeout(revealApp, 440);
  });
})();
