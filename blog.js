/* Hidden admin blog — triple-click the banana logo on the home page to sign in. */

const ADMIN_HASH = '323f53abf99d49ca91320286d713abc6bcf1c16eff28e3774946b6452da02476';
const ADMIN_SESSION_KEY = 'tamvu_admin';
const LOCAL_POSTS_KEY = 'tamvu_blog_posts';
const CLICK_WINDOW_MS = 900;
const BLOG_PATH = '/blog.html';
const THUMBNAIL_BUCKET = 'blog-thumbnails';

let supabaseClient = null;
let clickCount = 0;
let clickTimer = null;
let postsCache = [];
let composeType = 'post';

function isBlogPage() {
  return document.body.dataset.page === 'blog';
}

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

function goToBlog() {
  window.location.href = BLOG_PATH;
}

function syncAdminUI() {
  const on = isAdmin();
  document.querySelectorAll('.is-admin-only').forEach(el => {
    el.hidden = !on;
  });
  document.body.classList.toggle('admin-mode', on);
  if (isBlogPage()) loadAll();
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
  window.location.href = '/';
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
  if (sb) {
    const { data, error } = await sb
      .from('blog_posts')
      .select('id, entry_type, title, body, thumbnail_url, post_date, created_at')
      .order('post_date', { ascending: false });
    if (!error && data) return data;
  }
  if (isAdmin()) {
    return readLocalPosts().sort((a, b) => b.post_date.localeCompare(a.post_date));
  }
  return [];
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadThumbnail(file) {
  const sb = initSupabase();
  if (!sb) return fileToDataUrl(file);

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(THUMBNAIL_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  const { data } = sb.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function savePost(payload) {
  const sb = initSupabase();
  if (sb && isAdmin()) {
    const { data, error } = await sb.from('blog_posts').insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  const posts = readLocalPosts();
  const post = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...payload,
  };
  posts.unshift(post);
  writeLocalPosts(posts);
  return post;
}

async function updatePost(id, payload) {
  const sb = initSupabase();
  if (sb && isAdmin()) {
    const { data, error } = await sb
      .from('blog_posts')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const posts = readLocalPosts().map(p => (p.id === id ? { ...p, ...payload } : p));
  writeLocalPosts(posts);
  return posts.find(p => p.id === id);
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
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setComposeType(type) {
  composeType = type;
  document.getElementById('blog-entry-type').value = type;

  document.querySelectorAll('.compose-tab').forEach(tab => {
    const active = tab.dataset.compose === type;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  document.querySelectorAll('.field-post-only').forEach(el => {
    el.hidden = type === 'journal';
  });

  const titleInput = document.getElementById('blog-title-input');
  const thumbInput = document.getElementById('blog-thumbnail-input');
  if (titleInput) titleInput.required = type === 'post';
  if (thumbInput) thumbInput.required = type === 'post' && !document.getElementById('blog-edit-id').value;

  const editId = document.getElementById('blog-edit-id').value;
  if (!editId) {
    const mode = document.getElementById('blog-form-mode');
    if (mode) mode.textContent = type === 'post' ? 'New post' : 'New journal entry';
  }
}

function clearThumbnailPreview() {
  const preview = document.getElementById('blog-thumbnail-preview');
  const urlInput = document.getElementById('blog-thumbnail-url');
  const fileInput = document.getElementById('blog-thumbnail-input');
  if (preview) {
    preview.hidden = true;
    preview.removeAttribute('src');
  }
  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
}

function showThumbnailPreview(url) {
  const preview = document.getElementById('blog-thumbnail-preview');
  const urlInput = document.getElementById('blog-thumbnail-url');
  if (!preview || !url) return;
  preview.src = url;
  preview.hidden = false;
  if (urlInput) urlInput.value = url;
}

function openComposeModal(type = 'post') {
  const modal = document.getElementById('compose-modal');
  if (!modal) return;
  clearEditForm({ keepOpen: true });
  setComposeType(type);
  modal.hidden = false;
  document.getElementById('blog-title-input')?.focus();
}

function closeComposeModal() {
  const modal = document.getElementById('compose-modal');
  if (modal) modal.hidden = true;
}

function clearEditForm({ keepOpen = false } = {}) {
  const form = document.getElementById('blog-form');
  const editId = document.getElementById('blog-edit-id');
  const mode = document.getElementById('blog-form-mode');
  const submitBtn = document.getElementById('blog-submit-btn');
  if (!form || !editId) return;

  form.reset();
  editId.value = '';
  clearThumbnailPreview();
  setComposeType('post');

  if (mode) mode.textContent = 'New post';
  if (submitBtn) submitBtn.textContent = 'Publish';

  const dateInput = document.getElementById('blog-date-input');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  if (!keepOpen) closeComposeModal();
}

function startEdit(item) {
  const editId = document.getElementById('blog-edit-id');
  const mode = document.getElementById('blog-form-mode');
  const submitBtn = document.getElementById('blog-submit-btn');
  if (!editId) return;

  const type = item.entry_type || 'post';
  openComposeModal(type);

  editId.value = item.id;
  document.getElementById('blog-date-input').value = item.post_date;
  document.getElementById('blog-title-input').value = item.title || '';
  document.getElementById('blog-body-input').value = item.body;

  if (item.thumbnail_url) showThumbnailPreview(item.thumbnail_url);
  else clearThumbnailPreview();

  const thumbInput = document.getElementById('blog-thumbnail-input');
  if (thumbInput) thumbInput.required = false;

  if (mode) mode.textContent = type === 'post' ? 'Editing post' : 'Editing journal entry';
  if (submitBtn) submitBtn.textContent = 'Save changes';
}

function applyPostMosaicLayout() {
  const postsList = document.getElementById('posts-list');
  if (!postsList) return;

  postsList.querySelectorAll('.post-card img').forEach(img => {
    const apply = () => {
      const card = img.closest('.post-card');
      if (!card || !img.naturalWidth) return;
      const ratio = img.naturalWidth / img.naturalHeight;
      card.classList.toggle('post-card--wide', ratio >= 1.45);
    };

    if (img.complete) apply();
    else img.addEventListener('load', apply, { once: true });
  });
}

function renderPosts(posts) {
  const postsList = document.getElementById('posts-list');
  const journalList = document.getElementById('journal-list');
  const postsEmpty = document.getElementById('posts-empty');
  const journalEmpty = document.getElementById('journal-empty');
  if (!postsList || !journalList) return;

  postsCache = posts;
  const articles = posts.filter(p => (p.entry_type || 'post') === 'post');
  const journals = posts.filter(p => p.entry_type === 'journal');

  postsEmpty.hidden = articles.length > 0;
  journalEmpty.hidden = journals.length > 0;

  postsList.innerHTML = articles
    .map(
      item => `
    <article class="post-card" data-id="${item.id}">
      <div class="post-card-thumb">
        ${
          item.thumbnail_url
            ? `<img src="${escapeHtml(item.thumbnail_url)}" alt="" loading="lazy" decoding="async" />`
            : '<span class="post-card-thumb-fallback">No image</span>'
        }
      </div>
      <div class="post-card-body">
        <time datetime="${item.post_date}">${formatDate(item.post_date)}</time>
        <h3>${escapeHtml(item.title || 'Untitled')}</h3>
        <p>${escapeHtml(item.body)}</p>
        <div class="blog-post-actions">
          <button type="button" class="blog-edit" data-id="${item.id}">Edit</button>
          <button type="button" class="blog-delete" data-id="${item.id}">Delete</button>
        </div>
      </div>
    </article>`
    )
    .join('');

  journalList.innerHTML = journals
    .map(
      item => `
    <article class="journal-entry" data-id="${item.id}">
      <time class="journal-date" datetime="${item.post_date}">${formatDate(item.post_date)}</time>
      <div class="journal-body">${escapeHtml(item.body)}</div>
      <div class="blog-post-actions">
        <button type="button" class="blog-edit" data-id="${item.id}">Edit</button>
        <button type="button" class="blog-delete" data-id="${item.id}">Delete</button>
      </div>
    </article>`
    )
    .join('');

  document.querySelectorAll('.blog-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isAdmin()) return;
      const item = postsCache.find(p => p.id === btn.dataset.id);
      if (item) startEdit(item);
    });
  });

  document.querySelectorAll('.blog-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!isAdmin()) return;
      if (!confirm('Delete this item?')) return;
      const editingId = document.getElementById('blog-edit-id')?.value;
      if (editingId === btn.dataset.id) clearEditForm();
      await removePost(btn.dataset.id);
      await loadAll();
    });
  });

  applyPostMosaicLayout();
}

async function loadAll() {
  if (!isBlogPage()) return;
  const status = document.getElementById('blog-status');
  if (status && isAdmin()) status.textContent = 'Loading…';
  try {
    const posts = await fetchPosts();
    renderPosts(posts);
    if (status && isAdmin()) {
      status.textContent = hasSupabase()
        ? 'Synced with Supabase'
        : 'Saved locally — add Supabase keys in blog-config.js to sync across devices';
    }
  } catch (err) {
    if (status && isAdmin()) status.textContent = 'Could not load posts.';
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

function onLoginSuccess() {
  closeLoginModal();
  if (isBlogPage()) {
    loadAll();
  } else {
    goToBlog();
  }
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
        if (!isBlogPage()) goToBlog();
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
      onLoginSuccess();
    } else {
      err.textContent = result.message;
      input.select();
    }
  });

  document.getElementById('admin-cancel')?.addEventListener('click', closeLoginModal);
  document.getElementById('admin-modal')?.addEventListener('click', e => {
    if (e.target.id === 'admin-modal') closeLoginModal();
  });
}

