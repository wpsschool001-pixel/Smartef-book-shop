// Smartef Bookshop — catalog backend
// Data (books, categories, users, purchases, payment claims, reviews) now
// lives in MongoDB Atlas instead of local JSON files, so it survives Render
// free-tier restarts. Uploaded book files still live on local disk — see
// the note near UPLOADS_DIR below.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { getDb } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
// This file is now only used ONCE, to seed MongoDB the first time the app
// runs against a brand-new database. After that, MongoDB is the source of
// truth and this file is ignored.
const SEED_FILE = path.join(__dirname, 'data', 'books.json');

// The one account that's allowed to upload book files / manage the catalog.
// Set this to whatever username you register with — see README.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
function isAdmin(username) {
  return Boolean(ADMIN_USERNAME) && username?.toLowerCase() === ADMIN_USERNAME.toLowerCase();
}

// Paystack (Nigerian payment gateway) keys — set these as environment
// variables wherever you host this. See README for how to get test keys.
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

// Manual payment methods, shown as an alternative to Paystack. These aren't
// verified automatically — the reader marks "I've paid" and the admin
// confirms it from the admin portal before the book unlocks.
const MANUAL_PAYMENT = {
  bankTransfer: {
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || '2217250685',
    accountName: process.env.BANK_ACCOUNT_NAME || 'Caleb John Effiong',
    bankName: process.env.BANK_NAME || 'Zenith Bank',
  },
  crypto: {
    coin: 'USDT',
    address: process.env.CRYPTO_ADDRESS || '0xa5015a79b6cdb2b9efb27752df290d310c9988d5',
    network: 'BSC (BEP20)',
  },
};

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- books + categories (MongoDB) ----------
async function loadData() {
  const db = await getDb();
  const [books, categories] = await Promise.all([
    db.collection('books').find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
    db.collection('categories').find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray(),
  ]);
  return { books, categories };
}
async function saveData(data) {
  const db = await getDb();
  const col = db.collection('books');
  await col.deleteMany({});
  if (data.books.length) await col.insertMany(data.books.map((b) => ({ ...b })));
}
function nextId(books) {
  return books.reduce((max, b) => Math.max(max, b.id), 0) + 1;
}

// One-time migration: if the books collection is empty (brand-new database),
// import whatever was in data/books.json so you don't lose your existing
// catalog. After this runs once, MongoDB is the only thing that matters.
async function seedIfEmpty() {
  const db = await getDb();
  const existing = await db.collection('books').countDocuments();
  if (existing > 0) return;
  if (!fs.existsSync(SEED_FILE)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
    if (seed.categories?.length) await db.collection('categories').insertMany(seed.categories);
    if (seed.books?.length) await db.collection('books').insertMany(seed.books);
    console.log(`Seeded MongoDB with ${seed.books?.length || 0} books, ${seed.categories?.length || 0} categories.`);
  } catch (err) {
    console.error('Could not seed catalog from data/books.json:', err.message);
  }
}

// ---------- purchases (MongoDB) ----------
async function loadPurchases() {
  const db = await getDb();
  const purchases = await db.collection('purchases').find({}, { projection: { _id: 0 } }).toArray();
  return { purchases };
}
async function savePurchases(data) {
  const db = await getDb();
  const col = db.collection('purchases');
  await col.deleteMany({});
  if (data.purchases.length) await col.insertMany(data.purchases.map((p) => ({ ...p })));
}
async function hasPurchased(username, bookId) {
  const data = await loadPurchases();
  return data.purchases.some((p) => p.username.toLowerCase() === username.toLowerCase() && p.bookId === bookId);
}

// The single source of truth for "can this user get this book":
// free books are always open; admin always has access; a paid book is open
// once the admin has flipped locked=false OR the reader has purchased it.
async function isUnlocked(book, username) {
  return book.price === 0 || book.locked === false || isAdmin(username) || (await hasPurchased(username, book.id));
}
async function recordPurchase(username, bookId, reference, amount) {
  const data = await loadPurchases();
  if (data.purchases.some((p) => p.username.toLowerCase() === username.toLowerCase() && p.bookId === bookId)) return; // don't double-record
  data.purchases.push({ username, bookId, reference, amount, createdAt: new Date().toISOString() });
  await savePurchases(data);
}

