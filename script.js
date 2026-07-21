/* ============================================================
   Tam Vu — portfolio
   Reveal on scroll, scroll-spy, and smooth in-page nav.
   ============================================================ */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', () => {

  /* Reveal on scroll */
  const revealObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

  document.querySelectorAll('.reveal').forEach((el, i) => {
    // stagger siblings so lists cascade rather than pop
    el.style.transitionDelay = `${Math.min(i % 5, 4) * 55}ms`;
    revealObserver.observe(el);
  });

  /* Hairline under the bar once scrolled + nav scroll-spy */
  const topbar = document.querySelector('.topbar');
  const navLinks = [...document.querySelectorAll('.nav a')];
  const sections = navLinks
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  let ticking = false;
  function onScroll() {
    topbar.classList.toggle('stuck', window.scrollY > 20);

    let current = null;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= window.innerHeight * 0.4) current = section;
    }
    navLinks.forEach(a =>
      a.classList.toggle('on', current && a.getAttribute('href') === '#' + current.id));
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScroll);
  }, { passive: true });
  onScroll();

  /* In-page nav, offset for the fixed bar */
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const id = link.getAttribute('href');
      const target = id === '#top' ? document.body : document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const top = id === '#top' ? 0 : target.getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo({ top, behavior: REDUCED ? 'auto' : 'smooth' });
    });
  });
});
