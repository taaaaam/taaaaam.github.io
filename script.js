/* ============================================================
   Tam Vu — portfolio
   Reveal on scroll, scroll-spy, smooth in-page nav, and the
   portrait's cursor-tracking eyes.
   ============================================================ */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Eyes that follow the cursor ───────────────────────────────
   Pupils are nudged toward the pointer and eased, so they drift
   rather than snap. Everything is computed in the SVG's own user
   units (viewBox is 0 0 100 100), which keeps it resolution- and
   layout-independent.                                        */

function initEyes() {
  if (REDUCED) return;
  // Every portrait on the page follows the cursor — the hero head and
  // each of the scene heads (forge, desk, phone). Each is wired up
  // independently against its own bounding box, so they all aim true
  // regardless of where they sit.
  document.querySelectorAll('.face-eyes').forEach(setupEyes);
}

function setupEyes(svg) {
  const pupils = [...svg.querySelectorAll('.fc-pupil')].map(el => ({
    el,
    // rest position, in user units
    cx: parseFloat(el.getAttribute('cx')),
    cy: parseFloat(el.getAttribute('cy')),
    x: 0, y: 0,      // current offset
    tx: 0, ty: 0,    // target offset
  }));
  if (!pupils.length) return;

  const TRAVEL = 3;          // how far a pupil may leave centre (stays inside the ring)
  const REACH = 46;          // distance at which the eyes are fully deflected
  let raf = null;

  function target(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    // screen -> viewBox units
    const vx = ((clientX - r.left) / r.width) * 100;
    const vy = ((clientY - r.top) / r.height) * 100;

    for (const p of pupils) {
      const dx = vx - p.cx;
      const dy = vy - p.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const pull = Math.min(1, dist / REACH) * TRAVEL;
      p.tx = (dx / dist) * pull;
      p.ty = (dy / dist) * pull;
    }
  }

  function tick() {
    raf = null;
    let moving = false;
    for (const p of pupils) {
      p.x += (p.tx - p.x) * 0.2;
      p.y += (p.ty - p.y) * 0.2;
      if (Math.abs(p.tx - p.x) > 0.004 || Math.abs(p.ty - p.y) > 0.004) moving = true;
      p.el.style.transform = `translate(${p.x.toFixed(3)}px, ${p.y.toFixed(3)}px)`;
    }
    if (moving) raf = requestAnimationFrame(tick);
  }

  // Advance and paint synchronously on every move, then let the eased
  // loop carry on. Driving it purely from rAF means the eyes appear
  // frozen whenever the frame callback is throttled.
  function aim(clientX, clientY) {
    target(clientX, clientY);
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    tick();
  }

  window.addEventListener('pointermove', e => aim(e.clientX, e.clientY), { passive: true });

  // look back to centre when the pointer leaves the window
  window.addEventListener('pointerleave', () => {
    for (const p of pupils) { p.tx = 0; p.ty = 0; }
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    tick();
  });
}

/* ── Banana bonk ───────────────────────────────────────────────
   Click the portrait: a banana drops from above the viewport,
   accelerates under gravity, bonks the head (shake + >.< eyes),
   then ricochets off to a random side, spinning. Coordinates are
   viewport px; the impact line is taken from the face's live
   bounding rect so it works at any layout size.              */

function initBananaBonk() {
  const svg = document.querySelector('.face');
  if (!svg) return;

  const BANANA_W = 74;
  const BANANA_H = BANANA_W * 1.21; // source image is 1591×1920
  const GRAVITY = 2600;             // px/s²
  let active = false;
  let ouchTimer = null;

  function bonk() {
    svg.classList.remove('bonked');
    void svg.getBoundingClientRect(); // restart the shake animation
    svg.classList.add('bonked');
    clearTimeout(ouchTimer);
    ouchTimer = setTimeout(() => svg.classList.remove('bonked'), 900);
  }

  svg.addEventListener('click', () => {
    // Under reduced motion, skip the projectile but still wince.
    if (REDUCED) { bonk(); return; }
    if (active) return;
    active = true;

    const banana = document.createElement('img');
    banana.src = 'banana.png';
    banana.alt = '';
    banana.className = 'banana-fall';
    document.body.appendChild(banana);

    const rect = svg.getBoundingClientRect();
    const headTopY = rect.top + rect.height * 0.1; // just above the hair spikes
    const dir = Math.random() < 0.5 ? -1 : 1;

    let x = rect.left + rect.width / 2 - BANANA_W / 2;
    let y = -BANANA_H - 10;
    let vx = 0, vy = 0, rot = 0, vr = 0;
    let phase = 'fall';
    let last = performance.now();

    banana.style.transform = `translate(${x}px, ${y}px)`;

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      rot += vr * dt;

      if (phase === 'fall' && y + BANANA_H >= headTopY) {
        phase = 'bounce';
        vy = -520;                              // pop back up off the head
        vx = dir * (280 + Math.random() * 180); // and off to one side
        vr = dir * (360 + Math.random() * 200);
        bonk();
      }

      banana.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;

      const gone =
        y > window.innerHeight + BANANA_H ||
        x < -BANANA_W * 3 ||
        x > window.innerWidth + BANANA_W * 3;
      if (gone) {
        banana.remove();
        active = false;
      } else {
        requestAnimationFrame(frame);
      }
    }
    requestAnimationFrame(frame);
  });
}

/* ── Card videos — play only while on screen ───────────────────
   Autoplaying muted video is cheap, but only worth spending while
   the card is visible. Under reduced-motion we never play; the
   poster frame stands in.                                     */

function initCardVideos() {
  const videos = [...document.querySelectorAll('.card-video')];
  if (!videos.length) return;

  if (REDUCED) return; // poster stays, no motion

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) {
        v.play().catch(() => {}); // ignore autoplay rejections
      } else {
        v.pause();
      }
    }
  }, { threshold: 0.25 });

  videos.forEach(v => io.observe(v));
}

document.addEventListener('DOMContentLoaded', () => {
  initEyes();
  initBananaBonk();
  initCardVideos();

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
