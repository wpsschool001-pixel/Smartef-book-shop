(() => {
  const params = new URLSearchParams(window.location.search);
  const bookId = Number(params.get('book'));
  const contentEl = document.getElementById('payContent');

  function shade(hex, percent) {
    const n = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
    const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }
  function formatPrice(price) {
    if (price === 0) return 'Free';
    return `₦${Math.round(price).toLocaleString('en-NG')}`;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderManualSection(mp, pendingClaim) {
    if (pendingClaim) {
      const label = pendingClaim.method === 'crypto' ? 'crypto payment' : 'bank transfer';
      return `
        <div class="pay-divider">Or pay manually</div>
        <p class="claim-pending">We've noted your ${label}. The admin will confirm it and unlock the book shortly.</p>
      `;
    }
    return `
      <div class="pay-divider">Or pay manually</div>
      <div class="manual-methods">
        <div class="manual-method">
          <h3>Bank transfer</h3>
          <div class="manual-row">
            <span class="manual-label">Account no.</span>
            <span class="manual-value">${escapeHtml(mp.bankTransfer.accountNumber)}<button class="copy-btn" data-copy="${escapeHtml(mp.bankTransfer.accountNumber)}" type="button">Copy</button></span>
          </div>
          <div class="manual-row">
            <span class="manual-label">Name</span>
            <span class="manual-value">${escapeHtml(mp.bankTransfer.accountName)}</span>
          </div>
          <div class="manual-row">
            <span class="manual-label">Bank</span>
            <span class="manual-value">${escapeHtml(mp.bankTransfer.bankName)}</span>
          </div>
          <p class="manual-note">Transfer the price shown above, then tap the button below.</p>
          <button class="manual-submit" id="claimBankBtn" type="button">I've sent the bank transfer</button>
        </div>
        <div class="manual-method">
          <h3>Crypto (USDT)</h3>
          <div class="manual-row">
            <span class="manual-label">Address</span>
            <span class="manual-value">${escapeHtml(mp.crypto.address)}<button class="copy-btn" data-copy="${escapeHtml(mp.crypto.address)}" type="button">Copy</button></span>
          </div>
          <div class="manual-row">
            <span class="manual-label">Network</span>
            <span class="manual-value">${escapeHtml(mp.crypto.network)}</span>
          </div>
          <p class="manual-note">Send the USDT equivalent of the price above on this network only, then tap the button below.</p>
          <button class="manual-submit" id="claimCryptoBtn" type="button">I've sent the crypto payment</button>
        </div>
      </div>
      <p class="pay-status" id="manualStatus"></p>
    `;
  }

  function wireManualSection(book) {
    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copy);
          const original = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = original; }, 1500);
        } catch {
          // clipboard API unavailable — ignore silently
        }
      });
    });

    const bankBtn = document.getElementById('claimBankBtn');
    if (bankBtn) bankBtn.addEventListener('click', () => submitClaim(book.id, 'bank_transfer', bankBtn));

    const cryptoBtn = document.getElementById('claimCryptoBtn');
    if (cryptoBtn) cryptoBtn.addEventListener('click', () => submitClaim(book.id, 'crypto', cryptoBtn));
  }

  async function submitClaim(bookId, method, btn) {
    const statusEl = document.getElementById('manualStatus');
    const note = window.prompt('Optional: paste your transaction reference / hash so the admin can find it faster.') || '';
    btn.disabled = true;
    statusEl.textContent = 'Recording your payment…';
    statusEl.className = 'pay-status';
    try {
      const res = await fetch('/api/payment-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, method, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = data.error || 'Could not record your payment.';
        statusEl.className = 'pay-status error';
        btn.disabled = false;
        return;
      }
      statusEl.textContent = "Thanks — we've noted it. The admin will confirm and unlock the book soon.";
      statusEl.className = 'pay-status success';
    } catch {
      statusEl.textContent = 'Could not reach the server.';
      statusEl.className = 'pay-status error';
      btn.disabled = false;
    }
  }

  async function init() {
    if (!bookId) {
      contentEl.innerHTML = '<p>No book was specified.</p>';
      return;
    }

    const [meRes, configRes, bookRes] = await Promise.all([
      fetch('/api/me'),
      fetch('/api/config'),
      fetch(`/api/books/${bookId}`),
    ]);

    if (meRes.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!bookRes.ok) {
      contentEl.innerHTML = '<p>Could not find that book.</p>';
      return;
    }

    const me = await meRes.json();
    const config = await configRes.json();
    const book = await bookRes.json();

    if (book.unlocked) {
      contentEl.innerHTML = `
        <h2 class="pay-title">You already have this book</h2>
        <p class="pay-author">${escapeHtml(book.title)}</p>
        <a class="pay-submit" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;" href="/api/books/${book.id}/file" target="_blank" rel="noopener">Download book file</a>
      `;
      return;
    }

    const mine = await fetch(`/api/payment-claims/mine?bookId=${book.id}`).then((r) => (r.ok ? r.json() : { claims: [] }));
    const pendingClaim = mine.claims.find((c) => c.status === 'pending');

    const cat = book.category;
    const mp = config.manualPayment || null;
    contentEl.innerHTML = `
      <div class="pay-cover" style="background:linear-gradient(160deg, ${cat.color}, ${shade(cat.color, -30)});">
        <span class="initial">${escapeHtml(book.title[0])}</span>
      </div>
      <h2 class="pay-title">${escapeHtml(book.title)}</h2>
      <p class="pay-author">by ${escapeHtml(book.author)}</p>
      <div class="pay-price-row">
        <span>Price</span>
        <span class="pay-price">${formatPrice(book.price)}</span>
      </div>
      <button class="pay-submit" id="payBtn" type="button">Pay ${formatPrice(book.price)} with Paystack</button>
      <p class="pay-status" id="payStatus"></p>
      ${mp ? renderManualSection(mp, pendingClaim) : ''}
    `;

    if (mp) wireManualSection(book);

    document.getElementById('payBtn').addEventListener('click', () => {
      const statusEl = document.getElementById('payStatus');
      if (!window.PaystackPop) {
        statusEl.textContent = 'Payment library failed to load. Check your internet connection.';
        statusEl.className = 'pay-status error';
        return;
      }
      if (!config.paystackPublicKey) {
        statusEl.textContent = 'Payments are not set up yet — the site owner needs to add a Paystack public key.';
        statusEl.className = 'pay-status error';
        return;
      }
      if (!me.email) {
        statusEl.textContent = 'Your account is missing an email address, which Paystack requires.';
        statusEl.className = 'pay-status error';
        return;
      }

      const reference = `smtf_${book.id}_${Date.now()}`;
      const handler = window.PaystackPop.setup({
        key: config.paystackPublicKey,
        email: me.email,
        amount: Math.round(book.price * 100), // kobo
        currency: 'NGN',
        ref: reference,
        callback: (response) => verify(response.reference),
        onClose: () => {
          statusEl.textContent = 'Payment window closed.';
          statusEl.className = 'pay-status';
        },
      });
      handler.openIframe();
    });

    async function verify(reference) {
      const statusEl = document.getElementById('payStatus');
      statusEl.textContent = 'Confirming payment…';
      statusEl.className = 'pay-status';
      try {
        const res = await fetch('/api/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference, bookId: book.id }),
        });
        const data = await res.json();
        if (!res.ok) {
          statusEl.textContent = data.error || 'Payment could not be confirmed.';
          statusEl.className = 'pay-status error';
          return;
        }
        statusEl.textContent = 'Payment confirmed! Redirecting…';
        statusEl.className = 'pay-status success';
        setTimeout(() => { window.location.href = '/'; }, 1200);
      } catch {
        statusEl.textContent = 'Could not reach the server to confirm payment.';
        statusEl.className = 'pay-status error';
      }
    }
  }

  init();
})();
