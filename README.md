# Smartef Bookshop — Render + MongoDB + Cloudinary

This version keeps the existing frontend design, colors, page layout, navigation and API routes intact while changing the storage layer so data survives Render restarts/spin-downs.

## What changed

- Render local disk is no longer used for permanent book uploads.
- MongoDB stores categories, books, users, purchases, payment claims and reviews.
- Cloudinary stores uploaded `.pdf`, `.docx`, `.doc` and `.txt` book files.
- Existing JSON seed files are automatically imported into MongoDB the first time the MongoDB database is empty.
- Existing book metadata is preserved.
- Re-uploading a book replaces the previous Cloudinary file.
- Deleting a book also attempts to remove its Cloudinary file.
- The existing frontend files were not redesigned.

## Important note about books already uploaded before this upgrade

If an old book was stored only in Render's `data/uploads` directory and is not present in this ZIP, the file itself cannot be recovered from this project after Render has already deleted it. Re-upload those old book files once through the admin portal. From then on, they will be stored in Cloudinary.

## Render environment variables

Add these in Render → your service → Environment:

- `MONGODB_URI` = your MongoDB connection string
- `MONGODB_DB` = `smartef_bookshop` (the included render.yaml sets this automatically)
- `CLOUDINARY_CLOUD_NAME` = your Cloudinary cloud name
- `CLOUDINARY_API_KEY` = your Cloudinary API key
- `CLOUDINARY_API_SECRET` = your Cloudinary API secret
- `ADMIN_USERNAME` = the dedicated admin username you choose
- `ADMIN_PASSWORD` = the dedicated admin password you choose (at least 6 characters)
- `PAYSTACK_PUBLIC_KEY` = your Paystack public key
- `PAYSTACK_SECRET_KEY` = your Paystack secret key
- `BANK_ACCOUNT_NUMBER` = optional; otherwise the existing default is used
- `BANK_ACCOUNT_NAME` = optional; otherwise the existing default is used
- `BANK_NAME` = optional; otherwise the existing default is used
- `CRYPTO_ADDRESS` = optional; otherwise the existing default is used

Never put the Cloudinary API secret or Paystack secret key in frontend JavaScript.

## Deployment

1. Replace the old project files with this project.
2. Push the project to GitHub if that is how your Render service is connected.
3. In Render, make sure the environment variables above are present.
4. Deploy/redeploy.
5. On the first successful start with an empty `app_state` collection, the server automatically imports the included JSON catalog/user/payment/review data into MongoDB.
6. Open the normal login page and sign in with your dedicated `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
7. Then open `/admin.html` to enter the admin portal.
7. Re-upload any book files that were previously stored only on Render.
8. Test by uploading one PDF, waiting for Render to spin down, then opening the site and downloading that book again.

## Local development

Install dependencies:

```bash
npm install
```

Set the same MongoDB and Cloudinary environment variables, then run:

```bash
npm start
```

## Storage architecture

```text
Browser
  ↓
Render Node.js server
  ├── MongoDB → books/users/purchases/reviews/payment claims
  └── Cloudinary → PDF/DOC/DOCX/TXT book files
```

Render's ephemeral local filesystem is not used for permanent application data.
