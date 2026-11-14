# Shravan ERP

A browser-based ERP inspired by SAP Business One. It runs entirely in the browser with plain HTML, CSS and JavaScript. There is no server and no build step. All data is saved in the browser's localStorage.

## What it does

**Master data**
- Business partners (customers, suppliers, leads) with GSTIN, PAN, addresses, payment terms and bank details
- Items with HSN/SAC code, GST rate, valuation method, prices, default warehouse and stock by warehouse
- HSN / SAC code master
- Currency master (all documents are shown in INR)

**Sales flow:** quotation, order, delivery, A/R invoice, incoming payment
**Purchase flow:** purchase order, goods receipt PO, A/P invoice, outgoing payment
**Inventory:** goods receipt, goods issue, inventory transfer, warehouses, stock adjustments, movement log

**Finance**
- Chart of accounts and account determination (which GL account each step posts to)
- Automatic journal entries for every posting step, plus manual journal entries
- Trial balance, profit and loss, balance sheet

**Traceability**
- A unique document number for every document, for example QT-1003, DL-3001, AR-4001, GR-7001, JE-12
- Document list with a details screen for every document
- Journal entry list showing which document each entry was posted against

## Run locally

Open `index.html` in a browser. Or serve the folder:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Deploy with GitHub Pages

1. Create a new repository on GitHub and push these files to the `main` branch.
2. In the repository go to Settings, then Pages, and set Source to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` publishes the site.

## Project structure

```
index.html            page shell and left menu
css/styles.css        styles (light and dark mode)
js/app.js             application logic, data and screens
.github/workflows/    GitHub Pages deployment
```

## Known limitations

- Data lives in one browser only. Clearing site data erases it. There are no user logins and no shared database.
- Each sales or purchase document holds one item.
- GST rates are stored in the HSN/SAC master but not yet applied to document tax calculation (no CGST, SGST or IGST).
- Cancelling or reversing a posted document, credit notes and returns are not built.
- Banking and bank reconciliation are not built.
- Exchange rates are for reference only. There is no foreign currency posting.

## Next steps

1. Multi-line documents with GST (CGST, SGST, IGST), returns and credit notes
2. Banking and reconciliation
3. A backend database with user logins and permissions, so a team can share data