function initBlogPage() {
  document.getElementById('blog-logout')?.addEventListener('click', logout);
  document.getElementById('blog-cancel-edit')?.addEventListener('click', () => clearEditForm());
  document.getElementById('compose-modal-close')?.addEventListener('click', () => clearEditForm());
  document.getElementById('blog-new-post')?.addEventListener('click', () => openComposeModal('post'));
  document.getElementById('blog-new-journal')?.addEventListener('click', () => openComposeModal('journal'));

  document.getElementById('compose-modal')?.addEventListener('click', e => {
    if (e.target.id === 'compose-modal') clearEditForm();
  });

  document.querySelectorAll('.compose-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (document.getElementById('blog-edit-id').value) return;
      setComposeType(tab.dataset.compose);
    });
  });

  document.getElementById('blog-thumbnail-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) showThumbnailPreview(URL.createObjectURL(file));
  });

  document.getElementById('blog-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!isAdmin()) return;

    const entry_type = document.getElementById('blog-entry-type').value;
    const title = document.getElementById('blog-title-input').value.trim();
    const body = document.getElementById('blog-body-input').value.trim();
    const post_date = document.getElementById('blog-date-input').value;
    const editId = document.getElementById('blog-edit-id').value;
    const thumbFile = document.getElementById('blog-thumbnail-input').files?.[0];
    let thumbnail_url = document.getElementById('blog-thumbnail-url').value;

    if (!body || !post_date) return;

    if (entry_type === 'post') {
      if (!title) {
        alert('Posts need a title.');
        return;
      }
      if (!editId && !thumbFile && !thumbnail_url) {
        alert('Posts need a thumbnail image.');
        return;
      }
    }

    const btn = document.getElementById('blog-submit-btn');
    btn.disabled = true;

    try {
      if (thumbFile) {
        thumbnail_url = await uploadThumbnail(thumbFile);
      }

      const payload = {
        entry_type,
        title: entry_type === 'post' ? title : null,
        body,
        post_date,
        thumbnail_url: entry_type === 'post' ? thumbnail_url || null : null,
      };

      if (editId) {
        await updatePost(editId, payload);
      } else {
        await savePost(payload);
      }

      clearEditForm();
      await loadAll();
    } catch (err) {
      alert(editId ? 'Could not update.' : 'Could not publish.');
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });

}

async function restoreSession() {
  const sb = initSupabase();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) setAdmin(true);
  }
}

async function initBlogPageFlow() {
  if (!isBlogPage()) return;
  await restoreSession();
  initBlogPage();
  syncAdminUI();
}

document.addEventListener('DOMContentLoaded', async () => {
  initAdminGate();

  if (isBlogPage()) {
    await initBlogPageFlow();
  } else {
    await restoreSession();
    syncAdminUI();
  }
});
