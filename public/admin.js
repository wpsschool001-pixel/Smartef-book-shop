(() => {
  const contentEl = document.getElementById('adminContent');
  let categories = [];
  let books = [];
  let claims = [];

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function init() {
    const meRes = await fetch('/api/me');
    if (meRes.status === 401) {
      window.location.href = '/';
      return;
    }
    const me = await meRes.json();
    if (!me.isAdmin) {
      contentEl.innerHTML = `<div class="unauthorized">
        <p>Only the site admin account can view this page.</p>
        <p><a href="/">← Back to the shop</a></p>
      </div>`;
      return;
    }

    const [catRes, booksRes, claimsRes] = await Promise.all([
      fetch('/api/categories'),
      fetch('/api/books'),
      fetch('/api/payment-claims?status=pending'),
    ]);
    categories = await catRes.json();
    const booksData = await booksRes.json();
    books = booksData.books;
    const claimsData = claimsRes.ok ? await claimsRes.json() : { claims: [] };
    claims = claimsData.claims;

    render();
  }

  function render() {
    contentEl.innerHTML = `
      <div class="admin-panel">
        <h2>Add a new book</h2>
        <form id="addForm">
          <div class="form-grid">
            <div class="form-field"><label>Title</label><input name="title" required /></div>
            <div class="form-field"><label>Author</label><input name="author" required /></div>
            <div class="form-field">
              <label>Section</label>
              <select name="categoryId" required>
                ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-field"><label>Price (₦, 0 = free)</label><input name="price" type="number" min="0" step="1" required /></div>
            <div class="form-field"><label>Pages</label><input name="pages" type="number" min="1" required /></div>
            <div class="form-field"><label>Year</label><input name="year" type="number" required value="${new Date().getFullYear()}" /></div>
            <div class="form-field full"><label>Description</label><textarea name="description"></textarea></div>
            <div class="form-field full"><label>Book file (optional now — you can upload it later below)</label><input type="file" name="file" accept=".docx,.doc,.pdf,.txt" /></div>
          </div>
          <button class="admin-submit" type="submit">Add book</button>
          <p class="form-status" id="addStatus"></p>
        </form>
      </div>

      <div class="admin-panel">
        <h2>Pending manual payments${claims.length ? ` (${claims.length})` : ''}</h2>
        <div id="claimList"></div>
      </div>

      <div class="admin-panel">
        <h2>Manage books</h2>
        <div id="bookList"></div>
      </div>
    `;

    document.getElementById('addForm').addEventListener('submit', handleAddBook);
    renderBookList();
    renderClaimList();
  }

  function renderClaimList() {
    const listEl = document.getElementById('claimList');
    if (!claims.length) {
      listEl.innerHTML = '<p class="form-status">No pending bank transfer or crypto payments.</p>';
      return;
    }
    listEl.innerHTML = claims.map((c) => `
      <div class="claim-row">
        <span class="claim-method">${c.method === 'crypto' ? 'Crypto' : 'Bank transfer'}</span>
        <div class="claim-info">
          <strong>${escapeHtml(c.bookTitle)}</strong>
          <span>from ${escapeHtml(c.username)} · ${new Date(c.createdAt).toLocaleString()}</span>
          ${c.note ? `<span>Note: ${escapeHtml(c.note)}</span>` : ''}
        </div>
        <button class="claim-approve" id="approve-${c.id}" type="button">Approve</button>
        <button class="claim-reject" id="reject-${c.id}" type="button">Reject</button>
      </div>
    `).join('');

    claims.forEach((c) => {
      document.getElementById(`approve-${c.id}`).addEventListener('click', () => resolveClaim(c.id, 'approve'));
      document.getElementById(`reject-${c.id}`).addEventListener('click', () => resolveClaim(c.id, 'reject'));
    });
  }

  async function resolveClaim(id, action) {
    await fetch(`/api/payment-claims/${id}/${action}`, { method: 'POST' });
    const res = await fetch('/api/payment-claims?status=pending');
    const data = await res.json();
    claims = data.claims;
    renderClaimList();
    if (action === 'approve') await refreshBooks();
  }

  function renderBookList() {
    const listEl = document.getElementById('bookList');
    const byCategory = categories.map((cat) => ({
      cat,
      items: books.filter((b) => b.categoryId === cat.id),
    }));

    listEl.innerHTML = byCategory.map(({ cat, items }) => `
      <div class="category-group">
        <h3>${escapeHtml(cat.name)} (${items.length})</h3>
        ${items.length ? items.map(bookRowHtml).join('') : '<p class="form-status">No books in this section yet.</p>'}
      </div>
    `).join('');

    books.forEach((b) => {
      const priceInput = document.getElementById(`price-${b.id}`);
      const saveBtn = document.getElementById(`save-${b.id}`);
      if (saveBtn) saveBtn.addEventListener('click', () => savePrice(b.id, priceInput.value));

      const lockBtn = document.getElementById(`lock-${b.id}`);
      if (lockBtn) lockBtn.addEventListener('click', () => toggleLock(b));

      const fileInput = document.getElementById(`file-${b.id}`);
      const uploadBtn = document.getElementById(`upload-${b.id}`);
      if (uploadBtn) uploadBtn.addEventListener('click', () => uploadFile(b.id, fileInput.files[0]));

      const deleteBtn = document.getElementById(`delete-${b.id}`);
      if (deleteBtn) deleteBtn.addEventListener('click', () => deleteBook(b.id, b.title));
    });
  }

  function bookRowHtml(b) {
    const isFree = b.price === 0;
    const isLocked = !isFree && b.locked !== false;
    return `
      <div class="book-row">
        <div class="book-info">
          <strong>${escapeHtml(b.title)}</strong>
          <span>${escapeHtml(b.author)} · ${b.year}</span>
        </div>
        <input class="price-input" id="price-${b.id}" type="number" min="0" step="1" value="${b.price}" />
        <button class="admin-submit" id="save-${b.id}" type="button" style="padding:6px 10px;">Save price</button>
        ${isFree
          ? `<span class="lock-toggle unlocked">Free</span>`
          : `<button class="lock-toggle ${isLocked ? 'locked' : 'unlocked'}" id="lock-${b.id}" type="button">${isLocked ? '🔒 Locked' : '🔓 Unlocked'}</button>`
        }
        <span class="file-status">${b.hasFile ? '📄 file uploaded' : 'no file yet'}</span>
        <div class="file-input-wrap">
          <input type="file" id="file-${b.id}" accept=".docx,.doc,.pdf,.txt" />
          <button class="admin-submit" id="upload-${b.id}" type="button" style="padding:6px 10px; margin-top:4px;">Upload</button>
        </div>
        <button class="delete-btn" id="delete-${b.id}" type="button" title="Delete this book">🗑</button>
      </div>
    `;
  }

  async function handleAddBook(e) {
    e.preventDefault();
    const statusEl = document.getElementById('addStatus');
    const form = e.target;
    const fd = new FormData(form);
    const file = fd.get('file');

    const payload = {
      title: fd.get('title').trim(),
      author: fd.get('author').trim(),
      categoryId: fd.get('categoryId'),
      price: Number(fd.get('price')),
      pages: Number(fd.get('pages')),
      year: Number(fd.get('year')),
      description: fd.get('description').trim(),
    };

    statusEl.className = 'form-status';
    statusEl.textContent = 'Adding…';

    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = data.error || 'Could not add book.';
        statusEl.className = 'form-status error';
        return;
      }

      if (file && file.size > 0) {
        await uploadFileRaw(data.id, file);
      }

      statusEl.textContent = `Added "${data.title}".`;
      statusEl.className = 'form-status success';
      form.reset();
      await refreshBooks();
    } catch {
      statusEl.textContent = 'Could not reach the server.';
      statusEl.className = 'form-status error';
    }
  }

  async function savePrice(id, value) {
    const price = Number(value);
    if (Number.isNaN(price) || price < 0) return;
    await fetch(`/api/books/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price }),
    });
    await refreshBooks();
  }

  async function toggleLock(book) {
    const currentlyLocked = book.locked !== false;
    const newLocked = !currentlyLocked;
    await fetch(`/api/books/${book.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: newLocked }),
    });
    await refreshBooks();
  }

  function uploadFile(bookId, file) {
    if (!file) return;
    uploadFileRaw(bookId, file).then(refreshBooks);
  }

  function uploadFileRaw(bookId, file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        await fetch(`/api/books/${bookId}/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, contentBase64: base64 }),
        });
        resolve();
      };
      reader.readAsDataURL(file);
    });
  }

  async function deleteBook(id, title) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await fetch(`/api/books/${id}`, { method: 'DELETE' });
    await refreshBooks();
  }

  async function refreshBooks() {
    const res = await fetch('/api/books');
    const data = await res.json();
    books = data.books;
    renderBookList();
  }

  init();
})();
