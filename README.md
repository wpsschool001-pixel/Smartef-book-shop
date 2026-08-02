# Smartef Bookshop

A complete, ready-to-run online bookshop: browse a bookshelf, search and
filter by section, read reviews, save a wishlist, and buy locked books with
real Naira payments via Paystack. Built with **zero external dependencies**
— just Node.js core modules — so there's nothing to `npm install` and
nothing that can fail to compile.

## Run it

Requires Node.js 18+ (nothing else).

```bash
node server.js
```

Then open **http://localhost:3000**.

To use a different port: `PORT=4000 node server.js`.

## What's inside

```
server.js              Backend: HTTP server + REST API + static file server
render.yaml             Render Blueprint — lets Render auto-configure the deploy
package.json
data/
├── books.json            The catalog — 5 sections + all books
├── users.json            Accounts (hashed passwords)
├── purchases.json        Who bought what
├── payment-claims.json   Pending bank transfer / crypto payments awaiting admin approval
├── reviews.json          Reader reviews
└── uploads/               Uploaded book files (created automatically)
public/
├── index.html             Main shop page
├── login.html             Sign in / register / forgot password
├── admin.html             Admin portal
├── pay.html                Payment page (Paystack + bank transfer + crypto)
├── styles.css              All styling
├── app.js, login.js, admin.js, pay.js
└── logo.jpg                 Your shop logo
README.md
```

Everything sits directly at the top level of this project on purpose — when you upload it to a GitHub repo (as the root of that repo, not inside a subfolder), Render finds `package.json` immediately with zero extra configuration.

The datastore is plain JSON files, not a database server — no native build
step, works anywhere Node runs. If you outgrow it, the fix is swapping the
`load*()`/`save*()` functions in `server.js` for real database calls; the
API surface stays identical.

## Accounts

Everyone signs in with their own username and password (created via the
"Create an account" screen). Passwords are stored hashed, never as plain
text. A "Forgot password?" link lets anyone reset their password by
answering a security question they set at sign-up.

## Admin account (you, the shop owner)

One username is the admin — only that account can manage the catalog
(add/edit/delete books, lock/unlock, upload files). Set it as an
environment variable:

```bash
# Mac/Linux
ADMIN_USERNAME=yourusername node server.js

# Windows (Command Prompt)
set ADMIN_USERNAME=yourusername
node server.js
```

Register or sign in with that **exact** username. You'll see "(admin)"
next to your name in the header, plus an **"Admin portal"** link. On
Render, add `ADMIN_USERNAME` as an Environment Variable the same way.

## The admin portal (`/admin.html`)

Everything catalog-management happens here:

- **Add a new book** — pick a section (Christian Books, Newspaper, Novels,
  Textbooks, Others), fill in the details, and optionally attach the book
  file right away.
- **Manage books** — every book, grouped by section, with:
  - an editable price
  - a **Lock / Unlock** toggle — locking requires payment to access even
    if you haven't set up Paystack yet; unlocking (green) gives everyone
    free access regardless of price, useful for promotions
  - upload/replace the book file
  - delete the book entirely

A price of `0` always means free — no lock toggle needed, it's simply open
to everyone.

## Sections

The shop ships with five sections: **Christian Books, Newspaper, Novels,
Textbooks, Others.** These are defined in the `categories` list at the top
of `data/books.json` if you ever want to rename or recolor one — each has
an `id`, `name`, and a hex `color` used for its spine/card color.

## Uploading your own book

In the admin portal, either attach a file while adding a new book, or use
the **Upload** control next to any existing book. Accepted formats:
`.docx`, `.doc`, `.pdf`, `.txt`.

- **Free books**: anyone signed in can download immediately.
- **Locked books**: readers see a **"🔒 This book is locked"** banner that
  sends them to the payment page — they only get the download after paying.

Files live in `data/uploads/`, outside `public/`, so they can't be reached
by guessing a URL — the server checks payment/lock status on every
download request.

## Currency

Prices display in Naira (₦) throughout — e.g. `2500` in `books.json` shows
as `₦2,500`. `0` shows as `Free`.

## Payments (Paystack)