// ---------- manual payment claims (bank transfer / crypto) — MongoDB ----------
// A reader marks that they've sent a bank transfer or crypto payment; this
// just records the claim as "pending" until the admin checks their account
// and approves it, at which point it becomes a real purchase.
async function loadClaims() {
  const db = await getDb();
  const claims = await db.collection('paymentClaims').find({}, { projection: { _id: 0 } }).toArray();
  return { claims };
}
async function saveClaims(data) {
  const db = await getDb();
  const col = db.collection('paymentClaims');
  await col.deleteMany({});
  if (data.claims.length) await col.insertMany(data.claims.map((c) => ({ ...c })));
}
function nextClaimId(claims) {
  return claims.reduce((max, c) => Math.max(max, c.id), 0) + 1;
}

// ---------- reviews (MongoDB) ----------
async function loadReviews() {
  const db = await getDb();
  const reviews = await db.collection('reviews').find({}, { projection: { _id: 0 } }).toArray();
  return { reviews };
}
async function saveReviews(data) {
  const db = await getDb();
  const col = db.collection('reviews');
  await col.deleteMany({});
  if (data.reviews.length) await col.insertMany(data.reviews.map((r) => ({ ...r })));
}

const BOOK_FILE_MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

// Calls Paystack's server-to-server "verify transaction" endpoint using
// Node's built-in https module — no extra package needed.
function verifyPaystackTransaction(reference) {
  return new Promise((resolve, reject) => {
    if (!PAYSTACK_SECRET_KEY) return reject(new Error('PAYSTACK_SECRET_KEY is not set on the server'));
    const options = {
      hostname: 'api.paystack.co',
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------- helpers ----------
function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res, message = 'Not found') {
  sendJSON(res, 404, { error: message });
}

function badRequest(res, message = 'Bad request') {
  sendJSON(res, 400, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (chunk) => {
      chunks += chunk;
      if (chunks.length > 40_000_000) req.destroy(); // ~40MB safety cap (book files are base64-encoded, ~33% larger than the original file)
    });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) return notFound(res);

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      // SPA-friendly fallback for unknown paths that aren't asset requests
      if (!path.extname(filePath)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexContent) => {
          if (err2) return notFound(res);
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(indexContent);
        });
      }
      return notFound(res);
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- validation ----------
function validateBookPayload(payload, categories, { partial = false } = {}) {
  const errors = [];
  const validCategoryIds = new Set(categories.map((c) => c.id));

  const required = ['title', 'author', 'categoryId', 'price', 'pages', 'year'];
  if (!partial) {
    for (const field of required) {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        errors.push(`Missing field: ${field}`);
      }
    }
  }
  if (payload.categoryId !== undefined && !validCategoryIds.has(payload.categoryId)) {
    errors.push(`Unknown categoryId: ${payload.categoryId}`);
  }
  if (payload.price !== undefined && (typeof payload.price !== 'number' || payload.price < 0)) {
    errors.push('price must be a non-negative number');
  }
  if (payload.pages !== undefined && (!Number.isInteger(payload.pages) || payload.pages <= 0)) {
    errors.push('pages must be a positive integer');
  }
  if (payload.year !== undefined && (!Number.isInteger(payload.year))) {
    errors.push('year must be an integer');
  }
  if (payload.rating !== undefined && (typeof payload.rating !== 'number' || payload.rating < 0 || payload.rating > 5)) {
    errors.push('rating must be a number between 0 and 5');
  }
  if (payload.stock !== undefined && (!Number.isInteger(payload.stock) || payload.stock < 0)) {
    errors.push('stock must be a non-negative integer');
  }
  if (payload.locked !== undefined && typeof payload.locked !== 'boolean') {
    errors.push('locked must be true or false');
  }
  return errors;
}

