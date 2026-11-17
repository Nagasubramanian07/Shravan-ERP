# Shravan ERP

A web ERP inspired by SAP Business One. The front end is plain HTML, CSS and JavaScript. The back end is a set of Vercel serverless functions that store the data in a Neon Postgres database and protect it with a login.

## What it does

**Master data:** business partners (GSTIN, PAN, addresses, payment terms, bank details), items (HSN/SAC, GST rate, valuation, stock by warehouse), HSN/SAC master, currency master (all documents in INR).

**Sales (A/R), same document chain as SAP Business One:** sales quotation, sales order, delivery, return, A/R invoice, A/R credit memo, incoming payment.
**Purchasing (A/P):** purchase order, goods receipt PO, goods return, A/P invoice, A/P credit memo, outgoing payment.
- Multi-line documents with a warehouse, quantity, unit price, discount and GST on every line
- Copy To: each document is created from the previous one, with partial quantities. The open quantity on the base document falls and it closes when nothing is left
- GST: CGST and SGST when the partner is in the company's state, IGST otherwise. The rate comes from the item's HSN/SAC code
- Each document posts its own journal entry. A direct invoice also moves stock
- Cancel a document: its journal entries and stock are reversed and the base document's open quantity is restored
- Payments are applied to specific invoices and credit memos, with part payments
**Inventory:** goods receipt, goods issue, inventory transfer, warehouses, stock adjustments, movement log.

**Finance:** chart of accounts, account determination, automatic journal entries for every posting step, manual journal entries, trial balance, profit and loss, balance sheet.

**Traceability:** a unique document number for every document (QT-, SO-, DL-, AR-, IP-, PO-, GP-, AI-, OP-, GR-, GI-, TR-, JE-, FT-), a document list with a details screen, and a journal entry list showing which document each entry was posted against.

**Shared data and login:** all users see the same data. Sign in with a username and password. An admin can add users and reset passwords.

## Architecture

```
index.html, css/, js/app.js, js/docs.js     the app that runs in the browser
api/login.js                    sign in, sets a signed HttpOnly session cookie
api/logout.js                   sign out
api/me.js                       who is signed in
api/db.js                       load and save the shared data (versioned)
api/users.js                    admin: list users, add a user, reset a password
lib/auth.js                     password hashing (scrypt) and session signing
lib/db.js                       Neon connection, creates tables on first use
sql/schema.sql                  the two tables, for reference
```

The browser never sees DATABASE_URL. Only the serverless functions use it.

## Environment variables (Vercel, Project Settings, Environment Variables)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `SESSION_SECRET` | random string, 32 or more characters, used to sign login cookies |
| `ADMIN_PASSWORD` | password for the first user, `admin`, created when the users table is empty |

Generate a secret with `openssl rand -base64 32`. After changing environment variables, redeploy.

## First run

1. Push these files to GitHub. Vercel deploys automatically.
2. Open the site and sign in as `admin` with your `ADMIN_PASSWORD`.
3. On the first load the app saves the sample data to the database.
4. Open Administration, then Users, to change the admin password and add your team. Saving an existing username resets its password.

The tables are created automatically. You do not need to run any SQL.

## How saving works

The whole data set is stored as one JSON document with a version number. Every save sends the version it last loaded. If another user saved first, the server refuses the save and the app reloads the latest data, so nothing is silently overwritten. The header shows Saving, Saved or a warning.

## Run locally

```
npm install
npx vercel dev
```

Create a `.env` file from `.env.example`. Do not commit it.

## Known limitations

- Roles are only admin and user. There are no per-module permissions yet.
- If two people edit at the same time, the second person's change is dropped and their screen reloads. They must enter it again. Row-level tables would remove this.
- The whole data set is one JSON document. Vercel limits a request to about 4.5 MB, so very large data needs proper tables.
- No login rate limiting beyond a short delay on a wrong password.
- Reset demo data (admin only) replaces the shared data for every user with the sample data.
- Purchase requests and purchase quotations, A/R down payments, price lists, batches and serial numbers, inventory counting and transfer requests are not built yet.
- Banking and bank reconciliation are not built.

## Next steps

1. Move from one JSON document to real tables (partners, items, documents, journal entries) so edits do not collide and reports can use SQL.
2. Multi-line documents with GST (CGST, SGST, IGST), returns and credit notes.
3. Per-module permissions, an audit log, banking and reconciliation.
