/* Hidden admin blog — triple-click the banana logo to sign in. */

const ADMIN_HASH = '323f53abf99d49ca91320286d713abc6bcf1c16eff28e3774946b6452da02476';
const ADMIN_SESSION_KEY = 'tamvu_admin';
const LOCAL_POSTS_KEY = 'tamvu_blog_posts';
const CLICK_WINDOW_MS = 900;

let supabaseClient = null;
let clickCount = 0;
let clickTimer = null;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getConfig() {
  return window.BLOG_CONFIG || {};
}

function hasSupabase() {
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  return Boolean(supabaseUrl && supabaseAnonKey && window.supabase);
}

function initSupabase() {
  if (!hasSupabase()) return null;
  if (!supabaseClient) {
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseClient;
}

function isAdmin() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
}

function setAdmin(on) {
  if (on) sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
  else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  syncAdminUI();
}

function syncAdminUI() {
  const on = isAdmin();
  document.querySelectorAll('.is-admin-only').forEach(el => {
    el.hidden = !on;
  });
  document.body.classList.toggle('admin-mode', on);
  if (on) loadPosts();
  window.dispatchEvent(new Event('tamvu-admin-change'));
}

async function tryLogin(password) {
  const sb = initSupabase();
  const { adminEmail } = getConfig();

  if (sb && adminEmail) {
    const { error } = await sb.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (!error) {
      setAdmin(true);
      return { ok: true };
    }
    return { ok: false, message: 'Wrong password.' };
  }

  const hash = await sha256(password);
  if (hash === ADMIN_HASH) {
    setAdmin(true);
    return { ok: true };
  }
  return { ok: false, message: 'Wrong password.' };
}

async function logout() {
  const sb = initSupabase();
  if (sb) await sb.auth.signOut();
  setAdmin(false);
}

function readLocalPosts() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_POSTS_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLocalPosts(posts) {
  localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(posts));
}

async function fetchPosts() {
  const sb = initSupabase();
  if (sb && isAdmin()) {
    const { data, error } = await sb
      .from('blog_posts')
      .select('id, title, body, post_date, created_at')
      .order('post_date', { ascending: false });
    if (!error && data) return data;
  }
  return readLocalPosts().sort((a, b) => b.post_date.localeCompare(a.post_date));
}

async function savePost({ title, body, post_date }) {
  const sb = initSupabase();
  if (sb && isAdmin()) {
    const { data, error } = await sb
      .from('blog_posts')
      .insert({ title, body, post_date })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const posts = readLocalPosts();
  const post = {
    id: crypto.randomUUID(),
    title,
    body,
    post_date,
    created_at: new Date().toISOString(),
  };
  posts.unshift(post);
  writeLocalPosts(posts);
  return post;
}

async function removePost(id) {
  const sb = initSupabase();
  if (sb && isAdmin()) {
    const { error } = await sb.from('blog_posts').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  writeLocalPosts(readLocalPosts().filter(p => p.id !== id));
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPosts(posts) {
  const list = document.getElementById('blog-list');
  const empty = document.getElementById('blog-empty');
  if (!list) return;

  if (!posts.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  list.innerHTML = posts
    .map(
      post => `
    <article class="blog-post reveal in" data-id="${post.id}">
      <time class="blog-date" datetime="${post.post_date}">${formatDate(post.post_date)}</time>
      <h3 class="blog-title">${escapeHtml(post.title)}</h3>
      <div class="blog-body">${escapeHtml(post.body)}</div>
      <button type="button" class="blog-delete" data-id="${post.id}" aria-label="Delete post">Delete</button>
    </article>`
    )
    .join('');

  list.querySelectorAll('.blog-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this post?')) return;
      await removePost(btn.dataset.id);
      await loadPosts();
    });
  });
}

async function loadPosts() {
  if (!isAdmin()) return;
  const status = document.getElementById('blog-status');
  if (status) status.textContent = 'Loading…';
  try {
    const posts = await fetchPosts();
    renderPosts(posts);
    if (status) {
      status.textContent = hasSupabase()
        ? 'Synced with Supabase'
        : 'Saved locally — add Supabase keys in blog-config.js to sync across devices';
    }
  } catch (err) {
    if (status) status.textContent = 'Could not load posts.';
    console.error(err);
  }
}

function openLoginModal() {
  const modal = document.getElementById('admin-modal');
  const input = document.getElementById('admin-password');
  const err = document.getElementById('admin-error');
  if (!modal || !input) return;
  err.textContent = '';
  input.value = '';
  modal.hidden = false;
  input.focus();
}

function closeLoginModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) modal.hidden = true;
}

function initAdminGate() {
  const glyph = document.querySelector('.mark-glyph');
  if (!glyph) return;

  glyph.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    clickCount += 1;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickCount = 0;
    }, CLICK_WINDOW_MS);

    if (clickCount >= 3) {
      clickCount = 0;
      if (isAdmin()) {
        document.getElementById('blog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        openLoginModal();
      }
    }
  });

  document.getElementById('admin-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = document.getElementById('admin-password');
    const err = document.getElementById('admin-error');
    const result = await tryLogin(input.value);
    if (result.ok) {
      closeLoginModal();
      document.getElementById('blog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      err.textContent = result.message;
      input.select();
    }
  });

  document.getElementById('admin-cancel')?.addEventListener('click', closeLoginModal);
  document.getElementById('admin-modal')?.addEventListener('click', e => {
    if (e.target.id === 'admin-modal') closeLoginModal();
  });

  document.getElementById('blog-logout')?.addEventListener('click', async () => {
    await logout();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('blog-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('blog-title-input').value.trim();
    const body = document.getElementById('blog-body-input').value.trim();
    const post_date = document.getElementById('blog-date-input').value;
    if (!title || !body || !post_date) return;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await savePost({ title, body, post_date });
      e.target.reset();
      document.getElementById('blog-date-input').value = new Date().toISOString().slice(0, 10);
      await loadPosts();
    } catch (err) {
      alert('Could not save post.');
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });

  const dateInput = document.getElementById('blog-date-input');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  syncAdminUI();
}

async function restoreSession() {
  const sb = initSupabase();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) setAdmin(true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminGate();
  restoreSession();
});
