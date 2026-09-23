const toggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('#mobile-nav');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  mobileNav.hidden = !open;
});
mobileNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  mobileNav.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
}));

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktopScroll = window.matchMedia('(min-width: 1025px) and (hover: hover) and (pointer: fine)');
let locomotiveScroll;

function syncScrollMode() {
  if (desktopScroll.matches && !reducedMotion.matches && window.LocomotiveScroll) {
    locomotiveScroll ??= new window.LocomotiveScroll({
      lenisOptions: { smoothTouch: false, duration: 1.05 },
    });
  } else if (locomotiveScroll) {
    locomotiveScroll.destroy();
    locomotiveScroll = null;
  }
}

desktopScroll.addEventListener('change', syncScrollMode);
reducedMotion.addEventListener('change', syncScrollMode);
syncScrollMode();

function scrollToAnchor(target) {
  const start = window.scrollY;
  const offset = window.innerWidth <= 900 ? 22 : 32;
  const destination = Math.max(0, Math.min(
    target.getBoundingClientRect().top + start - offset,
    document.scrollingElement.scrollHeight - window.innerHeight,
  ));
  const focusTarget = () => {
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
    target.focus({ preventScroll: true });
  };

  if (reducedMotion.matches || Math.abs(destination - start) < 2) {
    locomotiveScroll?.scrollTo(destination, { immediate: true });
    window.scrollTo(0, destination);
    focusTarget();
    return;
  }

  if (locomotiveScroll) {
    locomotiveScroll.scrollTo(destination, { duration: 0.8, onComplete: focusTarget });
  } else {
    focusTarget();
    window.scrollTo({ top: destination, behavior: 'smooth' });
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[href*="#"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
  const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
  if (!target) return;
  event.preventDefault();
  if (location.hash !== url.hash) history.pushState(null, '', url.hash);
  scrollToAnchor(target);
});

for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const activate = (tab, focus = false) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
  };
  list.addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && list.contains(tab)) activate(tab);
  });
  list.addEventListener('keydown', event => {
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    activate(tabs[next], true);
  });
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const value = document.getElementById(button.dataset.copy)?.textContent?.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      button.setAttribute('aria-label', 'Setup command copied');
      window.setTimeout(() => {
        button.textContent = 'Copy';
        button.setAttribute('aria-label', 'Copy Linux setup command');
      }, 2200);
    } catch {
      button.textContent = 'Select text';
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(button.dataset.copy));
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
}

const sectionLinks = [...document.querySelectorAll('.main-nav a[href^="#"]')];
if (sectionLinks.length && 'IntersectionObserver' in window) {
  const sections = sectionLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of sectionLinks) {
        if (link.getAttribute('href') === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-30% 0px -55% 0px' });
  sections.forEach(section => observer.observe(section));
}

const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();
