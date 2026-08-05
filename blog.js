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
let postEditId = null;
let postEditThumbUrl = '';
let postEditThumbFile = null;
let postEditReturnToRead = false;
let journalEditId = null;

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

async function getSupabaseSession() {
  const sb = initSupabase();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

function isAdmin() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
}

async function requireSupabaseAuth() {
  if (!hasSupabase()) return;
  const session = await getSupabaseSession();
  if (!session) {
    setAdmin(false);
    throw new Error('Your session expired. Log in again to save changes.');
  }
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

  await requireSupabaseAuth();

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
    await requireSupabaseAuth();
    const { data, error } = await sb.from('blog_posts').insert(payload).select().maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error('Could not publish — check that you are logged in.');
    }
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
    await requireSupabaseAuth();
    const { data, error } = await sb
      .from('blog_posts')
      .update(payload)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error('Could not save — your session may have expired, or this post no longer exists.');
    }
    return data;
  }

  const posts = readLocalPosts().map(p => (p.id === id ? { ...p, ...payload } : p));
  writeLocalPosts(posts);
  return posts.find(p => p.id === id);
}

async function removePost(id) {
  const sb = initSupabase();
  if (sb && isAdmin()) {
    await requireSupabaseAuth();
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fieldText(el) {
  return (el?.textContent || '').trim();
}

function setEditorPlaceholder(el) {
  if (!el) return;
  el.classList.toggle('is-empty', fieldText(el) === '');
}

function showFullScreenView(viewId) {
  const feed = document.getElementById('banana-feed');
  const main = document.getElementById('banana-main');
  const postView = document.getElementById('post-view');
  const journalEditor = document.getElementById('journal-editor');
  if (feed) feed.hidden = true;
  if (main) main.setAttribute('aria-hidden', 'true');
  document.querySelector('.banana-bar')?.setAttribute('aria-hidden', 'true');
  if (postView) postView.hidden = viewId !== 'post-view';
  if (journalEditor) journalEditor.hidden = viewId !== 'journal-editor';
  document.body.classList.add('post-open');
}

function hideFullScreenViews() {
  const feed = document.getElementById('banana-feed');
  const main = document.getElementById('banana-main');
  const postView = document.getElementById('post-view');
  const journalEditor = document.getElementById('journal-editor');
  if (feed) feed.hidden = false;
  if (main) main.removeAttribute('aria-hidden');
  document.querySelector('.banana-bar')?.removeAttribute('aria-hidden');
  if (postView) postView.hidden = true;
  if (journalEditor) journalEditor.hidden = true;
  document.body.classList.remove('post-open');
}

function updatePostThumbUI() {
  const img = document.getElementById('edit-post-thumb');
  const btn = document.getElementById('edit-post-thumb-btn');
  const wrap = document.getElementById('edit-post-thumb-wrap');
  const url = postEditThumbFile ? URL.createObjectURL(postEditThumbFile) : postEditThumbUrl;
  if (!img || !btn || !wrap) return;

  if (url) {
    img.src = url;
    img.hidden = false;
    wrap.classList.add('has-image');
    btn.textContent = 'Change image';
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    wrap.classList.remove('has-image');
    btn.textContent = 'Add image';
  }
}

function enterPostEditMode(item = null, { returnToRead = false } = {}) {
  if (!isAdmin()) return;

  postEditId = item?.id || null;
  postEditThumbUrl = item?.thumbnail_url || '';
  postEditThumbFile = null;
  postEditReturnToRead = returnToRead;

  const dateEl = document.getElementById('edit-post-date');
  const titleEl = document.getElementById('edit-post-title');
  const bodyEl = document.getElementById('edit-post-body');
  const saveBtn = document.getElementById('post-chrome-save');
  const leftBtn = document.getElementById('post-chrome-left');
  const spacer = document.getElementById('post-chrome-spacer');
  if (!dateEl || !titleEl || !bodyEl) return;

  dateEl.value = item?.post_date || todayISO();
  titleEl.textContent = item?.title || '';
  bodyEl.textContent = item?.body || '';
  setEditorPlaceholder(titleEl);
  setEditorPlaceholder(bodyEl);
  updatePostThumbUI();

  document.getElementById('post-read').hidden = true;
  document.getElementById('post-edit').hidden = false;
  document.getElementById('post-view')?.classList.add('post-view--editing');

  if (saveBtn) {
    saveBtn.hidden = false;
    saveBtn.textContent = postEditId ? 'Save' : 'Publish';
  }
  if (leftBtn) leftBtn.textContent = '← Cancel';
  if (spacer) spacer.hidden = true;

  if (!returnToRead) {
    showFullScreenView('post-view');
    document.getElementById('post-view')?.querySelector('.post-view-scroll')?.scrollTo(0, 0);
  }

  titleEl.focus();
}

function exitPostEditMode({ toRead = false, toFeed = false, readId = null } = {}) {
  document.getElementById('post-edit').hidden = true;
  document.getElementById('post-read').hidden = false;
  document.getElementById('post-view')?.classList.remove('post-view--editing');
  document.getElementById('post-chrome-save').hidden = true;
  document.getElementById('post-chrome-spacer').hidden = false;
  document.getElementById('post-chrome-left').textContent = '← All posts';
  document.getElementById('edit-post-thumb-file').value = '';

  postEditId = null;
  postEditThumbUrl = '';
  postEditThumbFile = null;
  postEditReturnToRead = false;

  if (toRead && readId) {
    openPostView(readId, { pushHash: false });
    return;
  }
  if (toFeed) {
    closePostView({ replaceHash: true });
  }
}

function cancelPostEdit() {
  const readId = postEditReturnToRead ? postEditId : null;
  exitPostEditMode({ toRead: Boolean(readId), toFeed: !readId, readId });
}

function openJournalEditor(item = null) {
  if (!isAdmin()) return;

  journalEditId = item?.id || null;
  const dateEl = document.getElementById('edit-journal-date');
  const bodyEl = document.getElementById('edit-journal-body');
  const saveBtn = document.getElementById('journal-chrome-save');
  if (!dateEl || !bodyEl) return;

  dateEl.value = item?.post_date || todayISO();
  bodyEl.textContent = item?.body || '';
  setEditorPlaceholder(bodyEl);
  if (saveBtn) saveBtn.textContent = journalEditId ? 'Save' : 'Save';

  showFullScreenView('journal-editor');
  document.getElementById('journal-editor')?.querySelector('.post-view-scroll')?.scrollTo(0, 0);
  bodyEl.focus();
}

function closeJournalEditor() {
  journalEditId = null;
  hideFullScreenViews();
}

function startEdit(item) {
  if ((item.entry_type || 'post') === 'journal') {
    openJournalEditor(item);
    return;
  }
  const onPostScreen = !document.getElementById('post-view')?.hidden && getPostFromHash() === item.id;
  if (onPostScreen) {
    enterPostEditMode(item, { returnToRead: true });
    return;
  }
  enterPostEditMode(item);
}

async function savePostEditor() {
  if (!isAdmin()) return;

  const title = fieldText(document.getElementById('edit-post-title'));
  const body = fieldText(document.getElementById('edit-post-body'));
  const post_date = document.getElementById('edit-post-date')?.value;
  const saveBtn = document.getElementById('post-chrome-save');

  if (!body || !post_date) return;
  if (!title) {
    alert('Posts need a title.');
    return;
  }
  if (!postEditId && !postEditThumbFile && !postEditThumbUrl) {
    alert('Posts need an image.');
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  try {
    let thumbnail_url = postEditThumbUrl;
    if (postEditThumbFile) {
      thumbnail_url = await uploadThumbnail(postEditThumbFile);
    }

    const payload = {
      entry_type: 'post',
      title,
      body,
      post_date,
      thumbnail_url: thumbnail_url || null,
    };

    let saved;
    if (postEditId) {
      saved = await updatePost(postEditId, payload);
    } else {
      saved = await savePost(payload);
    }

    const returnToRead = postEditReturnToRead;
    const savedId = saved?.id || postEditId;
    await loadAll();

    if (returnToRead && savedId) {
      exitPostEditMode({ toRead: true, readId: savedId });
    } else if (savedId) {
      exitPostEditMode({ toFeed: true });
      openPostView(savedId);
    } else {
      exitPostEditMode({ toFeed: true });
    }
  } catch (err) {
    alert(err.message || (postEditId ? 'Could not save.' : 'Could not publish.'));
    console.error(err);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function saveJournalEditor() {
  if (!isAdmin()) return;

  const body = fieldText(document.getElementById('edit-journal-body'));
  const post_date = document.getElementById('edit-journal-date')?.value;
  const saveBtn = document.getElementById('journal-chrome-save');

  if (!body || !post_date) return;

  if (saveBtn) saveBtn.disabled = true;
  try {
    const payload = {
      entry_type: 'journal',
      title: null,
      body,
      post_date,
      thumbnail_url: null,
    };

    if (journalEditId) {
      await updatePost(journalEditId, payload);
    } else {
      await savePost(payload);
    }

    closeJournalEditor();
    await loadAll();
  } catch (err) {
    alert(journalEditId ? 'Could not save.' : 'Could not save entry.');
    console.error(err);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
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

function getPostFromHash() {
  const match = window.location.hash.match(/^#post\/(.+)$/);
  return match ? match[1] : null;
}

function openPostView(id, { pushHash = true } = {}) {
  const item = postsCache.find(p => p.id === id && (p.entry_type || 'post') === 'post');
  if (!item) return;

  const view = document.getElementById('post-view');
  const scrollEl = view?.querySelector('.post-view-scroll');
  const dateEl = document.getElementById('post-view-date');
  const titleEl = document.getElementById('post-view-title');
  const contentEl = document.getElementById('post-view-content');
  const actionsEl = document.getElementById('post-view-actions');
  if (!view || !dateEl || !titleEl || !contentEl) return;

  document.getElementById('post-read').hidden = false;
  document.getElementById('post-edit').hidden = true;
  view.classList.remove('post-view--editing');
  document.getElementById('post-chrome-save').hidden = true;
  document.getElementById('post-chrome-spacer').hidden = false;
  document.getElementById('post-chrome-left').textContent = '← All posts';

  dateEl.dateTime = item.post_date;
  dateEl.textContent = formatDate(item.post_date);
  titleEl.textContent = item.title || 'Untitled';

  const imageHtml = item.thumbnail_url
    ? `<img class="post-view-img" src="${escapeHtml(item.thumbnail_url)}" alt="" />`
    : '';

  contentEl.innerHTML = `${imageHtml}<div class="post-view-body">${escapeHtml(item.body)}</div>`;

  if (actionsEl) {
    actionsEl.innerHTML = `
      <button type="button" class="blog-edit" data-id="${item.id}">Edit</button>
      <button type="button" class="blog-delete" data-id="${item.id}">Delete</button>`;
    actionsEl.querySelector('.blog-edit')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!isAdmin()) return;
      enterPostEditMode(item, { returnToRead: true });
    });
    actionsEl.querySelector('.blog-delete')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!isAdmin()) return;
      if (!confirm('Delete this post?')) return;
      closePostView({ replaceHash: true });
      await removePost(item.id);
      await loadAll();
    });
  }

  showFullScreenView('post-view');
  document.title = `${item.title || 'Untitled'} — The Banana`;
  if (scrollEl) scrollEl.scrollTop = 0;

  if (pushHash) {
    const nextHash = `#post/${id}`;
    if (window.location.hash !== nextHash) {
      history.pushState({ postId: id }, '', nextHash);
    }
  }
}

function closePostView({ replaceHash = false, useHistory = false } = {}) {
  const view = document.getElementById('post-view');
  if (!view) return;

  if (view.classList.contains('post-view--editing')) {
    cancelPostEdit();
    return;
  }

  if (useHistory && window.location.hash.startsWith('#post/')) {
    history.back();
    return;
  }

  hideFullScreenViews();
  document.title = 'The Banana';

  const base = `${window.location.pathname}${window.location.search}`;
  if (replaceHash || window.location.hash.startsWith('#post/')) {
    history.replaceState(null, '', base);
  }
}

function syncPostViewFromHash() {
  if (document.getElementById('post-view')?.classList.contains('post-view--editing')) return;
  if (!document.getElementById('journal-editor')?.hidden) return;

  const id = getPostFromHash();
  if (id && postsCache.some(p => p.id === id)) {
    openPostView(id, { pushHash: false });
  } else if (!document.getElementById('post-view')?.hidden) {
    closePostView({ replaceHash: true });
  }
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
    <article class="post-card post-card--preview" data-id="${item.id}" tabindex="0" role="link">
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
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!isAdmin()) return;
      const item = postsCache.find(p => p.id === btn.dataset.id);
      if (item) startEdit(item);
    });
  });

  document.querySelectorAll('.blog-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!isAdmin()) return;
      if (!confirm('Delete this item?')) return;
      if (postEditId === btn.dataset.id) cancelPostEdit();
      if (journalEditId === btn.dataset.id) closeJournalEditor();
      if (getPostFromHash() === btn.dataset.id) closePostView({ replaceHash: true });
      await removePost(btn.dataset.id);
      await loadAll();
    });
  });

  postsList.querySelectorAll('.post-card--preview').forEach(card => {
    const open = () => openPostView(card.dataset.id);
    card.addEventListener('click', e => {
      if (e.target.closest('.blog-post-actions')) return;
      open();
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });

  applyPostMosaicLayout();
  syncPostViewFromHash();
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
  document.getElementById('blog-new-post')?.addEventListener('click', () => enterPostEditMode());
  document.getElementById('blog-new-journal')?.addEventListener('click', () => openJournalEditor());
  document.getElementById('post-chrome-left')?.addEventListener('click', () => {
    const editing = document.getElementById('post-view')?.classList.contains('post-view--editing');
    if (editing) cancelPostEdit();
    else closePostView({ useHistory: true });
  });
  document.getElementById('post-chrome-save')?.addEventListener('click', savePostEditor);
  document.getElementById('journal-chrome-cancel')?.addEventListener('click', closeJournalEditor);
  document.getElementById('journal-chrome-save')?.addEventListener('click', saveJournalEditor);

  document.getElementById('edit-post-thumb-btn')?.addEventListener('click', () => {
    document.getElementById('edit-post-thumb-file')?.click();
  });
  document.getElementById('edit-post-thumb')?.addEventListener('click', () => {
    document.getElementById('edit-post-thumb-file')?.click();
  });
  document.getElementById('edit-post-thumb-file')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    postEditThumbFile = file;
    updatePostThumbUI();
  });

  ['edit-post-title', 'edit-post-body', 'edit-journal-body'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => setEditorPlaceholder(el));
    el?.addEventListener('focus', () => setEditorPlaceholder(el));
    el?.addEventListener('blur', () => setEditorPlaceholder(el));
    el?.addEventListener('paste', e => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') || '';
      document.execCommand('insertText', false, text);
    });
  });

  window.addEventListener('popstate', () => {
    if (document.getElementById('post-view')?.classList.contains('post-view--editing')) {
      cancelPostEdit();
    }
    if (!document.getElementById('journal-editor')?.hidden) {
      closeJournalEditor();
    }
    syncPostViewFromHash();
  });
}

let authListenerRegistered = false;

async function restoreSession() {
  const sb = initSupabase();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    setAdmin(Boolean(session));
    if (!authListenerRegistered) {
      authListenerRegistered = true;
      sb.auth.onAuthStateChange((_event, session) => {
        setAdmin(Boolean(session));
      });
    }
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
