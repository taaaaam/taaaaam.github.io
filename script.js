function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.add('active');
    }

    const activeLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }

    document.getElementById('nav-links').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function type(element, text, speed, keepCursor) {
    for (let i = 0; i < text.length; i++) {
        element.innerHTML = text.substring(0, i + 1) + '<span class="cursor">|</span>';
        await sleep(speed);
    }
    element.innerHTML = keepCursor
        ? text + '<span class="blinking-cursor">|</span>'
        : text;
}

document.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('header');
    const desc1 = document.getElementById('desc1');
    const desc2 = document.getElementById('desc2');
    const desc3 = document.getElementById('desc3');
    const desc4 = document.getElementById('desc4');
    const desc5 = document.getElementById('desc5');
    const heroActions = document.getElementById('hero-actions');

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            showSection(link.dataset.section);
        });
    });

    document.getElementById('nav-toggle').addEventListener('click', () => {
        document.getElementById('nav-links').classList.toggle('open');
    });

    async function runTypingAnimations() {
        const yaleLink = '<a id="Yale-Link" href="https://www.yale.edu" target="_blank">Yale University</a>';
        const brighterwayLink = '<a id="Brighterway-Link" href="https://brighterway.ai" target="_blank">Brighterway</a>';
        const playanagramsLink = '<a id="Playanagrams-Link" href="https://playanagrams.com" target="_blank">playanagrams.com</a>';

        await type(header, 'Tam Vu.', 40, false);

        const line1 = 'Software Engineer at ';
        await type(desc1, line1, 10, false);
        desc1.innerHTML = line1 + brighterwayLink;

        const line2 = 'BS Computer Science from ';
        await type(desc2, line2, 10, false);
        desc2.innerHTML = line2 + yaleLink;

        const line3 = 'BS Statistics & Data Science from ';
        await type(desc3, line3, 10, false);
        desc3.innerHTML = line3 + yaleLink;

        const line4 = 'Creator of ';
        await type(desc4, line4, 10, false);
        desc4.innerHTML = line4 + playanagramsLink;

        await type(desc5, 'ML, backend systems, and full-stack product development', 10, true);

        heroActions.style.opacity = '1';
    }

    runTypingAnimations();
    showSection('home');
    initHeroBackground();
});

function initHeroBackground() {
    const canvas = document.getElementById('hero-canvas');
    const glow = document.getElementById('hero-glow');
    const home = document.getElementById('home');
    if (!canvas || !home) return;

    const ctx = canvas.getContext('2d');
    let width, height, animationId, startTime;
    let mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    let blobs = [];
    let stars = [];

    const palette = [
        { core: 'rgba(255, 107, 74, 0.45)', edge: 'rgba(255, 107, 74, 0)' },
        { core: 'rgba(62, 207, 189, 0.38)', edge: 'rgba(62, 207, 189, 0)' },
        { core: 'rgba(155, 123, 255, 0.32)', edge: 'rgba(155, 123, 255, 0)' },
        { core: 'rgba(240, 192, 64, 0.22)', edge: 'rgba(240, 192, 64, 0)' },
        { core: 'rgba(255, 148, 120, 0.28)', edge: 'rgba(255, 148, 120, 0)' },
    ];

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function resize() {
        width = home.offsetWidth;
        height = home.offsetHeight;
        canvas.width = width;
        canvas.height = height;
        mouse.x = mouse.tx = width * 0.5;
        mouse.y = mouse.ty = height * 0.45;

        blobs = palette.map((color, i) => ({
            color,
            anchorX: width * (0.2 + i * 0.15),
            anchorY: height * (0.3 + (i % 3) * 0.18),
            x: 0,
            y: 0,
            radius: Math.min(width, height) * (0.28 + i * 0.06),
            phase: i * 1.4 + Math.random(),
            speed: 0.00025 + i * 0.00006,
            drift: 0.08 + i * 0.015,
        }));

        const starCount = Math.min(120, Math.floor((width * height) / 9000));
        stars = Array.from({ length: starCount }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 1.2 + 0.3,
            phase: Math.random() * Math.PI * 2,
            speed: 0.002 + Math.random() * 0.004,
            drift: (Math.random() - 0.5) * 0.08,
        }));
    }

    function drawBlob(blob, t) {
        const waveX = Math.sin(t * blob.speed * 1000 + blob.phase) * width * blob.drift;
        const waveY = Math.cos(t * blob.speed * 800 + blob.phase * 1.3) * height * blob.drift * 0.7;
        const targetX = blob.anchorX + waveX + (mouse.x - width * 0.5) * (0.06 + blob.drift);
        const targetY = blob.anchorY + waveY + (mouse.y - height * 0.5) * (0.06 + blob.drift);

        blob.x = lerp(blob.x || targetX, targetX, 0.025);
        blob.y = lerp(blob.y || targetY, targetY, 0.025);

        const grad = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.radius);
        grad.addColorStop(0, blob.color.core);
        grad.addColorStop(0.45, blob.color.core.replace(/[\d.]+\)$/, '0.08)'));
        grad.addColorStop(1, blob.color.edge);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawStars(t) {
        for (const star of stars) {
            star.y += star.drift;
            if (star.y > height) star.y = 0;

            const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * star.speed * 1000 + star.phase));
            const dx = mouse.x - star.x;
            const dy = mouse.y - star.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const pull = Math.max(0, 1 - dist / 200) * 0.6;

            ctx.beginPath();
            ctx.arc(star.x + dx * pull * 0.04, star.y + dy * pull * 0.04, star.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(244, 240, 232, ${twinkle * 0.5})`;
            ctx.fill();
        }
    }

    function draw(t) {
        if (!startTime) startTime = t;
        const elapsed = t - startTime;

        mouse.x = lerp(mouse.x, mouse.tx, 0.06);
        mouse.y = lerp(mouse.y, mouse.ty, 0.06);

        if (glow) {
            glow.style.left = mouse.x + 'px';
            glow.style.top = mouse.y + 'px';
        }

        ctx.clearRect(0, 0, width, height);

        ctx.globalCompositeOperation = 'lighter';
        for (const blob of blobs) drawBlob(blob, elapsed);
        ctx.globalCompositeOperation = 'source-over';

        drawStars(elapsed);

        animationId = requestAnimationFrame(draw);
    }

    home.addEventListener('mousemove', (e) => {
        const rect = home.getBoundingClientRect();
        mouse.tx = e.clientX - rect.left;
        mouse.ty = e.clientY - rect.top;
    });

    home.addEventListener('mouseleave', () => {
        mouse.tx = width * 0.5;
        mouse.ty = height * 0.45;
    });

    window.addEventListener('resize', resize);

    resize();
    animationId = requestAnimationFrame(draw);

    const observer = new MutationObserver(() => {
        if (home.classList.contains('active')) {
            cancelAnimationFrame(animationId);
            startTime = null;
            resize();
            animationId = requestAnimationFrame(draw);
        } else {
            cancelAnimationFrame(animationId);
        }
    });
    observer.observe(home, { attributes: true, attributeFilter: ['class'] });
}