Locked books are unlocked through [Paystack](https://paystack.com), the
standard Nigerian payment gateway. It handles the actual
card/bank-transfer processing — this project never touches card details.

**1. Create a free Paystack account** at
[dashboard.paystack.com/#/signup](https://dashboard.paystack.com/#/signup).

**2. Get your test API keys.** Dashboard → Settings → API Keys & Webhooks.
You'll see a **Test Public Key** (`pk_test_...`) and a **Test Secret Key**
(`sk_test_...`). Test mode moves no real money.

**3. Set them as environment variables:**

```bash
# Mac/Linux
PAYSTACK_PUBLIC_KEY=pk_test_xxxx PAYSTACK_SECRET_KEY=sk_test_xxxx node server.js

# Windows (Command Prompt)
set PAYSTACK_PUBLIC_KEY=pk_test_xxxx
set PAYSTACK_SECRET_KEY=sk_test_xxxx
node server.js
```

On Render, add both under Environment Variables, same as `ADMIN_USERNAME`.

**4. Test a payment.** Open a locked book → "Go to payment" → "Pay with
Paystack." In test mode, use
[test cards](https://paystack.com/docs/payments/test-payments) like card
number `4084084084084081`, any future expiry, CVV `408`, PIN `0000`, OTP
`123456`.

**5. Go live.** Once ready for real payments, Paystack requires a short
business verification (Settings → business details). Then swap in your
**Live** keys (`pk_live_...` / `sk_live_...`) — same environment variables,
live values.

**How it works:** the Pay button opens Paystack's own secure popup — your
server never sees card numbers. After payment, the browser sends
Paystack's transaction reference to this server, which independently
re-checks that transaction with Paystack's API — confirming amount and
status — before unlocking the book. A fake or replayed reference can't
unlock anything; the server only trusts what Paystack itself confirms.

## Reviews

Any signed-in reader can leave a star rating (1–5) and an optional written
review on a book's detail panel — one review per person per book (posting
again updates their existing review rather than adding a duplicate).

## Wishlist

The "♡ Wishlist" button in the header shows a reader's saved books. This
list is stored in the browser's `localStorage`, so it's local to that
browser/device — there's no server-side wishlist table.

## Putting it online (so others can visit it)

**1. Create a free GitHub account** at [github.com](https://github.com).

**2. Create a new repository** — name it something like `smartef-bookshop`,
Public or Private either works, skip adding a README (you already have
one).

**3. Upload your project.** On the repository page, click "uploading an
existing file" → drag in every file and folder from inside this project
**directly** (not wrapped in a parent folder) — `server.js`, `package.json`,
`render.yaml`, `public/`, `data/`, `README.md` should all appear the moment
you open the repo, not after clicking into a subfolder. Making sure `data`
and `public` upload as **folders** (not their contents loose) — commit.

**4. Create a free Render account** at [render.com](https://render.com),
signing in with GitHub.

**5. Deploy it** — two ways to do this:

**Option A — Blueprint (recommended, fewest steps).** This project includes
a `render.yaml` file that pre-fills all the settings for you.
1. On the Render dashboard, click **New +** → **Blueprint**.
2. Connect your repository.
3. Render reads `render.yaml` and shows you the service it's about to
   create, with prompts for `ADMIN_USERNAME`, `PAYSTACK_PUBLIC_KEY`, and
   `PAYSTACK_SECRET_KEY` — fill in at least `ADMIN_USERNAME`.
4. Click **Apply** / **Deploy Blueprint**.

**Option B — Manual Web Service.**
1. New → Web Service → connect your repository.
2. Settings:
   - Runtime: `Node`
   - Build Command: leave blank (defaults to `npm install`)
   - Start Command: `node server.js`
   - Instance Type: `Free`
   - **Root Directory: leave blank** — since the files sit at the repo's
     top level, Render doesn't need this set.
3. Environment Variables — add `ADMIN_USERNAME`, and once ready,
   `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY`.
4. Click **Create Web Service**.

Either way, Render builds and deploys — you'll get a public URL like
`https://smartef-bookshop.onrender.com`.

Note: Render's free tier sleeps after inactivity, so the first visit after
a quiet spell can take ~30 seconds to wake up — normal, not a bug. Also,
because sessions live in server memory (not a database), a restart signs
everyone out — their accounts and passwords are unaffected either way.

**To update the live site later:** upload your changed files to GitHub the
same way — Render redeploys automatically.

## Extending it

- **In-browser reading** instead of downloading: convert the uploaded
  `.docx` to HTML client-side (e.g. with the `mammoth` library loaded via
  CDN) and render it in a reading view, instead of the current download link.
- **Persist sessions to disk** so a server restart doesn't sign everyone
  out — store them in `data/sessions.json` the same way `users.json` is
  stored, instead of the in-memory `sessions` Map in `server.js`.
- **Swap the datastore** for a real database by replacing the `load*()`/
  `save*()` functions in `server.js` — the rest of the API doesn't need to
  change.
