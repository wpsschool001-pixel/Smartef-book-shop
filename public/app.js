(() => {
  const state = {
    categories: [],
    categoryById: {},
    allBooks: [],      // for the shelf — full collection, unfiltered
    category: '',
    sort: 'title',
    query: '',
    isAdmin: false,
    email: '',
  };

  const els = {
    shelfScroll: document.getElementById('shelfScroll'),
    chipRow: document.getElementById('chipRow'),
    grid: document.getElementById('bookGrid'),
    emptyState: document.getElementById('emptyState'),
    searchInput: document.getElementById('searchInput'),
    resultCount: document.getElementById('resultCount'),
    sortSelect: document.getElementById('sortSelect'),
    panelBackdrop: document.getElementById('panelBackdrop'),
    detailPanel: document.getElementById('detailPanel'),
    panelBody: document.getElementById('panelBody'),
    panelClose: document.getElementById('panelClose'),
    mainBrowse: document.getElementById('mainBrowse'),
    mainCatalog: document.getElementById('mainCatalog'),
    wishlistSection: document.getElementById('wishlistSection'),
    wishlistGrid: document.getElementById('wishlistGrid'),
    wishlistEmptyState: document.getElementById('wishlistEmptyState'),
    wishlistBtn: document.getElementById('wishlistBtn'),
    wishlistCount: document.getElementById('wishlistCount'),
    closeWishlistBtn: document.getElementById('closeWishlistBtn'),
  };

  // ---------- wishlist (localStorage only — no account system) ----------
  const WISHLIST_KEY = 'smartef:wishlist';
  function getWishlist() {
    try { return JSON.parse(localStorage.getItem(WISHLIST_KEY)) || []; }
    catch { return []; }
  }
  function toggleWishlist(id) {
    const list = getWishlist();
    const idx = list.indexOf(id);
    if (idx === -1) list.push(id); else list.splice(idx, 1);
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
    updateWishlistCount();
    return list.includes(id);
  }
  function updateWishlistCount() {
    els.wishlistCount.textContent = `(${getWishlist().length})`;
  }

  // ---------- deterministic "randomness" so a spine's height doesn't jump on re-render ----------
  function seededHeight(id) {
    const seed = (id * 2654435761) % 2 ** 32;
    const t = (seed / 2 ** 32);
    return Math.round(150 + t * 40); // 150–190px
  }
  function spineWidth(pages) {
    const min = 90, max = 520, wMin = 22, wMax = 56;
    const clamped = Math.max(min, Math.min(max, pages));
    return Math.round(wMin + ((clamped - min) / (max - min)) * (wMax - wMin));
  }

  function starString(rating) {
    return `★ ${rating.toFixed(1)}`;
  }

  function formatPrice(price) {
    if (price === 0) return 'Free';
    return `₦${Math.round(price).toLocaleString('en-NG')}`;
  }

  // ---------- rendering ----------
  function renderShelf(books) {
    const sorted = [...books].sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.title.localeCompare(b.title));
    els.shelfScroll.innerHTML = sorted.map((b) => {
      const cat = state.categoryById[b.categoryId];
      const h = seededHeight(b.id);
      const w = spineWidth(b.pages);
      return `
        <div class="spine" role="listitem" tabindex="0"
             data-id="${b.id}"
             style="height:${h}px; width:${w}px; background:${cat.color};"
             title="${escapeAttr(b.title)} — ${escapeAttr(b.author)}">
          <span class="spine-label" style="color:#fff;">${escapeHtml(b.title)}</span>
        </div>`;
    }).join('');
  }

  function renderChips(categories) {
    const rest = categories.map((c) => `
      <button class="chip" data-category="${c.id}" role="tab" aria-selected="false">${escapeHtml(c.name)}</button>
    `).join('');
    els.chipRow.innerHTML = `
      <button class="chip is-active" data-category="" role="tab" aria-selected="true">All sections</button>
      ${rest}
    `;
  }

  function bookCardHtml(b) {
    const cat = b.category || state.categoryById[b.categoryId];
    const lowStock = b.stock > 0 && b.stock <= 5;
    const outOfStock = b.stock === 0;
    const ratingCell = outOfStock
      ? `<span class="card-rating low-stock">Out of stock</span>`
      : lowStock
        ? `<span class="card-rating low-stock">Only ${b.stock} left</span>`
        : `<span class="card-rating">${starString(b.rating)}</span>`;
    return `
      <button class="card" data-id="${b.id}">
        <div class="card-cover" style="background:linear-gradient(160deg, ${cat.color}, ${shade(cat.color, -30)});">
          <span class="card-tag">${b.year}</span>
          <span class="initial">${escapeHtml(b.title[0])}</span>
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(b.title)}</div>
          <div class="card-author">${escapeHtml(b.author)}</div>
          <div class="card-meta">
            <span class="card-price">${b.unlocked === false ? '🔒 ' : ''}${formatPrice(b.price)}</span>
            ${ratingCell}
          </div>
        </div>
      </button>`;
  }

  function renderGrid(books) {
    els.emptyState.hidden = books.length > 0;
    els.grid.innerHTML = books.map(bookCardHtml).join('');
  }

  function renderWishlist() {
    const ids = getWishlist();
    const books = state.allBooks.filter((b) => ids.includes(b.id));
    els.wishlistEmptyState.hidden = books.length > 0;
    els.wishlistGrid.innerHTML = books.map(bookCardHtml).join('');
  }

  function shade(hex, percent) {
    const n = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
    const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  // ---------- detail panel ----------
  async function openPanel(book) {
    const cat = book.category || state.categoryById[book.categoryId];
    const saved = getWishlist().includes(book.id);
    const outOfStock = book.stock === 0;
    const lowStock = book.stock > 0 && book.stock <= 5;

    let accessHtml;
    if (book.unlocked) {
      accessHtml = book.hasFile
        ? `<div class="access-box">
             <p>You have full access to this book.</p>
             <a class="btn" href="/api/books/${book.id}/file" target="_blank" rel="noopener">Download book file</a>
           </div>`
        : `<div class="access-box"><p>No file has been uploaded for this book yet.</p></div>`;
    } else {
      accessHtml = `<div class="lock-banner">
          <p>🔒 This book is locked. Pay to read it.</p>
          <a class="btn" href="/pay.html?book=${book.id}">Go to payment — ${formatPrice(book.price)}</a>
        </div>`;
    }

    els.panelBody.innerHTML = `
      <div class="panel-cover" style="background:linear-gradient(160deg, ${cat.color}, ${shade(cat.color, -30)});">
        <span class="initial">${escapeHtml(book.title[0])}</span>
      </div>
      <span class="panel-category" style="background:${cat.color}; color:#fff;">${escapeHtml(cat.name)}</span>
      <h3 class="panel-title">${escapeHtml(book.title)}</h3>
      <p class="panel-author">by ${escapeHtml(book.author)}</p>
      <div class="panel-stats">
        <span><strong>${book.pages}</strong> pages</span>
        <span><strong>${book.year}</strong></span>
        <span><strong>${starString(book.rating)}</strong></span>
      </div>
      <p class="panel-price">${formatPrice(book.price)}</p>
      <p class="panel-description">${escapeHtml(book.description)}</p>
      ${accessHtml}
      <div class="panel-actions">
        <button class="btn btn-ghost ${saved ? 'is-saved' : ''}" id="panelWishlistBtn" data-id="${book.id}">
          ${saved ? '✓ On your reading list' : '+ Save to reading list'}
        </button>
      </div>
      <p class="stock-note ${lowStock || outOfStock ? 'low' : ''}">
        ${outOfStock ? 'Currently out of stock.' : lowStock ? `Only ${book.stock} copies left in stock.` : `${book.stock} in stock.`}
      </p>
      <div class="review-section" id="reviewSection">
        <h4>Reader reviews</h4>
        <div class="review-form">
          <div class="review-stars" id="reviewStars">
            ${[1,2,3,4,5].map((n) => `<button type="button" data-star="${n}">★</button>`).join('')}
          </div>
          <textarea id="reviewText" placeholder="What did you think of this book? (optional)"></textarea>
          <button class="btn btn-ghost" id="submitReviewBtn" type="button">Submit review</button>
          <p class="stock-note" id="reviewStatus"></p>
        </div>
        <div id="reviewList">Loading reviews…</div>
      </div>
    `;

    document.getElementById('panelWishlistBtn').addEventListener('click', (e) => {
      const isSaved = toggleWishlist(book.id);
      e.target.textContent = isSaved ? '✓ On your reading list' : '+ Save to reading list';
      e.target.classList.toggle('is-saved', isSaved);
    });

    setUpReviewForm(book.id);
    loadReviews(book.id);

    els.detailPanel.classList.add('is-open');
    els.panelBackdrop.classList.add('is-open');
    els.detailPanel.setAttribute('aria-hidden', 'false');
    els.panelClose.focus();
  }

  function closePanel() {
    els.detailPanel.classList.remove('is-open');
    els.panelBackdrop.classList.remove('is-open');
    els.detailPanel.setAttribute('aria-hidden', 'true');
  }

  // ---------- reviews ----------
  let selectedStars = 0;

  function setUpReviewForm(bookId) {
    selectedStars = 0;
    const starButtons = document.querySelectorAll('#reviewStars button');
    starButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedStars = Number(btn.dataset.star);
        starButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.star) <= selectedStars));
      });
    });

    document.getElementById('submitReviewBtn').addEventListener('click', async () => {
      const statusEl = document.getElementById('reviewStatus');
      if (!selectedStars) {
        statusEl.textContent = 'Pick a star rating first.';
        return;
      }
      const text = document.getElementById('reviewText').value.trim();
      statusEl.textContent = 'Submitting…';
      try {
        const res = await fetch(`/api/books/${bookId}/reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: selectedStars, text }),
        });
        const data = await res.json();
        if (!res.ok) {
          statusEl.textContent = data.error || 'Could not submit review.';
          return;
        }
        statusEl.textContent = 'Thanks for your review!';
        loadReviews(bookId);
      } catch {
        statusEl.textContent = 'Could not reach the server.';
      }
    });
  }

  async function loadReviews(bookId) {
    const listEl = document.getElementById('reviewList');
    try {
      const res = await fetch(`/api/books/${bookId}/reviews`);
      const data = await res.json();
      if (!data.reviews.length) {
        listEl.innerHTML = '<p class="stock-note">No reviews yet — be the first.</p>';
        return;
      }
      listEl.innerHTML = data.reviews.map((r) => `
        <div class="review-item">
          <div class="review-meta">
            <span>${escapeHtml(r.username)}</span>
            <span>${new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
          <div class="review-stars-display">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
          ${r.text ? `<p>${escapeHtml(r.text)}</p>` : ''}
        </div>
      `).join('');
    } catch {
      listEl.innerHTML = '<p class="stock-note">Could not load reviews.</p>';
    }
  }

  // ---------- account ----------
  async function loadAccount() {
    const res = await fetch('/api/me');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();
    state.isAdmin = Boolean(data.isAdmin);
    state.email = data.email || '';
    document.getElementById('accountUsername').textContent = `Signed in as ${data.username}${state.isAdmin ? ' (admin)' : ''}`;
    document.getElementById('adminLink').hidden = !state.isAdmin;
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
  });

  // ---------- wishlist section toggle ----------
  els.wishlistBtn.addEventListener('click', () => {
    renderWishlist();
    els.wishlistSection.hidden = false;
    els.mainBrowse.hidden = true;
    els.mainCatalog.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  els.closeWishlistBtn.addEventListener('click', () => {
    els.wishlistSection.hidden = true;
    els.mainBrowse.hidden = false;
    els.mainCatalog.hidden = false;
  });

  // ---------- data loading ----------
  async function loadCategories() {
    const res = await fetch('/api/categories');
    if (res.status === 401) return window.location.href = '/';
    state.categories = await res.json();
    state.categoryById = Object.fromEntries(state.categories.map((c) => [c.id, c]));
    renderChips(state.categories);
  }

  async function loadShelf() {
    const res = await fetch('/api/books');
    if (res.status === 401) return window.location.href = '/';
    const data = await res.json();
    state.allBooks = data.books;
    renderShelf(state.allBooks);
  }

  async function loadGrid() {
    const params = new URLSearchParams();
    if (state.category) params.set('category', state.category);
    if (state.query) params.set('q', state.query);
    if (state.sort) params.set('sort', state.sort);

    const res = await fetch(`/api/books?${params.toString()}`);
    if (res.status === 401) return window.location.href = '/';
    const data = await res.json();
    renderGrid(data.books);
    els.resultCount.textContent = `${data.count} book${data.count === 1 ? '' : 's'}`;
  }

  // ---------- events ----------
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function findBookById(id) {
    return state.allBooks.find((b) => b.id === id);
  }

  document.addEventListener('click', (e) => {
    const spine = e.target.closest('.spine');
    const card = e.target.closest('.card');
    const chip = e.target.closest('.chip[data-category]');

    if (spine) {
      const book = findBookById(Number(spine.dataset.id));
      if (book) openPanel(book);
    }
    if (card) {
      const book = findBookById(Number(card.dataset.id));
      if (book) openPanel(book);
    }
    if (chip) {
      document.querySelectorAll('.chip[data-category]').forEach((c) => {
        c.classList.remove('is-active');
        c.setAttribute('aria-selected', 'false');
      });
      chip.classList.add('is-active');
      chip.setAttribute('aria-selected', 'true');
      state.category = chip.dataset.category;
      loadGrid();
    }
    if (e.target === els.panelClose || e.target === els.panelBackdrop) {
      closePanel();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter' && document.activeElement.classList.contains('spine')) {
      document.activeElement.click();
    }
  });

  els.searchInput.addEventListener('input', debounce((e) => {
    state.query = e.target.value.trim();
    loadGrid();
  }, 250));

  els.sortSelect.addEventListener('change', (e) => {
    state.sort = e.target.value;
    loadGrid();
  });

  // ---------- boot ----------
  (async function init() {
    await loadAccount();
    await loadCategories();
    await loadShelf();
    await loadGrid();
    updateWishlistCount();
  })();
})();
