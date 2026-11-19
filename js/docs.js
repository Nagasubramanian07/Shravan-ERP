/* Sales A/R and Purchasing A/P document flows, modelled on SAP Business One.
   Multi-line documents, copy-to with partial quantities, GST per line,
   automatic journal entries, cancellation and payments applied to invoices. */
(function () {
  'use strict';
  const E = window.ERP, R = E.routes, T = E.titles, esc = E.esc, money = E.money, table = E.table;
  const $ = (id) => document.getElementById(id);
  const db = () => E.db;
  const r2 = E.r2, partner = E.partner, item = E.item;

  // ---- document types -------------------------------------------------
  // stock: +1 receives stock, -1 issues stock. base: types this document can be copied from.
  const TY = {
    QT: { n: 'Sales quotation', s: 's', base: [], to: ['SO'], edit: true },
    SO: { n: 'Sales order', s: 's', base: ['QT'], to: ['DL', 'AR'], edit: true },
    DL: { n: 'Delivery', s: 's', base: ['SO'], to: ['AR', 'RT'], stock: -1 },
    RT: { n: 'Return', s: 's', base: ['DL'], to: ['CM'], stock: 1 },
    AR: { n: 'A/R invoice', s: 's', base: ['SO', 'DL'], to: ['CM'] },
    CM: { n: 'A/R credit memo', s: 's', base: ['AR', 'RT'], to: [] },
    PO: { n: 'Purchase order', s: 'p', base: [], to: ['GP', 'AI'], edit: true },
    GP: { n: 'Goods receipt PO', s: 'p', base: ['PO'], to: ['AI', 'GT'], stock: 1 },
    GT: { n: 'Goods return', s: 'p', base: ['GP'], to: ['PC'], stock: -1 },
    AI: { n: 'A/P invoice', s: 'p', base: ['PO', 'GP'], to: ['PC'] },
    PC: { n: 'A/P credit memo', s: 'p', base: ['AI', 'GT'], to: [] },
  };
  const LISTS = { QT: 'Sales quotations', SO: 'Sales orders', DL: 'Deliveries', RT: 'Returns', AR: 'A/R invoices', CM: 'A/R credit memos', PO: 'Purchase orders', GP: 'Goods receipts PO', GT: 'Goods returns', AI: 'A/P invoices', PC: 'A/P credit memos' };
  Object.assign(E.DT, { RT: 'Return', CM: 'A/R credit memo', GT: 'Goods return', PC: 'A/P credit memo' });

  let FM = null;   // document form state
  let PF = null;   // payment form state
  let FL = '';     // one-time message
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const today = () => fmtDate(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return fmtDate(new Date(y, m - 1, d + n)); };
  const termDays = (p) => { const m = /Net (\d+)/.exec((p && p.terms) || ''); return m ? +m[1] : 0; };
  const sideOf = (t) => TY[t].s;
  const toNum = (v) => (v === '' || v == null ? '' : +v);
  const flash = () => { const m = FL; FL = ''; return m ? `<div class='box' role='status'><div class='pad' style='color:var(--ok);font-weight:600'>${esc(m)}</div></div>` : ''; };
  const link = (d) => `<button class='link' style='color:var(--acc)!important;font-weight:700' data-dd='d:${d.id}'>${esc(d.num)}</button>`;

  // ---- migration: new data areas, GST accounts, number series --------
  E.hooks.mig.push((D) => {
    D.docs = D.docs || []; D.pays = D.pays || [];
    D.seq.dd = D.seq.dd || 1; D.seq.pay = D.seq.pay || 1;
    D.co = D.co || { name: 'Shravan ERP', gstin: '', state: 'Tamil Nadu' };
    const add = (c, n, t) => { if (!D.gl.some((a) => a.c === c)) D.gl.push({ c, n, t }); };
    add(1300, 'Input CGST', 'Asset'); add(1310, 'Input SGST', 'Asset'); add(1320, 'Input IGST', 'Asset');
    add(5300, 'Rounding differences', 'Expense'); add(5400, 'Freight and other charges', 'Expense'); add(2200, 'Output CGST', 'Liability'); add(2210, 'Output SGST', 'Liability'); add(2220, 'Output IGST', 'Liability');
    const m = D.map;
    m.icg = m.icg || 1300; m.isg = m.isg || 1310; m.iig = m.iig || 1320;
    m.rnd = m.rnd || 5300; m.frt = m.frt || 5400; m.ocg = m.ocg || 2200; m.osg = m.osg || 2210; m.oig = m.oig || 2220;
    [['RT', 'Return'], ['CM', 'A/R credit memo'], ['GT', 'Goods return'], ['PC', 'A/P credit memo']].forEach(([k, l]) => {
      if (!D.ser[k]) D.ser[k] = { p: k, n: 1, l };
    });
  });

  // ---- GST ------------------------------------------------------------
  function itemRate(it) {
    const h = db().hsn.find((x) => x.code === it.hsn);
    if (h) return h.rate;
    return it.taxg === 'Standard 18%' ? 18 : it.taxg === 'Reduced 5%' ? 5 : 0;
  }
  function intra(p) { const st = p && (p.bstate || p.sstate); return !st || st === db().co.state; }
  function calc(d) {
    const ia = intra(partner(d.pid)), fd = +d.disc || 0;
    let s0 = 0, lt = 0;
    d.lines.forEach((l) => {
      l.net = r2((+l.q || 0) * (+l.price || 0) * (1 - (+l.disc || 0) / 100));
      l.tax = r2(l.net * (1 - fd / 100) * (+l.rate || 0) / 100);
      s0 += l.net; lt += l.tax;
    });
    d.gross = r2(s0); d.discAmt = r2(s0 * fd / 100); d.sub = r2(s0 - d.discAmt);
    d.freight = r2(+d.freight || 0);
    const tax = r2(lt + d.freight * (+d.ftax || 0) / 100);
    d.tc = 0; d.ts = 0; d.ti = 0;
    if (ia) { d.tc = r2(tax / 2); d.ts = r2(tax - d.tc); } else d.ti = tax;
    const pre = r2(d.sub + d.freight + tax);
    d.rnd = d.roundOn ? r2(Math.round(pre) - pre) : 0;
    d.total = r2(pre + d.rnd); d.intra = ia;
  }
  const taxRows = (d, sales) => {
    const m = db().map, k = sales ? ['ocg', 'osg', 'oig'] : ['icg', 'isg', 'iig'];
    return [[m[k[0]], d.tc], [m[k[1]], d.ts], [m[k[2]], d.ti]].filter((x) => x[1]);
  };
  const INV = ['AR', 'CM', 'AI', 'PC'];
  const addr = (p, k) => !p ? '' : (k === 'b' ? [p.bst != null ? p.bst : p.bill, p.bcity, p.bstate, p.bpin, p.bcountry] : [p.sst != null ? p.sst : p.ship, p.scity, p.sstate, p.spin, p.scountry]).filter(Boolean).join(', ');
  const headFrom = (p) => ({ contact: (p && p.contact) || '', terms: (p && p.terms) || '', bill: addr(p, 'b'), ship: addr(p, 's') });
  const DUE = { QT: 'Valid until', SO: 'Delivery date', DL: 'Delivery date', RT: 'Return date', PO: 'Delivery date', GP: 'Receipt date', GT: 'Return date' };
  const dueLabel = (t) => DUE[t] || 'Due date';

  // ---- posting --------------------------------------------------------
  function postJ(d, src, rows) {
    const ls = rows.filter((r) => r[1] || r[2]);
    if (!ls.length) return;
    E.setDoc(d.num); E.post(d.root, src, ls); E.setDoc('');
  }
  const balance = (d) => r2(d.total - (d.paid || 0));

  function create(fm) {
    const D = db(), c = TY[fm.t], p = partner(fm.pid);
    if (!p) return 'Choose a business partner.';
    if (!fm.lines.length) return 'Add at least one item line.';
    const base = fm.base ? D.docs.find((x) => x.id === fm.base.id) : null;
    for (let i = 0; i < fm.lines.length; i++) {
      const l = fm.lines[i], n = i + 1;
      if (!item(l.iid)) return `Line ${n}: choose an item.`;
      if (!(+l.q > 0)) return `Line ${n}: quantity must be above zero.`;
      if (l.price === '' || !(+l.price >= 0)) return `Line ${n}: enter a unit price.`;
      if (!(+l.disc >= 0 && +l.disc <= 100)) return `Line ${n}: discount must be between 0 and 100.`;
      if (!(+l.rate >= 0 && +l.rate <= 100)) return `Line ${n}: tax must be between 0 and 100.`;
      if (!D.wh.some((w) => w.id === +l.wh)) return `Line ${n}: choose a warehouse.`;
      if (base && l.bl != null && +l.q > base.lines[l.bl].open) return `Line ${n}: only ${base.lines[l.bl].open} left to copy from ${base.num}.`;
    }
    const fd = +fm.disc || 0, inv = INV.includes(fm.t);
    if (!(fd >= 0 && fd <= 100)) return 'Discount must be between 0 and 100.';
    if (inv && (+fm.freight || 0) < 0) return 'Freight cannot be negative.';
    let dir = c.stock || 0;
    if (fm.t === 'AR' && !(base && base.t === 'DL')) dir = -1;
    if (fm.t === 'AI' && !(base && base.t === 'GP')) dir = 1;
    if (fm.t === 'CM' && base && base.t === 'AR' && fm.retStock) dir = 1;
    if (dir < 0) {
      const need = {};
      fm.lines.forEach((l) => { const k = l.iid + ':' + l.wh; need[k] = (need[k] || 0) + +l.q; });
      for (const k of Object.keys(need)) {
        const [iid, wh] = k.split(':').map(Number), it = item(iid);
        if ((it.wh[wh] || 0) < need[k]) return `Not enough stock of ${it.name} in that warehouse (${it.wh[wh] || 0} available).`;
      }
    }
    const date = fm.date || today();
    const d = {
      id: D.seq.dd++, t: fm.t, num: E.nextNo(fm.t), date, docDate: fm.docDate || date, due: fm.due || date,
      pid: p.id, status: 'Open', paid: 0,
      cref: fm.cref || '', contact: fm.contact || '', terms: fm.terms || '', emp: fm.emp || '',
      bill: fm.bill || '', ship: fm.ship || '', rem: fm.rem || '', jrem: fm.jrem || '',
      disc: fd, freight: inv ? +fm.freight || 0 : 0, ftax: inv ? +fm.ftax || 0 : 0, roundOn: inv && !!fm.roundOn,
      base: base ? { id: base.id, t: base.t, num: base.num } : null,
      lines: fm.lines.map((l) => ({ iid: +l.iid, wh: +l.wh, q: +l.q, price: +l.price, disc: +l.disc || 0, rate: +l.rate || 0, desc: l.desc || '', uom: l.uom || '', open: +l.q, bl: l.bl == null ? null : l.bl })),
    };
    d.root = base ? base.root : d.num;
    calc(d);
    const m = D.map, cost = dir ? r2(d.lines.reduce((s, l) => s + l.q * E.cst(item(l.iid)), 0)) : 0, sales = c.s === 's';
    const rnd = d.rnd, fr = d.freight, cr = (x) => (x > 0 ? x : 0), dr = (x) => (x < 0 ? -x : 0);
    if (dir) d.lines.forEach((l) => E.mv(item(l.iid), l.wh, dir * l.q, c.n, d.num));
    if (dir > 0 && !sales) d.lines.forEach((l) => { if (l.q > 0) item(l.iid).cost = r2(l.net * (1 - fd / 100) / l.q); });
    switch (fm.t) {
      case 'DL': postJ(d, 'Delivery', [[m.cogs, cost, 0], [m.inv, 0, cost]]); break;
      case 'RT': postJ(d, 'Return', [[m.inv, cost, 0], [m.cogs, 0, cost]]); break;
      case 'AR':
        postJ(d, 'A/R invoice', [[m.ar, d.total, 0], [m.rev, 0, d.sub + fr], ...taxRows(d, true).map((x) => [x[0], 0, x[1]]), [m.rnd, dr(rnd), cr(rnd)]]);
        if (dir < 0) postJ(d, 'Delivery with invoice', [[m.cogs, cost, 0], [m.inv, 0, cost]]);
        break;
      case 'CM':
        postJ(d, 'A/R credit memo', [[m.rev, d.sub + fr, 0], ...taxRows(d, true).map((x) => [x[0], x[1], 0]), [m.rnd, cr(rnd), dr(rnd)], [m.ar, 0, d.total]]);
        if (dir > 0) postJ(d, 'Goods returned with credit memo', [[m.inv, cost, 0], [m.cogs, 0, cost]]);
        break;
      case 'GP': postJ(d, 'Goods receipt PO', [[m.inv, d.sub, 0], [m.grir, 0, d.sub]]); break;
      case 'GT': postJ(d, 'Goods return', [[m.grir, d.sub, 0], [m.inv, 0, d.sub]]); break;
      case 'AI':
        postJ(d, 'A/P invoice', [[dir > 0 ? m.inv : m.grir, d.sub, 0], [m.frt, fr, 0], ...taxRows(d, false).map((x) => [x[0], x[1], 0]), [m.rnd, cr(rnd), dr(rnd)], [m.ap, 0, d.total]]);
        break;
      case 'PC': postJ(d, 'A/P credit memo', [[m.ap, d.total, 0], [m.grir, 0, d.sub], [m.frt, 0, fr], ...taxRows(d, false).map((x) => [x[0], 0, x[1]]), [m.rnd, dr(rnd), cr(rnd)]]); break;
      default: break;
    }
    if (base) {
      d.lines.forEach((l) => { if (l.bl != null) base.lines[l.bl].open -= l.q; });
      if (base.lines.every((l) => l.open <= 0)) base.status = 'Closed';
    }
    D.docs.push(d);
    return d;
  }

  function cancel(d) {
    const D = db();
    if (d.status === 'Cancelled') return 'This document is already cancelled.';
    if (D.docs.some((x) => x.base && x.base.id === d.id && x.status !== 'Cancelled')) return 'Cancel the documents created from this one first.';
    if ((d.paid || 0) > 0) return 'Payments are applied to this document. Cancel the payment first.';
    const mvs = D.mv.filter((v) => v.r === d.num);
    for (const v of mvs) {
      const it = item(v.i);
      if (!it) return 'An item on this document was deleted.';
      if (v.q > 0 && (it.wh[v.w] || 0) < v.q) return `Not enough stock of ${it.name} to reverse this document.`;
    }
    const label = d.num + ' (cancel)';
    D.je.filter((j) => j.doc === d.num).forEach((j) => {
      E.setDoc(label); E.post(j.ref, 'Cancellation of ' + j.src, j.lines.map((l) => [l.a, l.cr, l.dr])); E.setDoc('');
    });
    mvs.forEach((v) => E.mv(item(v.i), v.w, -v.q, 'Cancellation', label));
    if (d.base) {
      const b = D.docs.find((x) => x.id === d.base.id);
      if (b) { d.lines.forEach((l) => { if (l.bl != null) b.lines[l.bl].open += l.q; }); b.status = 'Open'; }
    }
    d.status = 'Cancelled';
    return null;
  }

  // ---- payments -------------------------------------------------------
  function createPay(pf) {
    const D = db(), p = partner(pf.pid);
    if (!p) return 'Choose a business partner.';
    const ids = Object.keys(pf.alloc).filter((k) => +pf.alloc[k] > 0);
    if (!ids.length) return 'Enter an amount against at least one document.';
    let amt = 0; const used = [];
    for (const k of ids) {
      const d = D.docs.find((x) => x.id === +k), a = r2(+pf.alloc[k]);
      if (!d || d.status === 'Cancelled' || d.pid !== pf.pid) return 'One of the selected documents is not valid.';
      if (a > balance(d) + 0.001) return `${d.num}: the amount is more than the balance ${money(balance(d))}.`;
      amt += (d.t === 'CM' || d.t === 'PC') ? -a : a; used.push([d, a]);
    }
    amt = r2(amt);
    if (amt < 0) return 'Credit memos applied cannot be more than the invoices selected.';
    const m = D.map, num = E.nextNo(pf.t);
    const pay = { id: D.seq.pay++, t: pf.t, num, date: pf.date || today(), pid: pf.pid, amt, mode: pf.mode, ref: pf.ref || '', status: 'Posted',
      allocs: used.map(([d, a]) => ({ id: d.id, num: d.num, amt: a })), root: used[0][0].root };
    used.forEach(([d, a]) => { d.paid = r2((d.paid || 0) + a); if (balance(d) <= 0.001) d.status = 'Closed'; });
    D.pays.push(pay);
    if (amt > 0) {
      E.setDoc(num);
      E.post(pay.root, pf.t === 'IP' ? 'Incoming payment' : 'Outgoing payment', pf.t === 'IP' ? [[m.cash, amt, 0], [m.ar, 0, amt]] : [[m.ap, amt, 0], [m.cash, 0, amt]]);
      E.setDoc('');
    }
    return pay;
  }
  function cancelPay(pay) {
    const D = db();
    if (pay.status === 'Cancelled') return 'This payment is already cancelled.';
    const label = pay.num + ' (cancel)';
    D.je.filter((j) => j.doc === pay.num).forEach((j) => {
      E.setDoc(label); E.post(j.ref, 'Cancellation of ' + j.src, j.lines.map((l) => [l.a, l.cr, l.dr])); E.setDoc('');
    });
    pay.allocs.forEach((a) => {
      const d = D.docs.find((x) => x.id === a.id);
      if (d) { d.paid = r2((d.paid || 0) - a.amt); if (d.status === 'Closed') d.status = 'Open'; }
    });
    pay.status = 'Cancelled';
    return null;
  }

  // ---- list screens ---------------------------------------------------
  function listScreen(k) {
    const c = TY[k], rows = db().docs.filter((d) => d.t === k).reverse().map((d) => {
      const p = partner(d.pid);
      return `<tr><td>${link(d)}</td><td>${d.date}</td><td>${esc(p ? p.name : 'Deleted partner')}</td><td>${d.base ? esc(d.base.num) : ''}</td><td class='r'>${money(d.sub)}</td><td class='r'>${money(d.total - d.sub)}</td><td class='r'>${money(d.total)}</td><td><span class='badge ${d.status === 'Open' ? 'open' : d.status === 'Closed' ? 'closed' : 'low'}'>${d.status}</span></td></tr>`;
    });
    return flash() + `<div class='box'><h3>${LISTS[k]}</h3><div class='pad'><button class='p' data-new='${k}'>New ${c.n.toLowerCase()}</button></div>` +
      table([{ h: 'Document no.' }, { h: 'Posting date' }, { h: c.s === 's' ? 'Customer' : 'Supplier' }, { h: 'Based on' }, { h: 'Net', r: 1 }, { h: 'Tax', r: 1 }, { h: 'Total', r: 1 }, { h: 'Status' }], rows) + '</div>';
  }
  Object.keys(TY).forEach((k) => { R[k.toLowerCase()] = () => listScreen(k); T[k.toLowerCase()] = LISTS[k]; });

  // ---- document form --------------------------------------------------
  const needMaster = (k) => {
    const want = sideOf(k) === 's' ? 'customer' : 'supplier', D = db();
    if (!D.partners.some((x) => x.type === (want === 'customer' ? 'Customer' : 'Supplier') && x.active !== false)) return `Add a ${want} under Business partner master data first.`;
    if (!D.items.length) return 'Add an item under Item master data first.';
    return '';
  };
  function blankLine(t) {
    const it = db().items[0]; if (!it) return null;
    return { iid: it.id, wh: it.dwh || 1, q: 1, price: sideOf(t) === 's' ? it.price : E.cst(it), disc: 0, rate: itemRate(it), desc: it.name, uom: it.uom || '', bl: null };
  }
  function startNew(k) {
    const msg = needMaster(k); if (msg) { FL = msg; E.route(); return; }
    const want = sideOf(k) === 's' ? 'Customer' : 'Supplier';
    const p = db().partners.find((x) => x.type === want && x.active !== false), date = today();
    FM = { t: k, pid: p.id, date, docDate: date, due: addDays(date, termDays(p)), cref: '', emp: '', rem: '', jrem: '', disc: 0, freight: 0, ftax: 0, roundOn: false, ...headFrom(p), lines: [blankLine(k)], base: null, pick: '' };
    location.hash = 'dform';
  }
  function copyFrom(k, baseId) {
    const b = db().docs.find((x) => x.id === baseId), p = partner(b.pid), date = today();
    FM = { t: k, pid: b.pid, date, docDate: date, due: addDays(date, termDays(p)), cref: b.cref || '', emp: b.emp || '', rem: '', jrem: '', disc: b.disc || 0, freight: 0, ftax: 0, roundOn: false,
      contact: b.contact || '', terms: b.terms || '', bill: b.bill || '', ship: b.ship || '',
      base: { id: b.id, t: b.t, num: b.num }, pick: '',
      lines: b.lines.map((l, i) => ({ iid: l.iid, wh: l.wh, q: l.open, price: l.price, disc: l.disc, rate: l.rate, desc: l.desc || '', uom: l.uom || '', bl: i })).filter((l) => l.q > 0) };
    location.hash = 'dform';
  }
  function totalsHtml(d, idp) {
    const g = d.gross == null ? d.sub : d.gross;
    const row = (k, v, id, b) => `<tr><th>${k}</th><td class='r'${id ? ` id='${id}'` : ''}>${b ? '<b>' : ''}${money(v)}${b ? '</b>' : ''}</td></tr>`;
    return row('Total before discount', g, idp && 'ft-gross') +
      (d.disc ? row(`Discount ${d.disc}%`, -(d.discAmt || 0), idp && 'ft-disc') : '') +
      (d.freight ? row('Freight', d.freight, idp && 'ft-fr') : '') +
      (d.intra ? row('CGST', d.tc, idp && 'ft-c') + row('SGST', d.ts, idp && 'ft-s') : row('IGST', d.ti, idp && 'ft-i')) +
      (d.roundOn ? row('Rounding', d.rnd, idp && 'ft-rnd') : '') + row('Total payment due', d.total, idp && 'ft-t', true);
  }
  const tmpOf = () => { const t = { pid: FM.pid, disc: FM.disc, freight: FM.freight, ftax: FM.ftax, roundOn: FM.roundOn, lines: FM.lines.map((l) => ({ ...l })) }; calc(t); return t; };
  function formScreen() {
    if (!FM) return `<div class='box'><div class='pad'>Open a list and click New to start a document.</div></div>`;
    const c = TY[FM.t], D = db(), side = c.s, inv = INV.includes(FM.t);
    const parts = D.partners.filter((p) => p.type === (side === 's' ? 'Customer' : 'Supplier') && p.active !== false);
    const eligible = D.docs.filter((d) => d.pid === FM.pid && c.base.includes(d.t) && d.status === 'Open' && d.lines.some((l) => l.open > 0));
    const tmp = tmpOf();
    const I = (f, label, type, extra) => `<label>${label}<input data-fl='h:${f}' ${type ? `type='${type}'` : ''} value='${esc(FM[f] == null ? '' : FM[f])}' ${extra || ''}></label>`;
    const wo = (sel) => D.wh.map((w) => `<option value='${w.id}'${w.id === +sel ? ' selected' : ''}>${esc(w.code)}</option>`).join('');
    const io = (sel) => D.items.map((i) => `<option value='${i.id}'${i.id === +sel ? ' selected' : ''}>${esc(i.code + ' ' + i.name)}</option>`).join('');
    const lines = FM.lines.map((l, i) => `<tr>
      <td>${i + 1}</td>
      <td><select data-fc='${i}:iid' aria-label='Item'>${io(l.iid)}</select></td>
      <td><input data-fl='${i}:desc' value='${esc(l.desc || '')}' style='width:160px' aria-label='Item description'></td>
      <td><select data-fc='${i}:wh' aria-label='Warehouse'>${wo(l.wh)}</select></td>
      <td><input data-fl='${i}:q' type='number' min='0' step='any' value='${l.q}' style='width:80px' aria-label='Quantity'></td>
      <td>${esc(l.uom || '')}</td>
      <td><input data-fl='${i}:price' type='number' min='0' step='0.01' value='${l.price}' style='width:105px' aria-label='Unit price'></td>
      <td><input data-fl='${i}:disc' type='number' min='0' max='100' step='0.01' value='${l.disc}' style='width:65px' aria-label='Discount percent'></td>
      <td><input data-fl='${i}:rate' type='number' min='0' max='100' step='0.01' value='${l.rate}' style='width:65px' aria-label='Tax percent'></td>
      <td class='r' id='fl-${i}'>${money(tmp.lines[i].net)}</td>
      <td>${FM.base ? '' : `<button data-frm='${i}' aria-label='Remove line'>×</button>`}</td></tr>`).join('');
    const retBox = FM.t === 'CM' && FM.base && FM.base.t === 'AR' ? `<p><label><input type='checkbox' data-fl='h:retStock'${FM.retStock ? ' checked' : ''}> Return the goods to stock</label></p>` : '';
    const copy = FM.base ? `<p class='meta'>Copied from ${esc(FM.base.num)}. Lower a quantity to copy only part of it.</p>${retBox}` :
      (c.base.length ? `<div class='form'><label>Copy from an open document<select data-fc='h:pick'><option value=''>Choose</option>${eligible.map((d) => `<option value='${d.id}'${String(d.id) === String(FM.pick) ? ' selected' : ''}>${esc(d.num)} (${money(d.total)})</option>`).join('')}</select></label><button data-fcopy='1'>Copy lines</button></div>` : '');
    const terms = ['Immediate', 'Net 15', 'Net 30', 'Net 60'];
    return `<div class='box'><h3>New ${esc(c.n.toLowerCase())}</h3><div class='pad'>
      <h4 class='hd'>General</h4><div class='form'>
        <label>${side === 's' ? 'Customer' : 'Supplier'}<select data-fc='h:pid' ${FM.base ? 'disabled' : ''}>${parts.map((p) => `<option value='${p.id}'${p.id === FM.pid ? ' selected' : ''}>${esc(p.code + ' ' + p.name)}</option>`).join('')}</select></label>
        ${I('contact', 'Contact person')}${I('cref', side === 's' ? 'Customer ref. no.' : 'Vendor ref. no.')}
        <label>Currency<input value='INR' readonly tabindex='-1' style='width:70px'></label>
        ${I('date', 'Posting date', 'date')}${I('docDate', 'Document date', 'date')}${I('due', dueLabel(FM.t), 'date')}
        <label>Payment terms<select data-fc='h:terms'><option value=''>-</option>${terms.map((x) => `<option${x === FM.terms ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      </div>
      <h4 class='hd'>Addresses</h4><div class='form'>${I('bill', 'Bill-to / pay-to address', '', "style='width:280px'")}${I('ship', 'Ship-to address', '', "style='width:280px'")}</div>${copy}
      <h4 class='hd'>Contents</h4><div class='wrap'><table><thead><tr><th>#</th><th>Item no.</th><th>Description</th><th>Whse</th><th>Quantity</th><th>UoM</th><th>Unit price</th><th>Disc %</th><th>Tax %</th><th class='r'>Total</th><th></th></tr></thead><tbody>${lines}</tbody></table></div>
      ${FM.base ? '' : `<p><button data-fadd='1'>Add line</button></p>`}
      <h4 class='hd'>Logistics and accounting</h4><div class='form'>
        ${I('emp', side === 's' ? 'Sales employee' : 'Buyer')}${I('rem', 'Remarks', '', "style='width:240px'")}${I('jrem', 'Journal remarks', '', "style='width:240px'")}
        ${I('disc', 'Discount % (whole document)', 'number', "min='0' max='100' step='0.01' style='width:90px'")}
        ${inv ? I('freight', 'Freight', 'number', "min='0' step='0.01' style='width:100px'") + I('ftax', 'Freight tax %', 'number', "min='0' max='100' step='0.01' style='width:80px'") + `<label>Rounding<input type='checkbox' data-fl='h:roundOn'${FM.roundOn ? ' checked' : ''}></label>` : ''}
      </div>
      <div class='wrap'><table id='ft' style='min-width:0;max-width:360px;margin-left:auto'>${totalsHtml(tmp, true)}</table></div>
      <p class='meta'>${tmp.intra ? 'Same state as your company: CGST and SGST apply.' : 'Different state: IGST applies.'} Tax % per line comes from the item HSN/SAC code and can be changed.</p>
      <p><button class='p' data-fsave='1'>Add document</button> <button data-fcancel='1'>Cancel</button></p><div class='msg' id='msg'></div></div></div>`;
  }
  R.dform = formScreen; T.dform = 'New document';
  function refreshTotals() {
    const tmp = tmpOf();
    tmp.lines.forEach((l, i) => { const e = $('fl-' + i); if (e) e.textContent = money(l.net); });
    const ft = $('ft'); if (ft) ft.innerHTML = totalsHtml(tmp, true);
  }

  // ---- details screen -------------------------------------------------
  function detail(id) {
    const D = db(), d = D.docs.find((x) => x.id === id), back = `<button data-back='1'>Back to list</button>`;
    if (!d) return `<div class='box'><div class='pad'>${back} Document not found.</div></div>`;
    const c = TY[d.t], p = partner(d.pid), sales = c.s === 's';
    const row = (k, v) => `<tr><th style='width:42%'>${k}</th><td>${v == null || v === '' ? '-' : v}</td></tr>`;
    const targets = D.docs.filter((x) => x.base && x.base.id === d.id);
    const open = d.status === 'Open';
    const btns = (open ? c.to.map((k) => `<button class='p' data-copyto='${k}:${d.id}'>Copy to ${esc(TY[k].n.toLowerCase())}</button>`).join(' ') : '') +
      (d.status !== 'Cancelled' ? ` <button class='x' data-cancel-doc='${d.id}'>Cancel document</button>` : '') + ` <button data-print='1'>Print</button> ${back}`;
    const items = d.lines.map((l, i) => { const it = item(l.iid), w = D.wh.find((x) => x.id === l.wh); return `<tr><td>${i + 1}</td><td>${esc(it ? it.code : 'Deleted item')}</td><td>${esc(l.desc || (it ? it.name : ''))}</td><td>${esc(it && it.hsn ? it.hsn : '')}</td><td>${esc(w ? w.code : '')}</td><td class='r'>${l.q}</td><td>${esc(l.uom || '')}</td><td class='r'>${l.open}</td><td class='r'>${money(l.price)}</td><td class='r'>${l.disc}%</td><td class='r'>${money(l.net)}</td><td class='r'>${l.rate}%</td><td class='r'>${money(l.net + l.tax)}</td></tr>`; });
    const je = []; D.je.filter((j) => j.doc === d.num || j.doc === d.num + ' (cancel)').forEach((j) => j.lines.forEach((l, k) => je.push(`<tr><td>${k ? '' : 'JE-' + j.id}</td><td>${k ? '' : esc(j.src)}</td><td>${k ? '' : j.date}</td><td>${esc(E.acn(l.a))}</td><td class='r'>${l.dr ? money(l.dr) : ''}</td><td class='r'>${l.cr ? money(l.cr) : ''}</td></tr>`)));
    const mv = D.mv.filter((v) => v.r === d.num || v.r === d.num + ' (cancel)').map((v) => { const it = item(v.i), w = D.wh.find((x) => x.id === v.w); return `<tr><td>${esc(it ? it.name : '')}</td><td>${esc(w ? w.code : '')}</td><td class='r'>${v.q > 0 ? '+' : ''}${v.q}</td><td>${esc(v.r)}</td></tr>`; });
    const pays = D.pays.filter((y) => y.allocs.some((a) => a.id === d.id)).map((y) => `<tr><td><button class='link' style='color:var(--acc)!important;font-weight:700' data-dd='y:${y.id}'>${esc(y.num)}</button></td><td>${y.date}</td><td class='r'>${money(y.allocs.find((a) => a.id === d.id).amt)}</td><td>${y.status}</td></tr>`);
    return flash() + `<div class='box'><h3>${esc(c.n)} ${esc(d.num)}</h3><div class='pad'>${btns}</div><div class='msg' id='msg'></div></div>` +
      `<div class='box'><h3>Header</h3><div class='wrap'><table style='min-width:0'>${row('Status', d.status)}${row(sales ? 'Customer' : 'Supplier', p ? esc(p.code + ' ' + p.name) : 'Deleted partner')}${row('GSTIN', p ? esc(p.gstin || '') : '')}${row('Contact person', esc(d.contact))}${row(sales ? 'Customer ref. no.' : 'Vendor ref. no.', esc(d.cref))}${row('Currency', 'INR')}${row('Posting date', d.date)}${row('Document date', d.docDate || d.date)}${row(dueLabel(d.t), d.due)}${row('Payment terms', esc(d.terms))}${row(sales ? 'Sales employee' : 'Buyer', esc(d.emp))}${row('Bill-to address', esc(d.bill))}${row('Ship-to address', esc(d.ship))}${row('Place of supply', d.intra ? 'Same state: CGST and SGST' : 'Other state: IGST')}${row('Based on', d.base ? `<button class='link' style='color:var(--acc)!important' data-dd='d:${d.base.id}'>${esc(d.base.num)}</button>` : '')}${row('Flow reference', esc(d.root))}${row('Remarks', esc(d.rem))}${row('Journal remarks', esc(d.jrem))}${d.t === 'AR' || d.t === 'AI' || d.t === 'CM' || d.t === 'PC' ? row('Paid or applied', money(d.paid || 0)) + row('Balance', money(balance(d))) : ''}</table></div></div>` +
      `<div class='box'><h3>Items</h3>` + table([{ h: '#' }, { h: 'Item no.' }, { h: 'Description' }, { h: 'HSN/SAC' }, { h: 'Whse' }, { h: 'Qty', r: 1 }, { h: 'UoM' }, { h: 'Open qty', r: 1 }, { h: 'Unit price', r: 1 }, { h: 'Disc', r: 1 }, { h: 'Net', r: 1 }, { h: 'Tax', r: 1 }, { h: 'Line total', r: 1 }], items) +
      `<div class='wrap'><table style='min-width:0;max-width:340px;margin-left:auto'>${totalsHtml(d)}</table></div></div>` +
      `<div class='box'><h3>Documents created from this one</h3>` + table([{ h: 'Document no.' }, { h: 'Type' }, { h: 'Date' }, { h: 'Total', r: 1 }, { h: 'Status' }], targets.map((x) => `<tr><td>${link(x)}</td><td>${esc(TY[x.t].n)}</td><td>${x.date}</td><td class='r'>${money(x.total)}</td><td>${x.status}</td></tr>`)) + '</div>' +
      (pays.length ? `<div class='box'><h3>Payments</h3>` + table([{ h: 'Payment' }, { h: 'Date' }, { h: 'Applied', r: 1 }, { h: 'Status' }], pays) + '</div>' : '') +
      `<div class='box'><h3>Journal entries</h3>` + (je.length ? table([{ h: 'JE no.' }, { h: 'Step' }, { h: 'Date' }, { h: 'Account' }, { h: 'Debit', r: 1 }, { h: 'Credit', r: 1 }], je) : `<div class='pad'>This document does not post to the ledger.</div>`) + '</div>' +
      (mv.length ? `<div class='box'><h3>Stock movements</h3>` + table([{ h: 'Item' }, { h: 'Warehouse' }, { h: 'Quantity', r: 1 }, { h: 'Reference' }], mv) + '</div>' : '');
  }
  function payDetail(id) {
    const D = db(), y = D.pays.find((x) => x.id === id), back = `<button data-back='1'>Back to list</button>`;
    if (!y) return `<div class='box'><div class='pad'>${back} Payment not found.</div></div>`;
    const p = partner(y.pid);
    const je = []; D.je.filter((j) => j.doc === y.num || j.doc === y.num + ' (cancel)').forEach((j) => j.lines.forEach((l, k) => je.push(`<tr><td>${k ? '' : 'JE-' + j.id}</td><td>${k ? '' : j.date}</td><td>${esc(E.acn(l.a))}</td><td class='r'>${l.dr ? money(l.dr) : ''}</td><td class='r'>${l.cr ? money(l.cr) : ''}</td></tr>`)));
    return flash() + `<div class='box'><h3>${y.t === 'IP' ? 'Incoming' : 'Outgoing'} payment ${esc(y.num)}</h3><div class='pad'>${y.status !== 'Cancelled' ? `<button class='x' data-cancel-pay='${y.id}'>Cancel payment</button> ` : ''}${back}<div class='msg' id='msg'></div></div></div>` +
      `<div class='box'><h3>Header</h3><div class='wrap'><table style='min-width:0'><tr><th style='width:42%'>Status</th><td>${y.status}</td></tr><tr><th>Business partner</th><td>${esc(p ? p.code + ' ' + p.name : '')}</td></tr><tr><th>Date</th><td>${y.date}</td></tr><tr><th>Payment means</th><td>${esc(y.mode)}</td></tr><tr><th>Reference</th><td>${esc(y.ref || '-')}</td></tr><tr><th>Amount</th><td>${money(y.amt)}</td></tr></table></div></div>` +
      `<div class='box'><h3>Applied to</h3>` + table([{ h: 'Document' }, { h: 'Applied', r: 1 }], y.allocs.map((a) => { const d = D.docs.find((x) => x.id === a.id); return `<tr><td>${d ? link(d) : esc(a.num)}</td><td class='r'>${money(a.amt)}</td></tr>`; })) + '</div>' +
      `<div class='box'><h3>Journal entries</h3>` + (je.length ? table([{ h: 'JE no.' }, { h: 'Date' }, { h: 'Account' }, { h: 'Debit', r: 1 }, { h: 'Credit', r: 1 }], je) : `<div class='pad'>No journal entry (credit memos fully offset the invoices).</div>`) + '</div>';
  }
  const _doc = R.doc;
  R.doc = () => { const x = E.dcur; if (x && x.t === 'd') return detail(x.id); if (x && x.t === 'y') return payDetail(x.id); return _doc(); };

  // ---- payment screens ------------------------------------------------
  function payList(t) {
    const rows = db().pays.filter((y) => y.t === t).reverse().map((y) => { const p = partner(y.pid); return `<tr><td><button class='link' style='color:var(--acc)!important;font-weight:700' data-dd='y:${y.id}'>${esc(y.num)}</button></td><td>${y.date}</td><td>${esc(p ? p.name : '')}</td><td>${esc(y.mode)}</td><td class='r'>${money(y.amt)}</td><td>${y.status}</td></tr>`; });
    return flash() + `<div class='box'><h3>${t === 'IP' ? 'Incoming payments' : 'Outgoing payments'}</h3><div class='pad'><button class='p' data-newpay='${t}'>New ${t === 'IP' ? 'incoming' : 'outgoing'} payment</button></div>` +
      table([{ h: 'Payment no.' }, { h: 'Date' }, { h: t === 'IP' ? 'Customer' : 'Supplier' }, { h: 'Payment means' }, { h: 'Amount', r: 1 }, { h: 'Status' }], rows) + '</div>';
  }
  R.ip = () => payList('IP'); R.op = () => payList('OP'); T.ip = 'Incoming payments'; T.op = 'Outgoing payments';
  function payTotal() { let s = 0; db().docs.forEach((d) => { const a = +PF.alloc[d.id] || 0; s += (d.t === 'CM' || d.t === 'PC') ? -a : a; }); return r2(s); }
  function payForm() {
    if (!PF) return `<div class='box'><div class='pad'>Open Incoming or Outgoing payments and click New.</div></div>`;
    const D = db(), sales = PF.t === 'IP', want = sales ? 'Customer' : 'Supplier', kinds = sales ? ['AR', 'CM'] : ['AI', 'PC'];
    const parts = D.partners.filter((p) => p.type === want && p.active !== false);
    const docs = D.docs.filter((d) => d.pid === PF.pid && kinds.includes(d.t) && d.status === 'Open' && balance(d) > 0.001);
    const rows = docs.map((d) => `<tr><td>${link(d)}</td><td>${esc(TY[d.t].n)}</td><td>${d.date}</td><td>${d.due}</td><td class='r'>${money(d.total)}</td><td class='r'>${d.t === 'CM' || d.t === 'PC' ? '-' : ''}${money(balance(d))}</td><td><input data-pa='${d.id}' type='number' min='0' step='0.01' value='${PF.alloc[d.id] || ''}' style='width:120px' aria-label='Amount to apply to ${esc(d.num)}'></td></tr>`);
    return `<div class='box'><h3>New ${sales ? 'incoming' : 'outgoing'} payment</h3><div class='pad'><div class='form'>
      <label>${sales ? 'Customer' : 'Supplier'}<select data-pc='pid'>${parts.map((p) => `<option value='${p.id}'${p.id === PF.pid ? ' selected' : ''}>${esc(p.code + ' ' + p.name)}</option>`).join('')}</select></label>
      <label>Date<input data-pf='date' type='date' value='${PF.date}'></label>
      <label>Payment means<select data-pf='mode'>${['Cash', 'Bank transfer', 'UPI', 'Cheque', 'Card'].map((m) => `<option${m === PF.mode ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Reference<input data-pf='ref' value='${esc(PF.ref)}'></label></div>
      ${docs.length ? '' : `<p class='meta'>This partner has no open documents.</p>`}
      <div class='wrap'><table><thead><tr><th>Document</th><th>Type</th><th>Date</th><th>Due</th><th class='r'>Total</th><th class='r'>Balance</th><th>Apply</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p><button data-pfill='1'>Pay all open invoices in full</button></p>
      <p><b>Payment amount: <span id='pay-total'>${money(payTotal())}</span></b></p>
      <p><button class='p' data-psave='1'>Post payment</button> <button data-pcancel='1'>Cancel</button></p><div class='msg' id='msg'></div></div></div>`;
  }
  R.pform = payForm; T.pform = 'New payment';

  // ---- company details ------------------------------------------------
  R.company = () => { const c = db().co; return `<div class='box'><h3>Company details</h3><div class='pad'><div class='form'>
    <label>Company name<input id='co-name' value='${esc(c.name)}'></label><label>GSTIN<input id='co-gstin' value='${esc(c.gstin)}' maxlength='15'></label>
    <label>State<select id='co-state'>${E.STATES.filter(Boolean).map((s) => `<option${s === c.state ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
    <button class='p' data-co='1'>Save</button></div><p class='meta'>The company state decides whether GST on a document is CGST and SGST (same state) or IGST (other state).</p><div class='msg' id='msg'></div></div></div>`; };
  T.company = 'Company details';

  // ---- dashboard ------------------------------------------------------
  R.dashboard = () => {
    const D = db(), open = (t) => D.docs.filter((d) => d.t === t && d.status === 'Open'), sum = (a) => a.reduce((s, d) => s + d.total, 0);
    const inv = D.docs.filter((d) => d.t === 'AR' && d.status === 'Open'), overdue = inv.filter((d) => d.due < today());
    const stockVal = D.items.reduce((s, i) => s + i.stock * E.cst(i), 0), low = D.items.filter((i) => i.stock < i.min);
    return `<div class='cards'>
      <div class='card'><span>Open sales orders</span><b>${open('SO').length}</b><span>${money(sum(open('SO')))}</span></div>
      <div class='card'><span>Open purchase orders</span><b>${open('PO').length}</b><span>${money(sum(open('PO')))}</span></div>
      <div class='card'><span>Unpaid A/R invoices</span><b>${inv.length}</b><span>${money(inv.reduce((s, d) => s + balance(d), 0))}</span></div>
      <div class='card'><span>Overdue A/R invoices</span><b>${overdue.length}</b><span>${money(overdue.reduce((s, d) => s + balance(d), 0))}</span></div>
      <div class='card'><span>Stock value at cost</span><b>${money(stockVal)}</b></div></div>` +
      `<div class='box'><h3>Items below minimum stock</h3>` + table([{ h: 'Code' }, { h: 'Item' }, { h: 'In stock', r: 1 }, { h: 'Minimum', r: 1 }], low.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td class='r low'>${i.stock}</td><td class='r'>${i.min}</td></tr>`)) + '</div>' + E.glCards();
  };

  // ---- process flows and GL mapping ------------------------------------
  R.flows = () => {
    const D = db(), m = D.map, a = E.acn, n = (t) => D.docs.filter((d) => d.t === t && d.status !== 'Cancelled').length;
    const post = {
      QT: 'No posting', SO: 'No posting', PO: 'No posting',
      DL: `Debit ${a(m.cogs)}; credit ${a(m.inv)} at item cost. Stock leaves the warehouse.`,
      RT: `Debit ${a(m.inv)}; credit ${a(m.cogs)}. Stock returns to the warehouse.`,
      AR: `Debit ${a(m.ar)}; credit ${a(m.rev)} and output GST. A direct invoice also issues stock and posts cost of goods sold.`,
      CM: `Debit ${a(m.rev)} and output GST; credit ${a(m.ar)}. Optionally returns goods to stock.`,
      GP: `Debit ${a(m.inv)}; credit ${a(m.grir)}. Stock enters the warehouse.`,
      GT: `Debit ${a(m.grir)}; credit ${a(m.inv)}. Stock leaves the warehouse.`,
      AI: `Debit ${a(m.grir)} (or ${a(m.inv)} for a direct invoice) and input GST; credit ${a(m.ap)}.`,
      PC: `Debit ${a(m.ap)}; credit ${a(m.grir)} and input GST.`,
    };
    const rows = Object.keys(TY).map((k) => `<tr><td>${TY[k].s === 's' ? 'Sales' : 'Purchase'}</td><td>${esc(TY[k].n)}</td><td>${TY[k].base.length ? 'Copy from ' + TY[k].base.map((b) => TY[b].n.toLowerCase()).join(' or ') : 'Created directly'}</td><td class='r'>${n(k)}</td><td>${esc(post[k])}</td></tr>`);
    rows.push(`<tr><td>Sales</td><td>Incoming payment</td><td>Applied to A/R invoices and credit memos</td><td class='r'>${D.pays.filter((y) => y.t === 'IP' && y.status !== 'Cancelled').length}</td><td>Debit ${esc(a(m.cash))}; credit ${esc(a(m.ar))}</td></tr>`);
    rows.push(`<tr><td>Purchase</td><td>Outgoing payment</td><td>Applied to A/P invoices and credit memos</td><td class='r'>${D.pays.filter((y) => y.t === 'OP' && y.status !== 'Cancelled').length}</td><td>Debit ${esc(a(m.ap))}; credit ${esc(a(m.cash))}</td></tr>`);
    rows.push(`<tr><td>Inventory</td><td>Goods receipt, goods issue, transfer</td><td>Created directly</td><td class='r'>${D.invd.length}</td><td>See the Inventory screens. Accounts come from Account determination.</td></tr>`);
    return `<p class='meta'>Every document keeps its own number and posts its own journal entry. Accounts come from Account determination. A cancelled document reverses its entries and stock.</p><div class='box'><h3>Process flows and GL mapping</h3>` +
      table([{ h: 'Flow' }, { h: 'Document' }, { h: 'Created by' }, { h: 'Active', r: 1 }, { h: 'General ledger posting' }], rows) + '</div>';
  };

  // ---- document list and journal entry links -------------------------
  E.hooks.docRows.push((rows) => {
    const D = db();
    D.docs.forEach((d) => { const p = partner(d.pid), j = D.je.find((x) => x.doc === d.num); rows.push({ k: d.t, num: d.num, date: d.date, pn: p ? p.name : '', amt: d.total, dd: 'd:' + d.id, je: j }); });
    D.pays.forEach((y) => { const p = partner(y.pid), j = D.je.find((x) => x.doc === y.num); rows.push({ k: y.t, num: y.num, date: y.date, pn: p ? p.name : '', amt: y.amt, dd: 'y:' + y.id, je: j }); });
  });
  E.hooks.jDoc = (j) => {
    const D = db(), doc = (j.doc || '').replace(' (cancel)', '');
    const d = D.docs.find((x) => x.num === doc);
    if (d) { E.goDoc({ t: 'd', id: d.id }); return true; }
    const y = D.pays.find((x) => x.num === doc);
    if (y) { E.goDoc({ t: 'y', id: y.id }); return true; }
    return false;
  };

  // ---- events ---------------------------------------------------------
  const view = $('view');
  const go = (h) => { location.hash = h; };
  const show = (t) => { const e = $('msg'); if (e) e.textContent = t; };
  view.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const ds = b.dataset;
    if (ds.new) { startNew(ds.new); return; }
    if (ds.copyto) { const [k, id] = ds.copyto.split(':'); copyFrom(k, +id); return; }
    if (ds.fadd) { const l = blankLine(FM.t); if (l) FM.lines.push(l); E.route(); return; }
    if (ds.frm) { FM.lines.splice(+ds.frm, 1); E.route(); return; }
    if (ds.fcopy) { if (FM.pick) copyFrom(FM.t, +FM.pick); return; }
    if (ds.fcancel) { const back = FM && FM.t.toLowerCase(); FM = null; go(back || 'dashboard'); return; }
    if (ds.fsave) {
      const r = create(FM);
      if (typeof r === 'string') { show(r); return; }
      const t = FM.t; FM = null; E.save();
      FL = `${TY[t].n} ${r.num} created.`;
      E.goDoc({ t: 'd', id: r.id }); E.dcur.back = t.toLowerCase();
      return;
    }
    if (ds.cancelDoc) {
      const d = db().docs.find((x) => x.id === +ds.cancelDoc), r = cancel(d);
      if (r) { show(r); return; }
      FL = `${d.num} cancelled. Its journal entries and stock were reversed.`; E.save(); E.route(); return;
    }
    if (ds.print) { window.print(); return; }
    if (ds.newpay) {
      const sales = ds.newpay === 'IP', p = db().partners.find((x) => x.type === (sales ? 'Customer' : 'Supplier') && x.active !== false);
      PF = { t: ds.newpay, pid: p ? p.id : 0, date: today(), mode: 'Bank transfer', ref: '', alloc: {} }; go('pform'); return;
    }
    if (ds.pfill) {
      db().docs.forEach((d) => { if (d.pid === PF.pid && (PF.t === 'IP' ? d.t === 'AR' : d.t === 'AI') && d.status === 'Open' && balance(d) > 0.001) PF.alloc[d.id] = balance(d); });
      E.route(); return;
    }
    if (ds.psave) {
      const r = createPay(PF);
      if (typeof r === 'string') { show(r); return; }
      const t = PF.t; PF = null; E.save();
      FL = `${r.num} posted for ${money(r.amt)}.`;
      E.goDoc({ t: 'y', id: r.id }); E.dcur.back = t.toLowerCase();
      return;
    }
    if (ds.pcancel) { const t = PF && PF.t.toLowerCase(); PF = null; go(t || 'dashboard'); return; }
    if (ds.cancelPay) {
      const y = db().pays.find((x) => x.id === +ds.cancelPay), r = cancelPay(y);
      if (r) { show(r); return; }
      FL = `${y.num} cancelled. The journal entry was reversed.`; E.save(); E.route(); return;
    }
    if (ds.co) {
      const c = db().co, g = $('co-gstin').value.trim().toUpperCase();
      if (g && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) { show('GSTIN must be 15 characters, for example 33ABCDE1234F1Z5.'); return; }
      c.name = $('co-name').value.trim(); c.gstin = g; c.state = $('co-state').value; E.save(); show('Saved.');
    }
  });
  view.addEventListener('input', (e) => {
    const t = e.target, ds = t.dataset;
    if (FM && ds.fl) {
      const [i, f] = ds.fl.split(':');
      if (i === 'h') FM[f] = t.type === 'checkbox' ? t.checked : t.value; else FM.lines[+i][f] = t.type === 'number' ? toNum(t.value) : t.value;
      if (i !== 'h') refreshTotals();
    }
    if (PF && ds.pa) { PF.alloc[ds.pa] = +t.value || 0; const e2 = $('pay-total'); if (e2) e2.textContent = money(payTotal()); }
    if (PF && ds.pf) PF[ds.pf] = t.value;
  });
  view.addEventListener('change', (e) => {
    const t = e.target, ds = t.dataset;
    if (FM && ds.fc) {
      const [i, f] = ds.fc.split(':');
      if (i === 'h') {
        if (f === 'pid') { FM.pid = +t.value; FM.due = addDays(FM.date, termDays(partner(FM.pid))); FM.pick = ''; Object.assign(FM, headFrom(partner(FM.pid))); FM.lines.forEach((l) => { l.bl = null; }); } else FM[f] = t.value;
      } else {
        const l = FM.lines[+i];
        if (f === 'iid') { const it = item(+t.value); l.iid = it.id; l.wh = it.dwh || 1; l.price = sideOf(FM.t) === 's' ? it.price : E.cst(it); l.rate = itemRate(it); l.desc = it.name; l.uom = it.uom || ''; } else l[f] = +t.value;
      }
      E.route();
    }
    if (PF && ds.pc === 'pid') { PF.pid = +t.value; PF.alloc = {}; E.route(); }
    if (PF && ds.pf) PF[ds.pf] = t.value;
  });

  E.docs = { TY, create, cancel, createPay, cancelPay, calc, balance, startNew, copyFrom };
})();