// ---------- API ----------
async function handleApi(req, res, pathname, query, username) {
  const data = await loadData();
  const segments = pathname.split('/').filter(Boolean); // ['api','books', '3']

  // GET /api/categories
  if (req.method === 'GET' && segments[1] === 'categories' && segments.length === 2) {
    return sendJSON(res, 200, data.categories);
  }

  // /api/books  and /api/books/:id
  if (segments[1] === 'books') {
    const id = segments[2] ? Number(segments[2]) : null;

    if (req.method === 'GET' && segments.length === 2) {
      let results = data.books;

      if (query.category) {
        results = results.filter((b) => b.categoryId === query.category);
      }
      if (query.q) {
        const q = query.q.toLowerCase();
        results = results.filter(
          (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
        );
      }
      if (query.minPrice) results = results.filter((b) => b.price >= Number(query.minPrice));
      if (query.maxPrice) results = results.filter((b) => b.price <= Number(query.maxPrice));
      if (query.featured === 'true') results = results.filter((b) => b.featured);

      const sort = query.sort || 'title';
      const sorters = {
        title: (a, b) => a.title.localeCompare(b.title),
        price_asc: (a, b) => a.price - b.price,
        price_desc: (a, b) => b.price - a.price,
        rating: (a, b) => b.rating - a.rating,
        newest: (a, b) => b.year - a.year,
      };
      results = [...results].sort(sorters[sort] || sorters.title);

      const withCategory = await Promise.all(
        results.map(async (b) => ({
          ...b,
          category: data.categories.find((c) => c.id === b.categoryId) || null,
          hasFile: Boolean(b.fileName),
          unlocked: await isUnlocked(b, username),
        }))
      );

      return sendJSON(res, 200, { count: withCategory.length, books: withCategory });
    }

    if (req.method === 'GET' && id && segments.length === 3) {
      const book = data.books.find((b) => b.id === id);
      if (!book) return notFound(res, `No book with id ${id}`);
      const category = data.categories.find((c) => c.id === book.categoryId) || null;
      const unlocked = await isUnlocked(book, username);
      return sendJSON(res, 200, { ...book, category, hasFile: Boolean(book.fileName), unlocked });
    }

    // ---- book file: upload (admin only) and download (free/purchased/admin) ----
    if (segments.length === 4 && segments[3] === 'file') {
      const book = data.books.find((b) => b.id === id);
      if (!book) return notFound(res, `No book with id ${id}`);

      if (req.method === 'POST') {
        if (!isAdmin(username)) return sendJSON(res, 403, { error: 'Only the site admin can upload book files' });
        let payload;
        try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
        const { fileName, contentBase64 } = payload;
        if (!fileName || !contentBase64) return badRequest(res, 'fileName and contentBase64 are required');
        const ext = path.extname(fileName).toLowerCase();
        if (!BOOK_FILE_MIME[ext]) return badRequest(res, `Unsupported file type ${ext}. Use .docx, .doc, .pdf, or .txt`);

        const storedName = `${id}${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, storedName), Buffer.from(contentBase64, 'base64'));
        book.fileName = fileName;
        book.storedFileName = storedName;
        await saveData(data);
        return sendJSON(res, 200, { ok: true, fileName });
      }

      if (req.method === 'GET') {
        const unlocked = await isUnlocked(book, username);
        if (!unlocked) return sendJSON(res, 403, { error: 'Purchase this book to access the file' });
        if (!book.storedFileName) return notFound(res, 'No file has been uploaded for this book yet');

        const filePath = path.join(UPLOADS_DIR, book.storedFileName);
        const ext = path.extname(book.storedFileName).toLowerCase();
        fs.readFile(filePath, (err, content) => {
          if (err) return notFound(res, 'File is missing on the server');
          res.writeHead(200, {
            'Content-Type': BOOK_FILE_MIME[ext] || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(book.fileName)}"`,
          });
          res.end(content);
        });
        return;
      }
    }

    // ---- reviews ----
    if (segments.length === 4 && segments[3] === 'reviews') {
      const book = data.books.find((b) => b.id === id);
      if (!book) return notFound(res, `No book with id ${id}`);

      if (req.method === 'GET') {
        const all = (await loadReviews()).reviews.filter((r) => r.bookId === id);
        const average = all.length ? all.reduce((sum, r) => sum + r.rating, 0) / all.length : null;
        return sendJSON(res, 200, {
          reviews: all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
          average,
          count: all.length,
        });
      }

      if (req.method === 'POST') {
        let payload;
        try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
        const { rating, text } = payload;
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return badRequest(res, 'rating must be a whole number from 1 to 5');
        if (text && text.length > 1000) return badRequest(res, 'Review text is too long (max 1000 characters)');

        const reviewsData = await loadReviews();
        const existingIdx = reviewsData.reviews.findIndex((r) => r.bookId === id && r.username.toLowerCase() === username.toLowerCase());
        const review = {
          id: existingIdx === -1 ? Date.now() : reviewsData.reviews[existingIdx].id,
          bookId: id,
          username,
          rating,
          text: text || '',
          createdAt: new Date().toISOString(),
        };
        if (existingIdx === -1) reviewsData.reviews.push(review);
        else reviewsData.reviews[existingIdx] = review;
        await saveReviews(reviewsData);
        return sendJSON(res, existingIdx === -1 ? 201 : 200, review);
      }
    }

    if (req.method === 'POST' && segments.length === 2) {
      if (!isAdmin(username)) return sendJSON(res, 403, { error: 'Only the site admin can add books' });
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        return badRequest(res, 'Malformed JSON body');
      }
      const errors = validateBookPayload(payload, data.categories);
      if (errors.length) return badRequest(res, errors.join('; '));

      const book = {
        id: nextId(data.books),
        title: payload.title,
        author: payload.author,
        categoryId: payload.categoryId,
        price: payload.price,
        pages: payload.pages,
        year: payload.year,
        rating: payload.rating ?? 0,
        stock: payload.stock ?? 0,
        featured: Boolean(payload.featured),
        description: payload.description || '',
        locked: payload.locked !== undefined ? payload.locked : payload.price > 0,
      };
      data.books.push(book);
      await saveData(data);
      return sendJSON(res, 201, book);
    }

    if (req.method === 'PUT' && id && segments.length === 3) {
      if (!isAdmin(username)) return sendJSON(res, 403, { error: 'Only the site admin can edit books' });
      const idx = data.books.findIndex((b) => b.id === id);
      if (idx === -1) return notFound(res, `No book with id ${id}`);
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        return badRequest(res, 'Malformed JSON body');
      }
      const errors = validateBookPayload(payload, data.categories, { partial: true });
      if (errors.length) return badRequest(res, errors.join('; '));

      data.books[idx] = { ...data.books[idx], ...payload, id };
      await saveData(data);
      return sendJSON(res, 200, data.books[idx]);
    }

    if (req.method === 'DELETE' && id && segments.length === 3) {
      if (!isAdmin(username)) return sendJSON(res, 403, { error: 'Only the site admin can delete books' });
      const idx = data.books.findIndex((b) => b.id === id);
      if (idx === -1) return notFound(res, `No book with id ${id}`);
      const [removed] = data.books.splice(idx, 1);
      await saveData(data);
      return sendJSON(res, 200, { deleted: removed.id });
    }
  }

  // GET /api/config — non-secret settings the frontend needs (Paystack public key)
  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJSON(res, 200, {
      paystackPublicKey: PAYSTACK_PUBLIC_KEY,
      currency: 'NGN',
      manualPayment: MANUAL_PAYMENT,
    });
  }

  // GET /api/purchases/mine — which book IDs the current user has bought
  if (req.method === 'GET' && pathname === '/api/purchases/mine') {
    const purchases = (await loadPurchases()).purchases.filter((p) => p.username.toLowerCase() === username.toLowerCase());
    return sendJSON(res, 200, { bookIds: purchases.map((p) => p.bookId) });
  }

  // POST /api/payment-claims — reader says "I've sent a bank transfer / crypto payment"
  if (req.method === 'POST' && pathname === '/api/payment-claims') {
    let payload;
    try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
    const { bookId, method, note } = payload;
    const validMethods = ['bank_transfer', 'crypto'];
    if (!bookId || !validMethods.includes(method)) {
      return badRequest(res, 'bookId and a valid method (bank_transfer or crypto) are required');
    }
    const book = data.books.find((b) => b.id === Number(bookId));
    if (!book) return notFound(res, `No book with id ${bookId}`);
    if (await isUnlocked(book, username)) return badRequest(res, 'You already have access to this book');

    const claimsData = await loadClaims();
    const existing = claimsData.claims.find(
      (c) => c.username.toLowerCase() === username.toLowerCase() && c.bookId === book.id && c.status === 'pending'
    );
    if (existing) return sendJSON(res, 200, existing);

    const claim = {
      id: nextClaimId(claimsData.claims),
      username,
      bookId: book.id,
      method,
      note: (note || '').slice(0, 500),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    claimsData.claims.push(claim);
    await saveClaims(claimsData);
    return sendJSON(res, 201, claim);
  }

  // GET /api/payment-claims/mine?bookId= — the current user's own claims
  if (req.method === 'GET' && pathname === '/api/payment-claims/mine') {
    const claims = (await loadClaims()).claims.filter(
      (c) => c.username.toLowerCase() === username.toLowerCase() && (!query.bookId || c.bookId === Number(query.bookId))
    );
    return sendJSON(res, 200, { claims });
  }

  // GET /api/payment-claims — admin: list claims (optionally ?status=pending)
  if (req.method === 'GET' && pathname === '/api/payment-claims') {
    if (!isAdmin(username)) return sendJSON(res, 403, { error: 'Only the site admin can view payment claims' });
    let claims = (await loadClaims()).claims;
    if (query.status) claims = claims.filter((c) => c.status === query.status);
    claims = claims
      .map((c) => {
        const book = data.books.find((b) => b.id === c.bookId);
        return { ...c, bookTitle: book ? book.title : `#${c.bookId}` };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJSON(res, 200, { claims });
  }

  // POST /api/payment-claims/:id/approve — admin: confirm payment received, unlock the book
  if (req.method === 'POST' && segments[1] === 'payment-claims' && segments[2] && segments[3] === 'approve') {
    if (!isAdmin(username)) return sendJSON(res, 403, { error: 'Only the site admin can approve payments' });
    const claimId = Number(segments[2]);
    const claimsData = await loadClaims();
    const claim = claimsData.claims.find((c) => c.id === claimId);
    if (!claim) return notFound(res, `No payment claim with id ${claimId}`);
    claim.status = 'approved';
    claim.resolvedAt = new Date().toISOString();
    await saveClaims(claimsData);
    await recordPurchase(claim.username, claim.bookId, `manual_${claim.method}_${claim.id}`, null);
    return sendJSON(res, 200, claim);
  }

  // POST /api/payment-claims/:id/reject — admin: mark claim rejected
  if (req.method === 'POST' && segments[1] === 'payment-claims' && segments[2] && segments[3] === 'reject') {
    if (!isAdmin(username)) return sendJSON(res, 403, { error: 'Only the site admin can reject payments' });
    const claimId = Number(segments[2]);
    const claimsData = await loadClaims();
    const claim = claimsData.claims.find((c) => c.id === claimId);
    if (!claim) return notFound(res, `No payment claim with id ${claimId}`);
    claim.status = 'rejected';
    claim.resolvedAt = new Date().toISOString();
    await saveClaims(claimsData);
    return sendJSON(res, 200, claim);
  }

  // POST /api/verify-payment — confirm a Paystack transaction and unlock the book
  if (req.method === 'POST' && pathname === '/api/verify-payment') {
    let payload;
    try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
    const { reference, bookId } = payload;
    if (!reference || !bookId) return badRequest(res, 'reference and bookId are required');

    const book = data.books.find((b) => b.id === Number(bookId));
    if (!book) return notFound(res, `No book with id ${bookId}`);

    let result;
    try {
      result = await verifyPaystackTransaction(reference);
    } catch (err) {
      return sendJSON(res, 502, { error: `Could not reach Paystack: ${err.message}` });
    }

    if (!result || result.status !== true || !result.data || result.data.status !== 'success') {
      return sendJSON(res, 402, { error: 'Payment was not successful', details: result?.data?.gateway_response });
    }

    const expectedKobo = Math.round(book.price * 100);
    if (result.data.amount !== expectedKobo || result.data.currency !== 'NGN') {
      return sendJSON(res, 402, { error: 'Paid amount did not match the book price' });
    }

    await recordPurchase(username, book.id, reference, result.data.amount);
    return sendJSON(res, 200, { ok: true, bookId: book.id });
  }

  return notFound(res, 'Unknown API route');
}

// ---------- accounts (per-user login, not one shared password) — MongoDB ----------
const crypto = require('crypto');

async function loadUsers() {
  const db = await getDb();
  const users = await db.collection('users').find({}, { projection: { _id: 0 } }).toArray();
  return { users };
}
async function saveUsers(data) {
  const db = await getDb();
  const col = db.collection('users');
  await col.deleteMany({});
  if (data.users.length) await col.insertMany(data.users.map((u) => ({ ...u })));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function normalizeAnswer(answer) {
  return answer.trim().toLowerCase();
}

async function createUser(username, password, securityAnswer, email) {
  const data = await loadUsers();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const answerSalt = crypto.randomBytes(16).toString('hex');
  const answerHash = hashPassword(normalizeAnswer(securityAnswer), answerSalt);
  const user = { username, email, salt, hash, answerSalt, answerHash };
  data.users.push(user);
  await saveUsers(data);
  return user;
}

async function findUser(username) {
  const data = await loadUsers();
  return data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}

function verifyPassword(user, password) {
  const attempt = hashPassword(password, user.salt);
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySecurityAnswer(user, answer) {
  const attempt = hashPassword(normalizeAnswer(answer || ''), user.answerSalt);
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(user.answerHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function resetPassword(username, newPassword) {
  const data = await loadUsers();
  const user = data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return false;
  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.hash = hashPassword(newPassword, salt);
  await saveUsers(data);
  return true;
}

// ---------- sessions (cookie-based, in memory) ----------
// Note: sessions reset if the server restarts (e.g. a free host waking back
// up), so users may occasionally need to log in again. That's a reasonable
// tradeoff for a project this size — see README for how to persist sessions
// if you outgrow it.
const sessions = new Map(); // sessionId -> { username, expires }
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseCookies(req) {
  const header = req.headers['cookie'];
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function getSessionUsername(req) {
  const { session } = parseCookies(req);
  if (!session) return null;
  const record = sessions.get(session);
  if (!record) return null;
  if (Date.now() > record.expires) {
    sessions.delete(session);
    return null;
  }
  return record.username;
}

function createSession(res, username) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { username, expires: Date.now() + SESSION_MS });
  res.setHeader(
    'Set-Cookie',
    `session=${id}; HttpOnly; Path=/; Max-Age=${SESSION_MS / 1000}; SameSite=Lax`
  );
}

function clearSession(req, res) {
  const { session } = parseCookies(req);
  if (session) sessions.delete(session);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

// ---------- auth API ----------
async function handleAuthApi(req, res, pathname) {
  if (pathname === '/api/register' && req.method === 'POST') {
    let payload;
    try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
    const { username, password, securityAnswer, email } = payload;
    if (!username || username.trim().length < 3) return badRequest(res, 'Username must be at least 3 characters');
    if (!password || password.length < 6) return badRequest(res, 'Password must be at least 6 characters');
    if (!securityAnswer || securityAnswer.trim().length < 2) return badRequest(res, 'Please answer the security question (used if you forget your password)');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest(res, 'Please enter a valid email address');
    if (await findUser(username)) return badRequest(res, 'That username is already taken');

    await createUser(username.trim(), password, securityAnswer, email.trim());
    createSession(res, username.trim());
    return sendJSON(res, 201, { username: username.trim() });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    let payload;
    try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
    const { username, password } = payload;
    const user = username && (await findUser(username));
    if (!user || !verifyPassword(user, password || '')) {
      return sendJSON(res, 401, { error: 'Incorrect username or password' });
    }
    createSession(res, user.username);
    return sendJSON(res, 200, { username: user.username });
  }

  if (pathname === '/api/reset-password' && req.method === 'POST') {
    let payload;
    try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
    const { username, securityAnswer, newPassword } = payload;
    if (!newPassword || newPassword.length < 6) return badRequest(res, 'New password must be at least 6 characters');

    const user = username && (await findUser(username));
    // Deliberately vague error so a stranger can't use this to discover which usernames exist.
    if (!user || !verifySecurityAnswer(user, securityAnswer)) {
      return sendJSON(res, 401, { error: 'Username or security answer did not match' });
    }
    await resetPassword(user.username, newPassword);
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    clearSession(req, res);
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    const username = getSessionUsername(req);
    if (!username) return sendJSON(res, 401, { error: 'Not logged in' });
    const user = await findUser(username);
    return sendJSON(res, 200, { username, email: user?.email || '', isAdmin: isAdmin(username) });
  }

  return notFound(res, 'Unknown auth route');
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // Basic CORS so the frontend can also be opened from a different origin/port if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const AUTH_ROUTES = ['/api/register', '/api/login', '/api/logout', '/api/me', '/api/reset-password'];

  try {
    if (AUTH_ROUTES.includes(pathname)) {
      return await handleAuthApi(req, res, pathname);
    }

    if (pathname.startsWith('/api/')) {
      const username = getSessionUsername(req);
      if (!username) return sendJSON(res, 401, { error: 'Please log in first' });
      return await handleApi(req, res, pathname, parsed.query, username);
    }

    // Gate the main page: show the login/register screen unless there's a valid session
    if (pathname === '/' || pathname === '/index.html') {
      const username = getSessionUsername(req);
      if (!username) {
        return fs.readFile(path.join(PUBLIC_DIR, 'login.html'), (err, content) => {
          if (err) return notFound(res);
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(content);
        });
      }
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

seedIfEmpty()
  .catch((err) => console.error('Seeding step failed (server will still start):', err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Smartef Bookshop is live at http://localhost:${PORT}`);
    });
  });
