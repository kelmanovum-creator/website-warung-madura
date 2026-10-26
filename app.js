(function () {
  'use strict';

  var STORAGE_KEYS = {
    cart: 'umkm_cart_v1',
    session: 'umkm_session_v1',
    ui: 'umkm_ui_v1',
    notif: 'umkm_notif_read_v1',
    settings: 'umkm_settings_v1'
  };

  var API_FITUR = 'https://script.google.com/macros/s/AKfycby9vdFhaJcib69-2jR5egzK_oknI5k-7kNFVQ4XuJ68lrrYLXphuWHGTECG5_Ng7zT1/exec';
  var API_LOGIN = 'https://script.google.com/macros/s/AKfycbzzcZ5kfaLyKqdtc1Fgbq3lJO_rSvHtogrSrJWLIQdC-b-92JpLvt7C7FluXet3tCLA/exec';

  var PAGES = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'kasir', label: 'Kasir' },
    { id: 'stok', label: 'Stok' },
    { id: 'expired', label: 'Expired' },
    { id: 'riwayat', label: 'Riwayat' },
    { id: 'laporan', label: 'Laporan' },
    { id: 'pengaturan', label: 'Pengaturan' }
  ];

  var PAGE_SUB = {
    dashboard: 'Ringkasan omzet, stok, dan kedaluwarsa',
    kasir: 'Katalog & Kasir FIFO',
    stok: 'Kelola produk & batch stok',
    expired: 'Monitoring H-7 kedaluwarsa',
    riwayat: 'Riwayat transaksi kasir',
    laporan: 'Riwayat transaksi otomatis',
    pengaturan: 'Toko, tampilan, pajak, dan backup data'
  };

  var UI_BRANDS = [
    { id: 'hijau', hex: '#005A36' },
    { id: 'teal', hex: '#0f766e' },
    { id: 'biru', hex: '#1d4ed8' },
    { id: 'ungu', hex: '#6d28d9' },
    { id: 'merah', hex: '#b91c1c' }
  ];
  var UI_BUTTONS = [
    { id: 'emerald', hex: '#059669' },
    { id: 'teal', hex: '#0d9488' },
    { id: 'biru', hex: '#2563eb' },
    { id: 'oranye', hex: '#ea580c' },
    { id: 'merah', hex: '#dc2626' }
  ];

  var PAY_METHODS = [
    { id: 'tunai', label: 'Tunai' },
    { id: 'qris', label: 'QRIS' },
    { id: 'transfer', label: 'Transfer' },
    { id: 'debit', label: 'Debit' }
  ];

  var state = {
    page: 'kasir',
    batches: [],
    cart: [],
    transactions: [],
    products: [],
    settings: { storeName: 'UMKM Kasir', cashierName: 'Kasir', taxPercent: 0 },
    kasirCat: 'Semua',
    payMethod: 'tunai',
    lastTrx: null,
    expiredFilter: 'semua',
    laporanPeriod: '7',
    laporanFrom: '',
    laporanTo: '',
    riwayatPeriod: 'all',
    riwayatFrom: '',
    riwayatTo: '',
    user: null,
    busy: false,
    ui: { theme: 'light', brand: 'hijau', button: 'emerald', text: 'sedang', brandHex: '#005A36', buttonHex: '#059669' },
    notifReadIds: []
  };

  function currentOwner() {
    return String((state.user && state.user.username) || '').trim().toLowerCase();
  }

  function ownerPrefix() {
    var slug = currentOwner().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'user';
    return 'u_' + slug + '_';
  }

  function scopedKey(base) {
    return base + ':' + (currentOwner() || 'guest');
  }

  function recordOwner(rec) {
    if (!rec || typeof rec !== 'object') return '';
    return String(rec.owner || rec.user || rec.username || rec.owner_id || '').trim().toLowerCase();
  }

  function belongsToUser(rec, extraId) {
    var me = currentOwner();
    if (!me || !rec) return false;
    var o = recordOwner(rec);
    if (o) return o === me;
    var prefix = ownerPrefix();
    var ids = [rec.id, rec.product_id, rec.productId, rec.invoice_no, rec.sku, extraId];
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i] || '');
      if (id.indexOf(prefix) === 0) return true;
    }
    return false;
  }

  var remoteSnapshot = { products: [], batches: [], transactions: [], settings: {} };

  function captureRemote(data) {
    remoteSnapshot = {
      products: Array.isArray(data.products) ? data.products.slice() : [],
      batches: Array.isArray(data.batches) ? data.batches.slice() : [],
      transactions: Array.isArray(data.transactions) ? data.transactions.slice() : [],
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {}
    };
  }

  /* Muat preferensi lokal per perangkat (keranjang dan tampilan) */
  function loadLocalPrefs() {
    try { state.cart = JSON.parse(localStorage.getItem(scopedKey(STORAGE_KEYS.cart)) || '[]'); } catch (e) { state.cart = []; }
    if (!Array.isArray(state.cart)) state.cart = [];
    try {
      var ui = JSON.parse(localStorage.getItem(STORAGE_KEYS.ui) || 'null');
      if (ui && typeof ui === 'object') {
        state.ui.theme = ui.theme === 'dark' ? 'dark' : 'light';
        state.ui.brand = ui.brand || 'hijau';
        state.ui.button = ui.button || 'emerald';
        state.ui.text = ui.text === 'kecil' || ui.text === 'besar' ? ui.text : 'sedang';
        state.ui.brandHex = normalizeHex(ui.brandHex) || hexFromBrand(state.ui.brand);
        state.ui.buttonHex = normalizeHex(ui.buttonHex) || hexFromButton(state.ui.button);
      }
    } catch (e) {}
    try {
      var ids = JSON.parse(localStorage.getItem(scopedKey(STORAGE_KEYS.notif)) || '[]');
      state.notifReadIds = Array.isArray(ids) ? ids.map(String) : [];
    } catch (e) { state.notifReadIds = []; }
  }

  function saveNotifRead() {
    try { localStorage.setItem(scopedKey(STORAGE_KEYS.notif), JSON.stringify(state.notifReadIds)); } catch (e) {}
  }

  function saveLocalSettings() {
    try {
      var all = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
      if (currentOwner()) all[currentOwner()] = state.settings;
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(all));
    } catch (e) {}
  }

  function saveUiPrefs() {
    try { localStorage.setItem(STORAGE_KEYS.ui, JSON.stringify(state.ui)); } catch (e) {}
  }

  function normalizeHex(value) {
    if (!value || typeof value !== 'string') return '';
    var hex = value.trim().toUpperCase();
    if (hex.charAt(0) !== '#') hex = '#' + hex;
    if (/^#[0-9A-F]{6}$/.test(hex)) return hex;
    if (/^#[0-9A-F]{3}$/.test(hex)) {
      return '#' + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2) + hex.charAt(3) + hex.charAt(3);
    }
    return '';
  }

  function hexFromBrand(id) {
    var found = UI_BRANDS.filter(function (c) { return c.id === id; })[0];
    return found ? found.hex : '#005A36';
  }

  function hexFromButton(id) {
    var found = UI_BUTTONS.filter(function (c) { return c.id === id; })[0];
    return found ? found.hex : '#059669';
  }

  /* Simpan keranjang per akun di perangkat ini */
  function saveCart() {
    localStorage.setItem(scopedKey(STORAGE_KEYS.cart), JSON.stringify(state.cart));
  }

  function parseSheetsBody(res, text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Server tidak merespons');
    if (trimmed.charAt(0) === '<' || trimmed.toLowerCase().indexOf('<!doctype') === 0) {
      throw new Error('Server akun sedang sibuk. Coba beberapa detik lagi.');
    }
    var body = {};
    try { body = JSON.parse(trimmed); } catch (e) { throw new Error('Respons database tidak valid'); }
    if (!res.ok) throw new Error(body.error || body.message || ('Permintaan gagal (' + res.status + ')'));
    return body;
  }

  /* Panggil Apps Script (Google Sheets) dengan JSON plain text agar tidak kena preflight CORS */
  function sheetsPost(url, payload) {
    return fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload || {})
    }).then(function (res) {
      return res.text().then(function (text) { return parseSheetsBody(res, text); });
    });
  }

  function sheetsGet(url, params) {
    var qs = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return fetch(url + (qs.length ? '?' + qs.join('&') : ''), { redirect: 'follow' }).then(function (res) {
      return res.text().then(function (text) { return parseSheetsBody(res, text); });
    });
  }

  function authOk(body) {
    if (!body || typeof body !== 'object') return false;
    if (body.ok === false || body.status === 'error' || body.success === false) return false;
    var status = String(body.status || body.result || '').toLowerCase();
    if (status === 'success' || status === 'ok' || status === 'registered' || status === 'created') return true;
    if (body.ok === true || body.success === true) return true;
    var msg = String(body.message || '').toLowerCase();
    if (msg.indexOf('berhasil') !== -1 || msg.indexOf('success') !== -1) return true;
    return false;
  }

  function assertOk(body) {
    if (body && (body.ok === false || body.status === 'error')) {
      throw new Error(body.error || body.message || 'Permintaan gagal');
    }
    return body;
  }

  function mapProduct(p) {
    return {
      id: String(p.id || ''),
      sku: p.sku || '',
      name: p.name || '',
      category: p.category || 'Umum',
      sellPrice: Number(p.price != null ? p.price : p.sell_price) || 0,
      buyPrice: Number(p.buy_price) || 0,
      minStock: Number(p.min_stock != null ? p.min_stock : 5) || 5,
      unit: p.unit || 'pcs',
      location: p.location || '',
      stock: Number(p.stock) || 0
    };
  }

  function mapBatch(b, products) {
    var list = products || state.products;
    var product = list.find(function (p) { return String(p.id) === String(b.product_id); });
    return {
      id: String(b.id || ''),
      productId: String(b.product_id || ''),
      name: product ? product.name : (b.name || b.product_id || ''),
      stock: Number(b.qty != null ? b.qty : b.stock) || 0,
      price: product ? product.sellPrice : (Number(b.price) || 0),
      location: b.location || (product ? product.location : '') || '-',
      expiredDate: String(b.expired_date || b.expiredDate || '').slice(0, 10),
      createdAt: b.created_at || b.createdAt || ''
    };
  }

  function trxTime(t) {
    var d = Date.parse(t && t.at ? t.at : '');
    return isNaN(d) ? 0 : d;
  }

  function sortedTransactions() {
    return (state.transactions || []).slice().sort(function (a, b) {
      return trxTime(b) - trxTime(a);
    });
  }

  function upsertTransaction(trx) {
    if (!trx || !trx.id) return;
    var next = [];
    var seen = false;
    state.transactions.forEach(function (t) {
      if (String(t.id) === String(trx.id)) {
        next.push(trx);
        seen = true;
      } else {
        next.push(t);
      }
    });
    if (!seen) next.push(trx);
    state.transactions = next;
    state.transactions = sortedTransactions();
  }

  function mapTransaction(t) {
    var method = String(t.payment_method || t.payMethod || t.pay_method || 'tunai').toLowerCase();
    if (method === 'cash') method = 'tunai';
    var at = t.created_at || t.at || '';
    if (t.date && String(t.date).length >= 10) {
      var timePart = t.time && String(t.time).indexOf('T') === -1 ? String(t.time) : '00:00:00';
      if (String(t.time || '').indexOf('T') !== -1) timePart = new Date(t.time).toTimeString().slice(0, 8);
      at = String(t.date).slice(0, 10) + 'T' + timePart;
    }
    return {
      id: String(t.invoice_no || t.id || ''),
      at: at,
      cashier: t.cashier || (state.user && state.user.username) || state.settings.cashierName || 'Kasir',
      payMethod: method,
      paid: Number(t.paid) || 0,
      change: Number(t.change_amount != null ? t.change_amount : t.change) || 0,
      discount: Number(t.discount) || 0,
      tax: Number(t.tax) || 0,
      subtotal: Number(t.subtotal) || 0,
      total: Number(t.total) || 0,
      lines: Array.isArray(t.lines) ? t.lines : (Array.isArray(t.items) ? t.items : [])
    };
  }

  function applyRemoteState(data) {
    captureRemote(data);
    var mineProducts = (remoteSnapshot.products || []).filter(function (p) { return belongsToUser(p); });
    var mineBatches = (remoteSnapshot.batches || []).filter(function (b) { return belongsToUser(b); });
    var mineTrx = (remoteSnapshot.transactions || []).filter(function (t) { return belongsToUser(t, t.invoice_no || t.id); });
    state.products = mineProducts.map(mapProduct);
    state.batches = mineBatches.map(function (b) { return mapBatch(b, state.products); });
    state.transactions = mineTrx.map(mapTransaction);
    state.transactions = sortedTransactions();
    var raw = {};
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
      if (currentOwner() && saved[currentOwner()]) raw = saved[currentOwner()];
    } catch (e) {}
    if (!raw.storeName && !raw.store_name) {
      var sheetSettings = remoteSnapshot.settings || {};
      if (recordOwner(sheetSettings) === currentOwner()) raw = sheetSettings;
    }
    state.settings = {
      storeName: raw.storeName || raw.store_name || 'UMKM Kasir',
      cashierName: raw.cashierName || raw.cashier_name || (state.user && state.user.username) || 'Kasir',
      taxPercent: Number(raw.taxPercent != null ? raw.taxPercent : raw.tax_percent) || 0,
      address: raw.address || '',
      phone: raw.phone || ''
    };
    pruneCart();
    renderCurrentPage();
  }

  /* Ambil seluruh data bisnis dari Google Sheets lalu render ulang halaman aktif */
  function syncState() {
    return sheetsGet(API_FITUR, { action: 'state' }).then(function (data) {
      assertOk(data);
      applyRemoteState(data);
    });
  }

  /* Sesuaikan keranjang dengan stok terbaru dari server */
  function pruneCart() {
    var next = [];
    state.cart.forEach(function (item) {
      var max = availableStock(item.name);
      if (max <= 0) return;
      next.push({
        name: item.name,
        qty: Math.min(item.qty, max),
        price: item.price
      });
    });
    var changed = next.length !== state.cart.length || next.some(function (item, i) {
      return item.qty !== state.cart[i].qty;
    });
    state.cart = next;
    if (changed) saveCart();
  }

  /* Render ulang seluruh area yang bergantung pada data server */
  function renderCurrentPage() {
    renderKasir();
    renderCart();
    updateNotifBadge();
    if (state.page === 'dashboard') renderDashboard();
    if (state.page === 'stok') renderStok();
    if (state.page === 'expired') renderExpired();
    if (state.page === 'riwayat') renderRiwayat();
    if (state.page === 'laporan') renderLaporan();
    if (state.page === 'pengaturan') renderSettingsForm();
  }

  /* Format angka ke Rupiah tanpa desimal */
  function formatRupiah(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  }

  /* Escape teks HTML untuk mencegah XSS dari nama barang */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Escape atribut HTML pada data-name tombol +/- */
  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  /* Hitung selisih hari dari hari ini ke tanggal expired (negatif = sudah lewat) */
  function daysUntil(dateStr) {
    if (!dateStr) return 9999;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var target = new Date(dateStr + 'T00:00:00');
    return Math.ceil((target - today) / 86400000);
  }

  /* Status visual batch berdasarkan sisa hari kedaluwarsa */
  function expiryStatus(dateStr) {
    var d = daysUntil(dateStr);
    if (d < 0) return { label: 'Kedaluwarsa', cls: 'bg-rose-100 text-rose-700' };
    if (d === 0) return { label: 'Hari ini', cls: 'bg-rose-100 text-rose-700' };
    if (d <= 3) return { label: 'H-' + d, cls: 'bg-orange-100 text-orange-700' };
    if (d <= 7) return { label: 'H-' + d, cls: 'bg-amber-100 text-amber-700' };
    return { label: d + ' hari', cls: 'bg-emerald-100 text-emerald-700' };
  }

  function productKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function findProductByName(name) {
    var key = productKey(name);
    return state.products.find(function (p) { return productKey(p.name) === key; }) || null;
  }

  function categoryOf(name) {
    var p = findProductByName(name);
    return (p && p.category) ? p.category : 'Umum';
  }

  /* Agregasi stok katalog berdasarkan nama produk (untuk kartu kasir) */
  function catalogProducts(keyword, category) {
    var map = {};
    state.batches.forEach(function (b) {
      if (Number(b.stock) <= 0) return;
      var key = productKey(b.name);
      if (!map[key]) {
        map[key] = {
          name: b.name,
          stock: 0,
          price: Number(b.price) || 0,
          location: b.location || '-',
          nearestExp: b.expiredDate,
          category: categoryOf(b.name)
        };
      }
      map[key].stock += Number(b.stock) || 0;
      if (b.expiredDate && (!map[key].nearestExp || b.expiredDate < map[key].nearestExp)) {
        map[key].nearestExp = b.expiredDate;
      }
      if (b.price) map[key].price = Number(b.price);
    });
    state.products.forEach(function (p) {
      var key = productKey(p.name);
      if (!map[key]) return;
      if (p.sellPrice != null) map[key].price = Number(p.sellPrice);
      if (p.category) map[key].category = p.category;
    });
    var list = Object.values(map);
    var q = (keyword || '').trim().toLowerCase();
    if (q) {
      list = list.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });
    }
    if (category && category !== 'Semua') {
      list = list.filter(function (p) { return p.category === category; });
    }
    return list;
  }

  function kasirCategories() {
    var set = {};
    catalogProducts('', 'Semua').forEach(function (p) { set[p.category] = true; });
    return ['Semua'].concat(Object.keys(set).sort());
  }

  /* Ambil batch FEFO: expired terdekat, jika sama pakai tanggal masuk paling lama */
  function fifoBatches(productName) {
    var key = productKey(productName);
    return state.batches
      .filter(function (b) { return productKey(b.name) === key && Number(b.stock) > 0; })
      .sort(function (a, b) {
        var exp = String(a.expiredDate || '').localeCompare(String(b.expiredDate || ''));
        if (exp !== 0) return exp;
        return String(a.createdAt || a.id || '').localeCompare(String(b.createdAt || b.id || ''));
      });
  }

  /* Total stok tersedia untuk satu nama produk */
  function availableStock(productName) {
    return fifoBatches(productName).reduce(function (sum, b) { return sum + Number(b.stock); }, 0);
  }

  /* Tambah atau update item keranjang, dibatasi stok FIFO */
  function addToCart(productName, delta) {
    var products = catalogProducts();
    var product = products.find(function (p) { return productKey(p.name) === productKey(productName); });
    if (!product) return showToast('Produk tidak tersedia');
    var item = state.cart.find(function (c) { return productKey(c.name) === productKey(productName); });
    if (!item) {
      if (delta < 0) return;
      item = { name: product.name, qty: 0, price: product.price };
      state.cart.push(item);
    }
    var next = item.qty + delta;
    var max = availableStock(productName);
    if (next <= 0) {
      state.cart = state.cart.filter(function (c) { return c !== item; });
    } else if (next > max) {
      showToast('Stok tidak cukup. Maks ' + max);
      item.qty = max;
    } else {
      item.qty = next;
      item.price = product.price;
    }
    saveCart();
    renderKasir();
    renderCart();
  }

  function cartSubtotal() {
    return state.cart.reduce(function (s, c) { return s + c.qty * c.price; }, 0);
  }

  function cartDiscount() {
    var el = document.getElementById('cart-discount');
    var n = el ? Number(el.value) || 0 : 0;
    if (n < 0) n = 0;
    var sub = cartSubtotal();
    if (n > sub) n = sub;
    return n;
  }

  function cartTax() {
    var after = cartSubtotal() - cartDiscount();
    var pct = Number(state.settings.taxPercent) || 0;
    return Math.round(after * pct / 100);
  }

  function cartTotal() {
    return cartSubtotal() - cartDiscount() + cartTax();
  }

  function cartPaid() {
    var el = document.getElementById('cart-paid');
    return el ? Number(el.value) || 0 : 0;
  }

  function cartChange() {
    return cartPaid() - cartTotal();
  }

  /* Cari ID produk dari nama di keranjang */
  function productIdByName(name) {
    var found = findProductByName(name);
    return found ? found.id : '';
  }

  function deductCartFromBatches() {
    state.cart.forEach(function (c) {
      var left = Number(c.qty) || 0;
      fifoBatches(c.name).forEach(function (b) {
        if (left <= 0) return;
        var take = Math.min(Number(b.stock) || 0, left);
        b.stock -= take;
        left -= take;
      });
    });
  }

  /* Checkout: kurangi stok akun ini lalu gabung ke Sheets tanpa menimpa user lain */
  function checkout() {
    if (!state.cart.length) return showToast('Keranjang kosong');
    var total = cartTotal();
    if (state.payMethod === 'tunai' && cartPaid() < total) {
      return showToast('Uang diterima kurang');
    }
    var btn = document.getElementById('btn-checkout');
    if (btn) btn.disabled = true;
    deductCartFromBatches();
    var trx = {
      id: nextInvoiceId(),
      at: new Date().toISOString(),
      cashier: (state.user && state.user.username) || state.settings.cashierName || 'Kasir',
      payMethod: state.payMethod,
      paid: cartPaid(),
      change: cartChange(),
      discount: cartDiscount(),
      tax: cartTax(),
      subtotal: cartSubtotal(),
      total: total,
      lines: state.cart.map(function (c) {
        return { name: c.name, qty: c.qty, price: c.price, product_id: productIdByName(c.name) };
      })
    };
    upsertTransaction(trx);
    state.cart = [];
    state.lastTrx = trx;
    saveCart();
    renderCurrentPage();
    var discEl = document.getElementById('cart-discount');
    var paidEl = document.getElementById('cart-paid');
    if (discEl) discEl.value = '0';
    if (paidEl) paidEl.value = '0';
    closeCart();
    persistMine()
      .then(function () {
        showSuccess(trx);
        return syncState();
      })
      .catch(function (err) {
        showToast(err.message || 'Checkout gagal');
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  function showSuccess(trx) {
    var overlay = document.getElementById('success-overlay');
    var changeEl = document.getElementById('success-change');
    var idEl = document.getElementById('success-id');
    if (changeEl) {
      changeEl.textContent = trx.payMethod === 'tunai'
        ? 'Kembalian ' + formatRupiah(trx.change)
        : 'Bayar via ' + trx.payMethod.toUpperCase();
    }
    if (idEl) idEl.textContent = trx.id;
    if (overlay) overlay.classList.remove('hidden');
    showToast('Transaksi Berhasil');
  }

  function hideSuccess() {
    var overlay = document.getElementById('success-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function printReceipt() {
    var trx = state.lastTrx;
    if (!trx) return showToast('Belum ada transaksi');
    var win = window.open('', '_blank', 'width=360,height=640');
    if (!win) return showToast('Izinkan pop-up untuk cetak struk');
    var rows = trx.lines.map(function (l) {
      return '<tr><td>' + escapeHtml(l.name) + ' x' + l.qty + '</td><td style="text-align:right">' + formatRupiah(l.qty * l.price) + '</td></tr>';
    }).join('');
    win.document.write(
      '<html><head><title>Struk ' + trx.id + '</title></head><body style="font-family:monospace;padding:16px">' +
      '<h3 style="text-align:center;margin:0">' + escapeHtml(state.settings.storeName || 'UMKM Kasir') + '</h3>' +
      '<p style="text-align:center;font-size:12px">FIFO &amp; Expired Control</p>' +
      '<p>' + trx.id + '<br>' + new Date(trx.at).toLocaleString('id-ID') + '<br>Kasir: ' + escapeHtml(trx.cashier) + '</p>' +
      '<table style="width:100%;font-size:13px">' + rows + '</table>' +
      '<hr><p>Subtotal: ' + formatRupiah(trx.subtotal) +
      '<br>Diskon: ' + formatRupiah(trx.discount) +
      '<br>Pajak: ' + formatRupiah(trx.tax) +
      '<br><b>Total: ' + formatRupiah(trx.total) + '</b>' +
      '<br>' + trx.payMethod.toUpperCase() + ': ' + formatRupiah(trx.paid) +
      '<br>Kembali: ' + formatRupiah(trx.change) + '</p>' +
      '<p style="text-align:center">Terima kasih</p></body></html>'
    );
    win.document.close();
    win.focus();
    win.print();
  }

  /* Ganti halaman SPA dan update navigasi bawah */
  function setPage(page) {
    state.page = page;
    PAGES.forEach(function (p) {
      var el = document.getElementById('page-' + p.id);
      if (el) el.classList.toggle('hidden', p.id !== page);
    });
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-page') === page;
      if (btn.closest('#side-nav')) {
        btn.classList.toggle('bg-emerald-100', active);
        btn.classList.toggle('text-emerald-800', active);
        btn.classList.toggle('font-semibold', active);
        btn.classList.toggle('text-emerald-100', !active);
      } else {
        btn.classList.toggle('text-emerald-700', active);
        btn.classList.toggle('text-slate-400', !active);
        if (active && btn.closest('#bottom-nav')) {
          btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
      }
    });
    var sub = document.getElementById('header-sub');
    if (sub) sub.textContent = PAGE_SUB[page] || '';
    if (page === 'kasir') {
      renderKasir();
      renderCart();
    }
    if (page === 'dashboard') {
      renderDashboard();
    }
    if (page === 'stok') {
      renderStok();
    }
    if (page === 'expired') {
      renderExpired();
    }
    if (page === 'riwayat') {
      renderRiwayat();
    }
    if (page === 'laporan') {
      renderLaporan();
    }
    if (page === 'pengaturan') {
      renderSettingsForm();
    }
    paintUiColors(brandHex(), buttonHex());
  }

  function renderNav() {
    var side = document.getElementById('side-nav');
    var bottom = document.getElementById('bottom-nav');
    if (side) {
      side.innerHTML = PAGES.map(function (p) {
        return '<button data-page="' + p.id + '" class="nav-btn w-full text-left px-3 py-2 rounded-xl text-emerald-100" type="button">' + p.label + '</button>';
      }).join('');
    }
    if (bottom) {
      bottom.className = 'bg-white rounded-2xl card-shadow border border-emerald-100 flex gap-1 overflow-x-auto no-scrollbar py-1 px-1 snap-x snap-mandatory';
      bottom.innerHTML = PAGES.map(function (p) {
        return '<button data-page="' + p.id + '" class="nav-btn shrink-0 min-w-[4.75rem] px-3 text-[11px] font-semibold text-slate-400 py-2 snap-start" type="button">' + p.label + '</button>';
      }).join('');
    }
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setPage(btn.getAttribute('data-page')); });
    });
  }

  /* Render kartu produk kasir 2 kolom untuk layar max 440px */
  function renderKasir() {
    var searchEl = document.getElementById('search-kasir');
    var q = searchEl ? searchEl.value : '';
    var products = catalogProducts(q, state.kasirCat);
    var wrap = document.getElementById('kasir-list');
    var empty = document.getElementById('kasir-empty');
    var cats = document.getElementById('kasir-cats');
    if (!wrap) return;
    if (empty) empty.classList.toggle('hidden', products.length > 0);
    if (cats) {
      cats.innerHTML = kasirCategories().map(function (c) {
        var active = c === state.kasirCat;
        return '<button type="button" data-cat="' + escapeAttr(c) + '" class="shrink-0 h-8 px-3 rounded-full text-xs font-semibold ' +
          (active ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-emerald-100') + '">' + escapeHtml(c) + '</button>';
      }).join('');
    }
    wrap.innerHTML = products.map(function (p) {
      var st = expiryStatus(p.nearestExp);
      var inCart = state.cart.find(function (c) { return productKey(c.name) === productKey(p.name); });
      var qty = inCart ? inCart.qty : 0;
      return (
        '<article class="bg-white rounded-2xl p-3 card-shadow flex flex-col">' +
          '<div class="flex justify-between items-start gap-1">' +
            '<h3 class="font-bold text-sm leading-snug">' + escapeHtml(p.name) + '</h3>' +
            '<span class="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ' + st.cls + '">' + st.label + '</span>' +
          '</div>' +
          '<p class="text-[11px] text-slate-400 mt-0.5">' + escapeHtml(p.category) + '</p>' +
          '<p class="text-emerald-700 font-semibold text-sm mt-1">' + formatRupiah(p.price) + '</p>' +
          '<p class="text-[11px] text-slate-500">Stok ' + p.stock + ' · Rak ' + escapeHtml(p.location) + '</p>' +
          '<div class="mt-auto pt-2 flex items-center justify-between">' +
            '<button type="button" class="w-8 h-8 rounded-lg bg-slate-100 font-bold" data-act="minus" data-name="' + escapeAttr(p.name) + '">-</button>' +
            '<span class="text-sm font-semibold">' + qty + '</span>' +
            '<button type="button" class="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold" data-act="plus" data-name="' + escapeAttr(p.name) + '">+</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  /* Render halaman Stok: ringkasan dan daftar batch per produk */
  function renderStok() {
    var wrap = document.getElementById('stok-list');
    if (!wrap) return;
    var searchEl = document.getElementById('search-stok');
    var q = searchEl ? searchEl.value.trim().toLowerCase() : '';

    var groups = {};
    state.batches.forEach(function (b) {
      var key = productKey(b.name);
      if (!groups[key]) {
        groups[key] = { name: b.name, category: categoryOf(b.name), stock: 0, value: 0, batches: [] };
      }
      groups[key].stock += Number(b.stock) || 0;
      groups[key].value += (Number(b.stock) || 0) * (Number(b.price) || 0);
      groups[key].batches.push(b);
    });
    var allGroups = Object.keys(groups).map(function (k) { return groups[k]; });
    var totalStock = 0;
    state.batches.forEach(function (b) { totalStock += Number(b.stock) || 0; });

    var summary =
      '<div class="grid grid-cols-3 gap-2 mb-3">' +
        '<div class="bg-white rounded-2xl p-3 card-shadow">' +
          '<p class="text-[11px] text-slate-500">Jenis Produk</p>' +
          '<p class="text-lg font-bold text-emerald-700">' + allGroups.length + '</p>' +
        '</div>' +
        '<div class="bg-white rounded-2xl p-3 card-shadow">' +
          '<p class="text-[11px] text-slate-500">Total Batch</p>' +
          '<p class="text-lg font-bold text-emerald-700">' + state.batches.length + '</p>' +
        '</div>' +
        '<div class="bg-white rounded-2xl p-3 card-shadow">' +
          '<p class="text-[11px] text-slate-500">Total Stok</p>' +
          '<p class="text-lg font-bold text-emerald-700">' + totalStock + '</p>' +
        '</div>' +
      '</div>';

    if (!state.batches.length) {
      wrap.innerHTML = '<p class="text-sm text-slate-400 py-10 text-center">Belum ada batch stok. Tambahkan melalui form di atas.</p>';
      return;
    }

    var list = allGroups;
    if (q) {
      list = list.filter(function (g) { return g.name.toLowerCase().indexOf(q) !== -1; });
    }
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });

    if (!list.length) {
      wrap.innerHTML = summary + '<p class="text-sm text-slate-400 py-10 text-center">Tidak ada produk yang cocok dengan pencarian.</p>';
      return;
    }

    var cards = list.map(function (g) {
      var prod = findProductByName(g.name);
      var min = prod && prod.minStock != null ? Number(prod.minStock) : 5;
      var low = g.stock <= min;
      var batches = g.batches.slice().sort(function (a, b) {
        return String(a.expiredDate || '').localeCompare(String(b.expiredDate || ''));
      });
      var rows = batches.map(function (b) {
        var st = expiryStatus(b.expiredDate);
        return '<div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-2 py-1.5">' +
          '<div class="min-w-0">' +
            '<p class="text-xs font-semibold">' + escapeHtml(b.id) + '</p>' +
            '<p class="text-[10px] text-slate-400">Rak ' + escapeHtml(b.location || '-') + ' · ' + formatRupiah(b.price) + '</p>' +
          '</div>' +
          '<div class="flex items-center gap-2 shrink-0">' +
            '<span class="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ' + st.cls + '">' + st.label + '</span>' +
            '<span class="text-xs font-semibold w-10 text-right">' + (Number(b.stock) || 0) + '</span>' +
            '<button type="button" class="h-7 px-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold" data-edit-batch="' + escapeAttr(b.id) + '" aria-label="Edit batch">Edit</button>' +
          '</div>' +
        '</div>';
      }).join('');
      return '<article class="bg-white rounded-2xl p-4 card-shadow">' +
        '<div class="flex items-start justify-between gap-2 mb-2">' +
          '<div class="min-w-0">' +
            '<h3 class="font-bold text-sm truncate">' + escapeHtml(g.name) + '</h3>' +
            '<p class="text-[11px] text-slate-400">' + escapeHtml(g.category) + ' · min ' + min + ' ' + (low ? '· <span class="text-rose-600 font-semibold">menipis</span>' : '') + '</p>' +
          '</div>' +
          '<div class="text-right shrink-0">' +
            '<p class="text-sm font-bold ' + (low ? 'text-rose-600' : 'text-emerald-700') + '">' + g.stock + ' pcs</p>' +
            '<p class="text-[10px] text-slate-400">' + formatRupiah(g.value) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="space-y-2">' + rows + '</div>' +
      '</article>';
    }).join('');

    wrap.innerHTML = summary + '<div class="space-y-3">' + cards + '</div>';
  }

  function closeModal() {
    var overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function openModal(title, html) {
    var overlay = document.getElementById('modal-overlay');
    var titleEl = document.getElementById('modal-title');
    var body = document.getElementById('modal-body');
    if (titleEl) titleEl.textContent = title;
    if (body) body.innerHTML = html;
    if (overlay) overlay.classList.remove('hidden');
    paintUiColors(brandHex(), buttonHex());
  }

  function openEditBatch(batchId) {
    var batch = state.batches.filter(function (b) { return String(b.id) === String(batchId); })[0];
    if (!batch) return showToast('Batch tidak ditemukan');
    openModal('Edit Stok',
      '<form id="form-edit-batch" data-batch-id="' + escapeAttr(batch.id) + '" class="space-y-3">' +
        '<p class="text-sm font-semibold">' + escapeHtml(batch.name) + '</p>' +
        '<p class="text-[11px] text-slate-400">Batch ' + escapeHtml(batch.id) + '</p>' +
        '<label class="block text-xs text-slate-500">Stok</label>' +
        '<div class="flex items-center gap-2">' +
          '<button type="button" id="edit-stock-minus" class="w-11 h-11 rounded-xl border border-slate-200 text-lg font-bold">-</button>' +
          '<input id="edit-stock" name="stock" type="number" min="0" value="' + (Number(batch.stock) || 0) + '" class="flex-1 h-11 px-3 rounded-xl border border-slate-200 text-center text-sm font-semibold" />' +
          '<button type="button" id="edit-stock-plus" class="w-11 h-11 rounded-xl bg-emerald-600 text-white text-lg font-bold">+</button>' +
        '</div>' +
        '<label class="block text-xs text-slate-500">Lokasi rak</label>' +
        '<input name="location" required value="' + escapeAttr(batch.location === '-' ? '' : (batch.location || '')) + '" placeholder="Contoh: A-12" class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm" />' +
        '<label class="block text-xs text-slate-500">Tanggal expired</label>' +
        '<input name="expiredDate" type="date" required value="' + escapeAttr(batch.expiredDate || '') + '" class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm" />' +
        '<button type="submit" class="w-full h-11 rounded-xl bg-emerald-600 text-white font-semibold">Simpan Perubahan</button>' +
      '</form>'
    );
    var stockInput = document.getElementById('edit-stock');
    var minus = document.getElementById('edit-stock-minus');
    var plus = document.getElementById('edit-stock-plus');
    function bump(delta) {
      if (!stockInput) return;
      var n = parseInt(stockInput.value, 10);
      if (isNaN(n)) n = 0;
      stockInput.value = Math.max(0, n + delta);
    }
    if (minus) minus.addEventListener('click', function () { bump(-1); });
    if (plus) plus.addEventListener('click', function () { bump(1); });
    var form = document.getElementById('form-edit-batch');
    if (form) form.addEventListener('submit', handleSaveEditBatch);
  }

  function handleSaveEditBatch(event) {
    event.preventDefault();
    var form = event.target;
    var batchId = form.getAttribute('data-batch-id');
    var stock = parseInt(formField(form, 'stock').value, 10);
    var location = formField(form, 'location').value.trim();
    var expiredDate = formField(form, 'expiredDate').value;
    if (!batchId || !location || !expiredDate || isNaN(stock) || stock < 0) {
      return showToast('Lengkapi stok, rak, dan tanggal expired');
    }
    var batch = state.batches.filter(function (b) { return String(b.id) === String(batchId); })[0];
    if (!batch) return showToast('Batch tidak ditemukan');
    batch.stock = stock;
    batch.location = location;
    batch.expiredDate = expiredDate;
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    persistMine()
      .then(function () {
        closeModal();
        showToast('Stok diperbarui');
        return syncState();
      })
      .catch(function (err) { showToast(err.message || 'Gagal menyimpan stok'); })
      .then(function () { if (submitBtn) submitBtn.disabled = false; });
  }

  /* Render daftar batch yang mendekati atau sudah melewati kedaluwarsa */
  function renderExpired() {
    var filtersEl = document.getElementById('expired-filters');
    var listEl = document.getElementById('expired-list');
    if (!listEl) return;
    var filters = [
      { id: 'semua', label: 'Semua' },
      { id: 'h7', label: 'H-7' },
      { id: 'h3', label: 'H-3' },
      { id: 'today', label: 'Hari ini' },
      { id: 'expired', label: 'Lewat' }
    ];
    if (filtersEl) {
      filtersEl.innerHTML = filters.map(function (f) {
        var active = f.id === state.expiredFilter;
        return '<button type="button" data-exp-filter="' + f.id + '" class="shrink-0 h-8 px-3 rounded-full text-xs font-semibold ' +
          (active ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-emerald-100') + '">' + f.label + '</button>';
      }).join('');
    }

    var items = state.batches.filter(function (b) { return Number(b.stock) > 0; })
      .map(function (b) { return { b: b, d: daysUntil(b.expiredDate) }; });

    if (state.expiredFilter === 'h7') items = items.filter(function (x) { return x.d <= 7; });
    else if (state.expiredFilter === 'h3') items = items.filter(function (x) { return x.d <= 3; });
    else if (state.expiredFilter === 'today') items = items.filter(function (x) { return x.d === 0; });
    else if (state.expiredFilter === 'expired') items = items.filter(function (x) { return x.d < 0; });

    items.sort(function (a, b) { return a.d - b.d; });

    if (!items.length) {
      listEl.innerHTML = '<p class="text-sm text-slate-400 py-10 text-center">Tidak ada batch pada filter ini.</p>';
      return;
    }

    listEl.innerHTML = items.map(function (x) {
      var st = expiryStatus(x.b.expiredDate);
      return '<article class="bg-white rounded-2xl p-3 card-shadow flex items-center justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="font-semibold text-sm truncate">' + escapeHtml(x.b.name) + '</p>' +
          '<p class="text-[11px] text-slate-400">' + escapeHtml(x.b.id) + ' · Rak ' + escapeHtml(x.b.location || '-') + '</p>' +
          '<p class="text-[11px] text-slate-500">Expired ' + escapeHtml(x.b.expiredDate || '-') + ' · stok ' + x.b.stock + '</p>' +
        '</div>' +
        '<span class="text-[11px] px-2 py-1 rounded-full whitespace-nowrap ' + st.cls + '">' + st.label + '</span>' +
      '</article>';
    }).join('');
  }

  function riwayatRange() {
    if (state.riwayatFrom || state.riwayatTo) {
      return { from: state.riwayatFrom, to: state.riwayatTo };
    }
    if (state.riwayatPeriod === 'all') return { from: '', to: '' };
    var end = new Date();
    var start = new Date();
    if (state.riwayatPeriod === '7') start.setDate(start.getDate() - 6);
    else if (state.riwayatPeriod === '30') start.setDate(start.getDate() - 29);
    return { from: localDateKey(start), to: localDateKey(end) };
  }

  /* Render riwayat transaksi dari server */
  function renderRiwayat() {
    var listEl = document.getElementById('riwayat-list');
    if (!listEl) return;
    var range = riwayatRange();
    var fromEl = document.getElementById('riwayat-from');
    var toEl = document.getElementById('riwayat-to');
    if (fromEl && document.activeElement !== fromEl) fromEl.value = range.from;
    if (toEl && document.activeElement !== toEl) toEl.value = range.to;
    var periodEl = document.getElementById('riwayat-period');
    if (periodEl) {
      var periods = [
        { id: 'today', label: 'Hari Ini' },
        { id: '7', label: '7 Hari' },
        { id: '30', label: '30 Hari' },
        { id: 'all', label: 'Semua' }
      ];
      periodEl.innerHTML = periods.map(function (p) {
        var active = !state.riwayatFrom && !state.riwayatTo && p.id === state.riwayatPeriod;
        if ((state.riwayatFrom || state.riwayatTo) && p.id === 'all') active = false;
        return '<button type="button" data-riwayat-period="' + p.id + '" class="shrink-0 h-8 px-3 rounded-full text-xs font-semibold ' +
          (active ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-emerald-100') + '">' + p.label + '</button>';
      }).join('');
    }
    var searchEl = document.getElementById('search-riwayat');
    var q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    var list = sortedTransactions().filter(function (t) {
      var key = localDateKey(t.at);
      if (range.from && key < range.from) return false;
      if (range.to && key > range.to) return false;
      if (!q) return true;
      return String(t.id).toLowerCase().indexOf(q) !== -1 ||
        String(t.cashier || '').toLowerCase().indexOf(q) !== -1;
    });
    var total = list.reduce(function (s, t) { return s + (Number(t.total) || 0); }, 0);
    var summaryEl = document.getElementById('riwayat-summary');
    if (summaryEl) {
      var label = (range.from || '-') + ' s/d ' + (range.to || '-');
      if (!range.from && !range.to) label = 'Semua tanggal';
      summaryEl.textContent = list.length + ' transaksi · ' + formatRupiah(total) + ' · ' + label;
    }
    if (!list.length) {
      listEl.innerHTML = '<p class="text-sm text-slate-400 py-10 text-center">Tidak ada transaksi pada rentang ini.</p>';
      return;
    }
    listEl.innerHTML = list.map(function (t) {
      var itemCount = (t.lines || []).reduce(function (s, l) { return s + Number(l.qty || 0); }, 0);
      var when = trxTime(t) ? new Date(t.at).toLocaleString('id-ID') : '-';
      return '<article class="bg-white rounded-2xl p-3 card-shadow">' +
        '<div class="flex items-start justify-between gap-2">' +
          '<div class="min-w-0">' +
            '<p class="font-semibold text-sm truncate">' + escapeHtml(t.id) + '</p>' +
            '<p class="text-[11px] text-slate-400">' + when + '</p>' +
            '<p class="text-[11px] text-slate-500">' + escapeHtml(t.cashier || '-') + ' · ' + escapeHtml(String(t.payMethod || '-').toUpperCase()) + ' · ' + itemCount + ' item</p>' +
          '</div>' +
          '<p class="text-sm font-bold text-emerald-700 whitespace-nowrap">' + formatRupiah(t.total) + '</p>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  /* Rentang tanggal laporan berdasarkan periode terpilih */
  function laporanRange() {
    if (state.laporanFrom || state.laporanTo) {
      return { from: state.laporanFrom, to: state.laporanTo };
    }
    if (state.laporanPeriod === 'all') return { from: '', to: '' };
    var end = new Date();
    var start = new Date();
    if (state.laporanPeriod === '7') start.setDate(start.getDate() - 6);
    else if (state.laporanPeriod === '30') start.setDate(start.getDate() - 29);
    return { from: localDateKey(start), to: localDateKey(end) };
  }

  /* Transaksi yang masuk rentang tanggal laporan */
  function filteredTransactions(from, to) {
    return sortedTransactions().filter(function (t) {
      var key = localDateKey(t.at);
      if (from && key < from) return false;
      if (to && key > to) return false;
      return true;
    });
  }

  /* Render laporan omzet, ringkasan metode bayar, dan daftar transaksi */
  function renderLaporan() {
    var periodEl = document.getElementById('laporan-period');
    var fromEl = document.getElementById('laporan-from');
    var toEl = document.getElementById('laporan-to');
    var range = laporanRange();

    if (fromEl && document.activeElement !== fromEl) fromEl.value = range.from;
    if (toEl && document.activeElement !== toEl) toEl.value = range.to;

    if (periodEl) {
      var periods = [
        { id: 'today', label: 'Hari Ini' },
        { id: '7', label: '7 Hari' },
        { id: '30', label: '30 Hari' },
        { id: 'all', label: 'Semua' }
      ];
      periodEl.innerHTML = periods.map(function (p) {
        var active = p.id === state.laporanPeriod;
        return '<button type="button" data-period="' + p.id + '" class="shrink-0 h-8 px-3 rounded-full text-xs font-semibold ' +
          (active ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-emerald-100') + '">' + p.label + '</button>';
      }).join('');
    }

    var rows = filteredTransactions(range.from, range.to);
    var omzet = rows.reduce(function (s, t) { return s + (Number(t.total) || 0); }, 0);
    var omzetEl = document.getElementById('omzet');
    var countEl = document.getElementById('trx-count');
    if (omzetEl) omzetEl.textContent = formatRupiah(omzet);
    if (countEl) countEl.textContent = rows.length + ' transaksi';

    var byMethod = {};
    rows.forEach(function (t) {
      var key = t.payMethod || 'lainnya';
      if (!byMethod[key]) byMethod[key] = { count: 0, total: 0 };
      byMethod[key].count += 1;
      byMethod[key].total += Number(t.total) || 0;
    });
    var summaryEl = document.getElementById('laporan-summary');
    if (summaryEl) {
      var keys = Object.keys(byMethod);
      if (!keys.length) {
        summaryEl.innerHTML = '<p class="text-sm text-slate-400 py-2">Belum ada transaksi pada periode ini.</p>';
      } else {
        summaryEl.innerHTML = '<div class="bg-white rounded-2xl p-3 card-shadow"><p class="text-[11px] text-slate-500 mb-2">Metode Bayar</p>' +
          keys.map(function (k) {
            return '<div class="flex items-center justify-between text-sm py-0.5">' +
              '<span class="text-slate-600">' + escapeHtml(String(k).toUpperCase()) + ' · ' + byMethod[k].count + 'x</span>' +
              '<span class="font-semibold text-emerald-700">' + formatRupiah(byMethod[k].total) + '</span>' +
            '</div>';
          }).join('') + '</div>';
      }
    }

    var listEl = document.getElementById('laporan-list');
    if (listEl) {
      if (!rows.length) {
        listEl.innerHTML = '<p class="text-sm text-slate-400 py-6 text-center">Tidak ada transaksi pada periode ini.</p>';
      } else {
        listEl.innerHTML = rows.slice(0, 50).map(function (t) {
          return '<div class="bg-white rounded-2xl p-3 card-shadow flex items-center justify-between gap-2">' +
            '<div class="min-w-0">' +
              '<p class="text-xs font-semibold truncate">' + escapeHtml(t.id) + '</p>' +
              '<p class="text-[10px] text-slate-400">' + new Date(t.at).toLocaleString('id-ID') + '</p>' +
            '</div>' +
            '<span class="text-xs font-bold text-emerald-700 whitespace-nowrap">' + formatRupiah(t.total) + '</span>' +
          '</div>';
        }).join('');
      }
    }
  }

  /* Isi form pengaturan dengan nilai toko saat ini */
  function renderSettingsForm() {
    var form = document.getElementById('form-settings');
    if (!form) return;
    var storeField = formField(form, 'storeName');
    var cashierField = formField(form, 'cashierName');
    var taxField = formField(form, 'taxPercent');
    if (storeField) storeField.value = state.settings.storeName || '';
    if (cashierField) cashierField.value = state.settings.cashierName || '';
    if (taxField) taxField.value = state.settings.taxPercent || 0;
    renderUiOptions();
  }

  function renderUiOptions() {
    var brandHexNow = brandHex();
    var btnHexNow = buttonHex();
    var brandWrap = document.getElementById('ui-brand-options');
    var btnWrap = document.getElementById('ui-btn-options');
    if (brandWrap) {
      brandWrap.innerHTML = UI_BRANDS.map(function (c) {
        var on = brandHexNow.toUpperCase() === c.hex.toUpperCase();
        return '<button type="button" data-brand="' + c.id + '" class="h-11 rounded-xl border ' +
          (on ? 'border-slate-800 ring-2 ring-offset-1 ring-slate-400' : 'border-slate-200') +
          '" style="background:' + c.hex + '" aria-label="Warna tampilan ' + c.id + '"></button>';
      }).join('');
    }
    if (btnWrap) {
      btnWrap.innerHTML = UI_BUTTONS.map(function (c) {
        var on = btnHexNow.toUpperCase() === c.hex.toUpperCase();
        return '<button type="button" data-button="' + c.id + '" class="h-11 rounded-xl border ' +
          (on ? 'border-slate-800 ring-2 ring-offset-1 ring-slate-400' : 'border-slate-200') +
          '" style="background:' + c.hex + '" aria-label="Warna tombol ' + c.id + '"></button>';
      }).join('');
    }
    var brandPicker = document.getElementById('ui-brand-picker');
    var brandSwatch = document.getElementById('ui-brand-swatch');
    var brandHexInput = document.getElementById('ui-brand-hex');
    if (brandPicker) brandPicker.value = brandHexNow.toLowerCase();
    if (brandSwatch) brandSwatch.style.background = brandHexNow;
    if (brandHexInput && document.activeElement !== brandHexInput) brandHexInput.value = brandHexNow;
    var btnPicker = document.getElementById('ui-btn-picker');
    var btnSwatch = document.getElementById('ui-btn-swatch');
    var btnHexInput = document.getElementById('ui-btn-hex');
    if (btnPicker) btnPicker.value = btnHexNow.toLowerCase();
    if (btnSwatch) btnSwatch.style.background = btnHexNow;
    if (btnHexInput && document.activeElement !== btnHexInput) btnHexInput.value = btnHexNow;
    document.querySelectorAll('#ui-theme-options [data-theme]').forEach(function (btn) {
      var on = btn.getAttribute('data-theme') === state.ui.theme;
      btn.classList.toggle('bg-emerald-600', on);
      btn.classList.toggle('text-white', on);
      btn.classList.toggle('text-slate-600', !on);
    });
    document.querySelectorAll('#ui-text-options [data-text]').forEach(function (btn) {
      var on = btn.getAttribute('data-text') === state.ui.text;
      btn.classList.toggle('bg-emerald-600', on);
      btn.classList.toggle('text-white', on);
      btn.classList.toggle('text-slate-600', !on);
    });
  }

  /* Simpan pengaturan toko ke Google Sheets */
  function handleSaveSettings(event) {
    event.preventDefault();
    var form = event.target;
    state.settings.storeName = formField(form, 'storeName').value.trim();
    state.settings.cashierName = formField(form, 'cashierName').value.trim();
    state.settings.taxPercent = Number(formField(form, 'taxPercent').value) || 0;
    saveLocalSettings();
    showToast('Pengaturan disimpan');
    renderCurrentPage();
  }

  function withOwner(rec) {
    var next = rec && typeof rec === 'object' ? rec : {};
    next.owner = currentOwner();
    next.user = currentOwner();
    next.username = currentOwner();
    return next;
  }

  function othersRecords(kind) {
    return (remoteSnapshot[kind] || []).filter(function (rec) {
      return !belongsToUser(rec, rec.invoice_no || rec.id);
    });
  }

  function ownedId(id, kind) {
    var prefix = ownerPrefix();
    var raw = String(id || '');
    if (raw.indexOf(prefix) === 0) return raw;
    var tail = raw.replace(/[^a-zA-Z0-9]+/g, '') || kind || '1';
    return prefix + tail;
  }

  function serializeProduct(p) {
    return withOwner({
      id: ownedId(p.id, 'P1'),
      sku: ownedId(p.sku || p.id, 'SKU'),
      name: p.name,
      category: p.category,
      unit: p.unit,
      price: p.sellPrice,
      sell_price: p.sellPrice,
      buy_price: p.buyPrice,
      min_stock: p.minStock,
      location: p.location
    });
  }

  function serializeBatch(b) {
    return withOwner({
      id: ownedId(b.id, 'B1'),
      product_id: ownedId(b.productId, 'P1'),
      name: b.name,
      qty: b.stock,
      price: b.price,
      location: b.location,
      expired_date: b.expiredDate,
      created_at: b.createdAt
    });
  }

  function serializeTransaction(t) {
    var id = ownedId(t.id, 'TRX1');
    return withOwner({
      id: id,
      invoice_no: id,
      at: t.at,
      created_at: t.at,
      cashier: t.cashier,
      payMethod: t.payMethod,
      payment_method: t.payMethod,
      paid: t.paid,
      change: t.change,
      change_amount: t.change,
      discount: t.discount,
      tax: t.tax,
      subtotal: t.subtotal,
      total: t.total,
      lines: t.lines || [],
      items: t.lines || []
    });
  }

  /* Backup akun ini saja; restore ke Sheets digabung dengan data user lain */
  function buildBackupPayload() {
    return {
      products: state.products.map(serializeProduct),
      batches: state.batches.map(serializeBatch),
      transactions: state.transactions.map(serializeTransaction),
      settings: withOwner({
        store_name: state.settings.storeName,
        cashier_name: state.settings.cashierName,
        tax_percent: state.settings.taxPercent,
        address: state.settings.address || '',
        phone: state.settings.phone || ''
      })
    };
  }

  function buildMergedRestorePayload(mine) {
    var payload = mine || buildBackupPayload();
    return {
      action: 'restore',
      products: othersRecords('products').concat(payload.products || []),
      batches: othersRecords('batches').concat(payload.batches || []),
      transactions: othersRecords('transactions').concat(payload.transactions || []),
      settings: remoteSnapshot.settings || payload.settings || {}
    };
  }

  function persistMine() {
    return sheetsGet(API_FITUR, { action: 'state' }).then(function (data) {
      assertOk(data);
      captureRemote(data);
      return sheetsPost(API_FITUR, buildMergedRestorePayload());
    }).then(assertOk);
  }

  function nextProductId() {
    var prefix = ownerPrefix() + 'P';
    var used = {};
    (remoteSnapshot.products || []).concat(state.products).forEach(function (p) { used[String(p.id)] = true; });
    var i = 1;
    var nextId = prefix + i;
    while (used[nextId]) { i += 1; nextId = prefix + i; }
    return nextId;
  }

  function nextBatchId() {
    var prefix = ownerPrefix() + 'B';
    var used = {};
    (remoteSnapshot.batches || []).concat(state.batches).forEach(function (b) { used[String(b.id)] = true; });
    var i = 1;
    var nextId = prefix + i;
    while (used[nextId]) { i += 1; nextId = prefix + i; }
    return nextId;
  }

  function nextInvoiceId() {
    var prefix = ownerPrefix() + 'TRX-';
    var max = 0;
    state.transactions.forEach(function (t) {
      var id = String(t.id || '');
      if (id.indexOf(prefix) === 0) {
        var n = parseInt(id.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return prefix + String(max + 1).padStart(4, '0');
  }

  /* Pulihkan data dari file backup JSON ke Google Sheets */
  function handleRestoreFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try {
        payload = JSON.parse(String(reader.result));
      } catch (e) {
        return showToast('File backup tidak valid');
      }
      var prefix = ownerPrefix();
      state.products = (Array.isArray(payload.products) ? payload.products : []).map(function (p, i) {
        var mapped = mapProduct(p);
        mapped.id = prefix + 'P' + (i + 1);
        return mapped;
      });
      var idMap = {};
      (payload.products || []).forEach(function (p, i) { idMap[String(p.id)] = prefix + 'P' + (i + 1); });
      state.batches = (Array.isArray(payload.batches) ? payload.batches : []).map(function (b, i) {
        var mapped = mapBatch(b, state.products);
        mapped.id = prefix + 'B' + (i + 1);
        mapped.productId = idMap[String(b.product_id || b.productId || '')] || (state.products[0] && state.products[0].id) || prefix + 'P1';
        return mapped;
      });
      state.transactions = (Array.isArray(payload.transactions) ? payload.transactions : []).map(function (t, i) {
        var mapped = mapTransaction(t);
        mapped.id = prefix + 'TRX-' + String(i + 1).padStart(4, '0');
        return mapped;
      });
      persistMine()
        .then(function () {
          showToast('Data berhasil dipulihkan');
          return syncState();
        })
        .catch(function (err) { showToast(err.message || 'Gagal memulihkan data'); });
    };
    reader.readAsText(file);
    input.value = '';
  }

  /* Reset data akun yang login saja, tanpa menghapus stok user lain */
  function handleReset() {
    if (!window.confirm('Hapus stok dan transaksi akun ini? Data user lain tidak terpengaruh.')) return;
    state.products = [];
    state.batches = [];
    state.transactions = [];
    persistMine()
      .then(function () {
        showToast('Data akun direset');
        return syncState();
      })
      .catch(function (err) { showToast(err.message || 'Gagal reset data'); });
  }

  function laporanExportRows() {
    var range = laporanRange();
    var rows = filteredTransactions(range.from, range.to);
    var header = ['ID', 'Tanggal', 'Kasir', 'Metode', 'Subtotal', 'Diskon', 'Pajak', 'Total', 'Dibayar', 'Kembalian'];
    var data = rows.map(function (t) {
      return [
        t.id,
        t.at ? new Date(t.at).toLocaleString('id-ID') : '',
        t.cashier || '',
        String(t.payMethod || '').toUpperCase(),
        Number(t.subtotal) || 0,
        Number(t.discount) || 0,
        Number(t.tax) || 0,
        Number(t.total) || 0,
        Number(t.paid) || 0,
        Number(t.change) || 0
      ];
    });
    var omzet = rows.reduce(function (s, t) { return s + (Number(t.total) || 0); }, 0);
    return { range: range, header: header, data: data, omzet: omzet, count: rows.length };
  }

  function triggerDownload(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function xmlEscape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildExcelXml(exportData) {
    var store = xmlEscape(state.settings.storeName || 'UMKM Kasir');
    var from = exportData.range.from || '-';
    var to = exportData.range.to || '-';
    var rowsXml = '';
    function cell(val, type) {
      var t = type || (typeof val === 'number' ? 'Number' : 'String');
      return '<Cell><Data ss:Type="' + t + '">' + xmlEscape(val) + '</Data></Cell>';
    }
    rowsXml += '<Row>' + cell(store) + '</Row>';
    rowsXml += '<Row>' + cell('Laporan Transaksi') + cell(from + ' s/d ' + to) + '</Row>';
    rowsXml += '<Row>' + cell('Omzet') + cell(exportData.omzet, 'Number') + cell('Transaksi') + cell(exportData.count, 'Number') + '</Row>';
    rowsXml += '<Row></Row>';
    rowsXml += '<Row>' + exportData.header.map(function (h) { return cell(h); }).join('') + '</Row>';
    exportData.data.forEach(function (row) {
      rowsXml += '<Row>' + row.map(function (v, i) {
        return i >= 4 ? cell(Number(v) || 0, 'Number') : cell(v);
      }).join('') + '</Row>';
    });
    return '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Worksheet ss:Name="Laporan"><Table>' + rowsXml + '</Table></Worksheet></Workbook>';
  }

  function pdfSafe(str) {
    return String(str == null ? '' : str)
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function buildPdf(exportData) {
    var pageW = 842;
    var pageH = 595;
    var margin = 28;
    var rowH = 16;
    var headerH = 72;
    var colW = [88, 118, 70, 52, 70, 62, 62, 70, 70, 70];
    var maxRows = Math.floor((pageH - headerH - margin) / rowH);
    var pages = [];
    var i = 0;
    if (!exportData.data.length) pages.push([]);
    while (i < exportData.data.length || !pages.length) {
      pages.push(exportData.data.slice(i, i + maxRows));
      i += maxRows;
      if (!exportData.data.length) break;
    }
    var objects = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    var pageIds = [];
    var fontId;
    var contents = [];
    pages.forEach(function (chunk, p) {
      var y = pageH - margin;
      var s = 'BT\n/F1 12 Tf\n';
      function line(text, x, yy, size) {
        s += '/F1 ' + (size || 9) + ' Tf\n1 0 0 1 ' + x + ' ' + yy + ' Tm\n(' + pdfSafe(text) + ') Tj\n';
      }
      line((state.settings.storeName || 'UMKM Kasir') + ' - Laporan Transaksi', margin, y, 12);
      y -= 16;
      line('Periode: ' + (exportData.range.from || '-') + ' s/d ' + (exportData.range.to || '-') +
        ' | Omzet: ' + formatRupiah(exportData.omzet) + ' | ' + exportData.count + ' transaksi | Hal ' + (p + 1) + '/' + pages.length, margin, y, 8);
      y -= 20;
      var x = margin;
      exportData.header.forEach(function (h, ci) {
        line(h, x, y, 8);
        x += colW[ci];
      });
      y -= rowH;
      chunk.forEach(function (row) {
        x = margin;
        row.forEach(function (v, ci) {
          var txt = ci >= 4 ? formatRupiah(v) : v;
          line(txt, x, y, 8);
          x += colW[ci];
        });
        y -= rowH;
      });
      s += 'ET';
      contents.push(s);
    });
    fontId = 3 + pages.length * 2;
    var kids = [];
    pages.forEach(function (_, p) {
      var pageObj = 3 + p * 2;
      var contentObj = 4 + p * 2;
      kids.push(pageObj + ' 0 R');
      objects[pageObj - 1] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Contents ' + contentObj + ' 0 R /Resources << /Font << /F1 ' + fontId + ' 0 R >> >> >>';
      objects[contentObj - 1] = '<< /Length ' + contents[p].length + ' >>\nstream\n' + contents[p] + '\nendstream';
    });
    objects[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
    objects[fontId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    var out = '%PDF-1.4\n';
    var offsets = [0];
    objects.forEach(function (body, idx) {
      offsets[idx + 1] = out.length;
      out += (idx + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xrefPos = out.length;
    out += 'xref\n0 ' + (objects.length + 1) + '\n';
    out += '0000000000 65535 f \n';
    for (var n = 1; n <= objects.length; n++) {
      out += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    }
    out += 'trailer << /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
    return out;
  }

  /* Unduh backup/laporan dari data yang sedang dimuat */
  function downloadExport(format) {
    if (format === 'xlsx' || format === 'excel') {
      var excelData = laporanExportRows();
      triggerDownload(new Blob(['\ufeff' + buildExcelXml(excelData)], { type: 'application/vnd.ms-excel;charset=utf-8' }), 'umkm-laporan.xls');
      return;
    }
    if (format === 'pdf') {
      var pdfData = laporanExportRows();
      triggerDownload(new Blob([buildPdf(pdfData)], { type: 'application/pdf' }), 'umkm-laporan.pdf');
      return;
    }
    var range = laporanRange();
    var rows = filteredTransactions(range.from, range.to);
    var filename;
    var blob;
    if (format === 'csv') {
      var header = ['id', 'tanggal', 'kasir', 'metode', 'subtotal', 'diskon', 'pajak', 'total', 'dibayar', 'kembalian'];
      var lines = [header.join(',')];
      rows.forEach(function (t) {
        lines.push([t.id, t.at, t.cashier, t.payMethod, t.subtotal, t.discount, t.tax, t.total, t.paid, t.change].join(','));
      });
      blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      filename = 'umkm-laporan.csv';
    } else {
      blob = new Blob([JSON.stringify(buildBackupPayload(), null, 2)], { type: 'application/json;charset=utf-8' });
      filename = 'umkm-backup.json';
    }
    triggerDownload(blob, filename);
  }

  /* Tanggal lokal format YYYY-MM-DD untuk agregasi harian */
  function localDateKey(date) {
    var d = new Date(date);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* Render seluruh widget halaman Dashboard */
  function renderDashboard() {
    renderDashStore();
    renderDashStats();
    renderDashChart();
    renderDashAlerts();
    renderDashNearExpiry();
    renderDashLowStock();
    renderDashActivity();
  }

  /* Kartu identitas toko dan kasir */
  function renderDashStore() {
    var wrap = document.getElementById('dash-store');
    if (!wrap) return;
    var name = state.settings.storeName || 'UMKM Kasir';
    var cashier = state.settings.cashierName || 'Kasir';
    wrap.innerHTML =
      '<div class="flex items-center gap-3">' +
        '<div class="w-12 h-12 shrink-0 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-lg">' + escapeHtml(name.charAt(0).toUpperCase()) + '</div>' +
        '<div class="min-w-0">' +
          '<p class="text-[11px] uppercase tracking-widest text-slate-400">Toko</p>' +
          '<p class="font-bold text-emerald-800 leading-tight truncate">' + escapeHtml(name) + '</p>' +
          '<p class="text-xs text-slate-500">' + escapeHtml(cashier) + '</p>' +
        '</div>' +
      '</div>';
  }

  /* Kartu ringkasan omzet, stok, dan kedaluwarsa */
  function renderDashStats() {
    var wrap = document.getElementById('dash-stats');
    if (!wrap) return;
    var todayKey = localDateKey(new Date());
    var omzetToday = 0;
    var trxToday = 0;
    state.transactions.forEach(function (t) {
      if (localDateKey(t.at) === todayKey) {
        omzetToday += Number(t.total) || 0;
        trxToday += 1;
      }
    });
    var catalog = catalogProducts('', 'Semua');
    var totalStock = 0;
    catalog.forEach(function (p) { totalStock += Number(p.stock) || 0; });
    var nearExp = countNearExpiry();
    var lowCount = catalog.filter(function (p) {
      var prod = findProductByName(p.name);
      var min = prod && prod.minStock != null ? Number(prod.minStock) : 5;
      return p.stock <= min;
    }).length;
    updateNotifBadge();
    var cards = [
      { label: 'Total Produk', value: String(catalog.length), sub: 'dari batch stok', cls: 'text-emerald-700' },
      { label: 'Total Stok', value: String(totalStock), sub: 'semua rak', cls: 'text-emerald-700' },
      { label: 'Penjualan Hari Ini', value: formatRupiah(omzetToday), sub: trxToday + ' transaksi', cls: 'text-emerald-700' },
      { label: 'Jumlah Transaksi', value: String(state.transactions.length), sub: 'semua waktu', cls: 'text-emerald-700' },
      { label: 'Hampir Expired', value: String(nearExp), sub: 'H-7 / H-3 / hari ini', cls: nearExp ? 'text-amber-600' : 'text-emerald-700' },
      { label: 'Stok Menipis', value: String(lowCount), sub: 'di bawah minimum', cls: lowCount ? 'text-rose-600' : 'text-emerald-700' }
    ];
    wrap.innerHTML = cards.map(function (c) {
      return '<div class="bg-white rounded-2xl p-3 card-shadow">' +
        '<p class="text-[11px] text-slate-500 truncate">' + escapeHtml(c.label) + '</p>' +
        '<p class="text-lg font-bold truncate ' + c.cls + '">' + escapeHtml(c.value) + '</p>' +
        '<p class="text-[10px] text-slate-400">' + escapeHtml(c.sub) + '</p>' +
      '</div>';
    }).join('');
  }

  /* Grafik batang omzet 7 hari terakhir */
  function renderDashChart() {
    var wrap = document.getElementById('dash-chart');
    if (!wrap) return;
    var days = [];
    var i;
    for (i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ key: localDateKey(d), label: String(d.getDate()).padStart(2, '0'), total: 0 });
    }
    state.transactions.forEach(function (t) {
      var key = localDateKey(t.at);
      for (var j = 0; j < days.length; j++) {
        if (days[j].key === key) { days[j].total += Number(t.total) || 0; break; }
      }
    });
    var max = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([1]));
    wrap.innerHTML = days.map(function (x) {
      var pct = x.total > 0 ? Math.max(Math.round((x.total / max) * 100), 4) : 2;
      return '<div class="flex-1 h-full flex flex-col items-center justify-end gap-1">' +
        '<div class="flex-1 w-full flex items-end justify-center">' +
          '<div class="w-full max-w-[32px] rounded-t-md bg-umkm chart-bar" style="height:' + pct + '%" title="' + escapeAttr(x.key + ' · ' + formatRupiah(x.total)) + '"></div>' +
        '</div>' +
        '<span class="text-[10px] font-semibold text-slate-500">' + x.label + '</span>' +
      '</div>';
    }).join('');
  }

  /* Hitung jumlah batch aktif yang expired dalam 7 hari atau sudah lewat */
  function countNearExpiry() {
    var count = 0;
    state.batches.forEach(function (b) {
      if (Number(b.stock) <= 0) return;
      if (daysUntil(b.expiredDate) <= 7) count += 1;
    });
    return count;
  }

  function expiryAlerts() {
    return state.batches
      .filter(function (b) { return Number(b.stock) > 0 && daysUntil(b.expiredDate) <= 7; })
      .sort(function (a, b) { return daysUntil(a.expiredDate) - daysUntil(b.expiredDate); });
  }

  function unreadNotifCount() {
    var read = {};
    (state.notifReadIds || []).forEach(function (id) { read[String(id)] = true; });
    return expiryAlerts().filter(function (b) { return !read[String(b.id)]; }).length;
  }

  function markNotifsRead() {
    var ids = expiryAlerts().map(function (b) { return String(b.id); });
    var map = {};
    (state.notifReadIds || []).forEach(function (id) { map[String(id)] = true; });
    ids.forEach(function (id) { map[id] = true; });
    state.notifReadIds = Object.keys(map);
    saveNotifRead();
    updateNotifBadge();
  }

  function clearNotifs() {
    var map = {};
    (state.notifReadIds || []).forEach(function (id) { map[String(id)] = true; });
    expiryAlerts().forEach(function (b) { map[String(b.id)] = true; });
    state.notifReadIds = Object.keys(map);
    saveNotifRead();
    updateNotifBadge();
    var list = document.getElementById('notif-list');
    if (list) list.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">Tidak ada notifikasi</p>';
  }

  function renderNotifPanel() {
    var list = document.getElementById('notif-list');
    if (!list) return;
    var items = expiryAlerts();
    if (!items.length) {
      list.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">Tidak ada notifikasi</p>';
      return;
    }
    list.innerHTML = items.map(function (b) {
      var st = expiryStatus(b.expiredDate);
      return '<button type="button" data-notif-id="' + escapeAttr(b.id) + '" class="w-full text-left bg-slate-50 rounded-xl px-2 py-1.5">' +
        '<p class="text-xs font-semibold truncate">' + escapeHtml(b.name) + '</p>' +
        '<p class="text-[10px] text-slate-400">Rak ' + escapeHtml(b.location || '-') + ' · stok ' + (Number(b.stock) || 0) + '</p>' +
        '<span class="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full ' + st.cls + '">' + st.label + '</span>' +
      '</button>';
    }).join('');
  }

  function toggleNotifPanel() {
    var panel = document.getElementById('notif-panel');
    if (!panel) {
      setPage('expired');
      return;
    }
    var open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    if (open) {
      renderNotifPanel();
      markNotifsRead();
    }
  }

  /* Badge merah hanya untuk notifikasi yang belum dibaca */
  function updateNotifBadge() {
    var badge = document.getElementById('notif-badge');
    if (!badge) return;
    var count = unreadNotifCount();
    badge.classList.toggle('hidden', count <= 0);
  }

  /* Daftar peringatan batch H-7 dan H-3 */
  function renderDashAlerts() {
    var wrap = document.getElementById('dash-alerts');
    if (!wrap) return;
    var items = state.batches
      .filter(function (b) { return Number(b.stock) > 0; })
      .map(function (b) { return { b: b, d: daysUntil(b.expiredDate) }; })
      .filter(function (x) { return x.d <= 7; })
      .sort(function (a, b) { return a.d - b.d; });
    if (!items.length) {
      wrap.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">Tidak ada peringatan expired</p>';
      return;
    }
    wrap.innerHTML = items.slice(0, 12).map(function (x) {
      var st = expiryStatus(x.b.expiredDate);
      return '<div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-2 py-1.5">' +
        '<div class="min-w-0">' +
          '<p class="text-xs font-semibold truncate">' + escapeHtml(x.b.name) + '</p>' +
          '<p class="text-[10px] text-slate-400">Rak ' + escapeHtml(x.b.location || '-') + ' · ' + escapeHtml(x.b.expiredDate || '-') + '</p>' +
        '</div>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ' + st.cls + '">' + st.label + '</span>' +
      '</div>';
    }).join('');
  }

  /* Produk dengan tanggal expired terdekat */
  function renderDashNearExpiry() {
    var wrap = document.getElementById('dash-near-exp');
    if (!wrap) return;
    var items = catalogProducts('', 'Semua')
      .filter(function (p) { return daysUntil(p.nearestExp) <= 7; })
      .sort(function (a, b) { return daysUntil(a.nearestExp) - daysUntil(b.nearestExp); });
    if (!items.length) {
      wrap.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">Semua produk masih aman</p>';
      return;
    }
    wrap.innerHTML = items.slice(0, 8).map(function (p) {
      var st = expiryStatus(p.nearestExp);
      return '<div class="flex items-center justify-between gap-2">' +
        '<div class="min-w-0">' +
          '<p class="text-xs font-semibold truncate">' + escapeHtml(p.name) + '</p>' +
          '<p class="text-[10px] text-slate-400">Stok ' + p.stock + ' · ' + escapeHtml(p.nearestExp || '-') + '</p>' +
        '</div>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ' + st.cls + '">' + st.label + '</span>' +
      '</div>';
    }).join('');
  }

  /* Produk dengan stok di bawah atau sama dengan batas minimum */
  function renderDashLowStock() {
    var wrap = document.getElementById('dash-low-stock');
    if (!wrap) return;
    var items = catalogProducts('', 'Semua').filter(function (p) {
      var prod = findProductByName(p.name);
      var min = prod && prod.minStock != null ? Number(prod.minStock) : 5;
      return p.stock <= min;
    }).sort(function (a, b) { return a.stock - b.stock; });
    if (!items.length) {
      wrap.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">Stok semua produk aman</p>';
      return;
    }
    wrap.innerHTML = items.slice(0, 8).map(function (p) {
      var prod = findProductByName(p.name);
      var min = prod && prod.minStock != null ? Number(prod.minStock) : 5;
      return '<div class="flex items-center justify-between gap-2">' +
        '<div class="min-w-0">' +
          '<p class="text-xs font-semibold truncate">' + escapeHtml(p.name) + '</p>' +
          '<p class="text-[10px] text-slate-400">Min ' + min + ' · Rak ' + escapeHtml(p.location) + '</p>' +
        '</div>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap bg-rose-100 text-rose-700">' + p.stock + ' tersisa</span>' +
      '</div>';
    }).join('');
  }

  /* Aktivitas transaksi terbaru, sumber sama dengan menu Riwayat */
  function renderDashActivity() {
    var wrap = document.getElementById('dash-activity');
    if (!wrap) return;
    var list = sortedTransactions().slice(0, 5);
    if (!list.length) {
      wrap.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">Belum ada transaksi</p>';
      return;
    }
    wrap.innerHTML = list.map(function (t) {
      var when = trxTime(t) ? new Date(t.at).toLocaleString('id-ID') : '-';
      return '<button type="button" data-open-riwayat="' + escapeAttr(t.id) + '" class="w-full flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2 text-left">' +
        '<div class="min-w-0">' +
          '<p class="text-xs font-semibold truncate">' + escapeHtml(t.id || '-') + '</p>' +
          '<p class="text-[10px] text-slate-400">' + when + ' · ' + escapeHtml(String(t.payMethod || '-').toUpperCase()) + '</p>' +
        '</div>' +
        '<span class="text-xs font-bold text-emerald-700 whitespace-nowrap">' + formatRupiah(t.total) + '</span>' +
      '</button>';
    }).join('');
  }

  /* Render isi bottom-sheet keranjang */
  function renderCart() {
    var wrap = document.getElementById('cart-items');
    if (!wrap) return;
    if (!state.cart.length) {
      wrap.innerHTML = '<p class="text-sm text-slate-500 text-center py-6">Keranjang masih kosong</p>';
    } else {
      wrap.innerHTML = state.cart.map(function (c) {
        return (
          '<div class="flex items-center justify-between bg-slate-50 rounded-xl p-2">' +
            '<div><p class="text-sm font-semibold">' + escapeHtml(c.name) + '</p>' +
            '<p class="text-[11px] text-slate-500">' + formatRupiah(c.price) + '</p></div>' +
            '<div class="flex items-center gap-2">' +
              '<button type="button" class="w-7 h-7 rounded-md bg-white border" data-act="minus" data-name="' + escapeAttr(c.name) + '">-</button>' +
              '<span class="w-5 text-center text-sm">' + c.qty + '</span>' +
              '<button type="button" class="w-7 h-7 rounded-md bg-emerald-600 text-white" data-act="plus" data-name="' + escapeAttr(c.name) + '">+</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }
    var subEl = document.getElementById('cart-subtotal');
    var taxEl = document.getElementById('cart-tax');
    var totEl = document.getElementById('cart-total');
    var chEl = document.getElementById('cart-change');
    if (subEl) subEl.textContent = formatRupiah(cartSubtotal());
    if (taxEl) taxEl.textContent = formatRupiah(cartTax());
    if (totEl) totEl.textContent = formatRupiah(cartTotal());
    if (chEl) chEl.textContent = formatRupiah(Math.max(0, cartChange()));
    var methods = document.getElementById('pay-methods');
    if (methods) {
      methods.innerHTML = PAY_METHODS.map(function (m) {
        var active = m.id === state.payMethod;
        return '<button type="button" data-pay="' + m.id + '" class="h-8 rounded-lg text-[11px] font-semibold ' +
          (active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600') + '">' + m.label + '</button>';
      }).join('');
    }
    var paidWrap = document.getElementById('paid-wrap');
    if (paidWrap) paidWrap.classList.toggle('hidden', state.payMethod !== 'tunai');
  }

  /* Buka modal keranjang sebagai bottom-sheet */
  function openCart() {
    var overlay = document.getElementById('cart-overlay');
    var sheet = document.getElementById('cart-sheet');
    if (!overlay || !sheet) return;
    renderCart();
    overlay.classList.remove('hidden');
    requestAnimationFrame(function () {
      sheet.classList.remove('sheet-enter');
      sheet.classList.add('sheet-open');
    });
  }

  /* Tutup bottom-sheet keranjang */
  function closeCart() {
    var overlay = document.getElementById('cart-overlay');
    var sheet = document.getElementById('cart-sheet');
    if (!overlay || !sheet) return;
    sheet.classList.add('sheet-enter');
    sheet.classList.remove('sheet-open');
    setTimeout(function () { overlay.classList.add('hidden'); }, 280);
  }

  /* Tampilkan toast singkat di atas navigasi */
  function showToast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.classList.add('hidden'); }, 2200);
  }

  /* Ambil input form berdasarkan atribut name */
  function formField(form, name) {
    return (form.elements && form.elements[name]) || form.querySelector('[name="' + name + '"]');
  }

  /* Pastikan produk ada di katalog akun ini */
  function ensureProduct(name, price, location, category) {
    var existing = findProductByName(name);
    if (existing) {
      if (!existing.sellPrice && price) existing.sellPrice = price;
      if (location) existing.location = location;
      if (category) existing.category = category;
      return existing;
    }
    var nextId = nextProductId();
    var product = {
      id: nextId,
      sku: 'SKU-' + nextId.replace(/\W/g, '').slice(-6),
      name: name,
      category: category || 'Umum',
      unit: 'pcs',
      sellPrice: price,
      buyPrice: Math.round(price * 0.8),
      minStock: 5,
      location: location
    };
    state.products.push(product);
    return product;
  }

  /* Simpan batch baru ke Google Sheets */
  function handleSaveBatch(event) {
    event.preventDefault();
    var form = event.target;
    var name = formField(form, 'name').value.trim();
    var stock = parseInt(formField(form, 'stock').value, 10);
    var price = parseInt(formField(form, 'price').value, 10);
    var location = formField(form, 'location').value.trim();
    var expiredDate = formField(form, 'expiredDate').value;
    var categoryEl = formField(form, 'category');
    var category = categoryEl ? categoryEl.value.trim() : '';
    if (!name || !location || !expiredDate || stock < 1 || price < 0 || isNaN(stock) || isNaN(price)) {
      return showToast('Lengkapi data barang dengan benar');
    }
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    var product = ensureProduct(name, price, location, category);
    state.batches.push({
      id: nextBatchId(),
      productId: product.id,
      name: product.name,
      stock: stock,
      price: price,
      location: location,
      expiredDate: expiredDate,
      createdAt: new Date().toISOString()
    });
    persistMine()
      .then(function () {
        form.reset();
        showToast('Batch disimpan (FIFO)');
        return syncState();
      })
      .catch(function (err) {
        showToast(err.message || 'Gagal menyimpan batch');
      })
      .then(function () {
        if (submitBtn) submitBtn.disabled = false;
      });
  }

  /* Handler delegasi klik tombol plus/minus di kartu dan keranjang */
  function onQtyClick(event) {
    var btn = event.target.closest('button[data-act]');
    if (!btn) return;
    var name = btn.getAttribute('data-name');
    var act = btn.getAttribute('data-act');
    addToCart(name, act === 'plus' ? 1 : -1);
  }

  /* Ikat event UI Kasir: search, kategori, keranjang, bayar */
  function bindKasirEvents() {
    var search = document.getElementById('search-kasir');
    if (search) search.addEventListener('input', renderKasir);
    var cats = document.getElementById('kasir-cats');
    if (cats) {
      cats.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-cat]');
        if (!btn) return;
        state.kasirCat = btn.getAttribute('data-cat');
        renderKasir();
      });
    }
    var openBtn = document.getElementById('btn-open-cart');
    if (openBtn) openBtn.addEventListener('click', openCart);
    var closeBtn = document.getElementById('btn-close-cart');
    if (closeBtn) closeBtn.addEventListener('click', closeCart);
    var overlay = document.getElementById('cart-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target.id === 'cart-overlay') closeCart();
      });
    }
    var checkoutBtn = document.getElementById('btn-checkout');
    if (checkoutBtn) checkoutBtn.addEventListener('click', checkout);
    var list = document.getElementById('kasir-list');
    if (list) list.addEventListener('click', onQtyClick);
    var items = document.getElementById('cart-items');
    if (items) items.addEventListener('click', onQtyClick);
    var methods = document.getElementById('pay-methods');
    if (methods) {
      methods.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-pay]');
        if (!btn) return;
        state.payMethod = btn.getAttribute('data-pay');
        renderCart();
      });
    }
    var disc = document.getElementById('cart-discount');
    if (disc) disc.addEventListener('input', renderCart);
    var paid = document.getElementById('cart-paid');
    if (paid) paid.addEventListener('input', renderCart);
    var closeSuccess = document.getElementById('btn-close-success');
    if (closeSuccess) closeSuccess.addEventListener('click', hideSuccess);
    var printBtn = document.getElementById('btn-print-receipt');
    if (printBtn) printBtn.addEventListener('click', printReceipt);
    var form = document.getElementById('form-barang');
    if (form) form.addEventListener('submit', handleSaveBatch);
    var stokSearch = document.getElementById('search-stok');
    if (stokSearch) stokSearch.addEventListener('input', renderStok);
    var stokList = document.getElementById('stok-list');
    if (stokList) {
      stokList.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-edit-batch]');
        if (!btn) return;
        openEditBatch(btn.getAttribute('data-edit-batch'));
      });
    }
    var closeModalBtn = document.getElementById('btn-close-modal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    var modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) closeModal();
      });
    }
    var dashActivity = document.getElementById('dash-activity');
    if (dashActivity) {
      dashActivity.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-open-riwayat]');
        if (!btn) return;
        var searchEl = document.getElementById('search-riwayat');
        if (searchEl) searchEl.value = btn.getAttribute('data-open-riwayat') || '';
        setPage('riwayat');
      });
    }
    var notif = document.getElementById('btn-notif');
    if (notif) notif.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleNotifPanel();
    });
    var notifClear = document.getElementById('btn-notif-clear');
    if (notifClear) notifClear.addEventListener('click', function (e) {
      e.stopPropagation();
      clearNotifs();
    });
    var notifList = document.getElementById('notif-list');
    if (notifList) {
      notifList.addEventListener('click', function (e) {
        var item = e.target.closest('[data-notif-id]');
        if (!item) return;
        var panel = document.getElementById('notif-panel');
        if (panel) panel.classList.add('hidden');
        setPage('expired');
      });
    }
    document.addEventListener('click', function (e) {
      var panel = document.getElementById('notif-panel');
      if (!panel || panel.classList.contains('hidden')) return;
      if (e.target.closest('#notif-panel') || e.target.closest('#btn-notif')) return;
      panel.classList.add('hidden');
    });
    var themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    var expiredFilters = document.getElementById('expired-filters');
    if (expiredFilters) {
      expiredFilters.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-exp-filter]');
        if (!btn) return;
        state.expiredFilter = btn.getAttribute('data-exp-filter');
        renderExpired();
      });
    }
    var riwayatSearch = document.getElementById('search-riwayat');
    if (riwayatSearch) riwayatSearch.addEventListener('input', renderRiwayat);
    var riwayatPeriod = document.getElementById('riwayat-period');
    if (riwayatPeriod) {
      riwayatPeriod.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-riwayat-period]');
        if (!btn) return;
        state.riwayatPeriod = btn.getAttribute('data-riwayat-period');
        state.riwayatFrom = '';
        state.riwayatTo = '';
        renderRiwayat();
      });
    }
    var riwayatFrom = document.getElementById('riwayat-from');
    if (riwayatFrom) {
      riwayatFrom.addEventListener('change', function () {
        state.riwayatFrom = riwayatFrom.value;
        renderRiwayat();
      });
    }
    var riwayatTo = document.getElementById('riwayat-to');
    if (riwayatTo) {
      riwayatTo.addEventListener('change', function () {
        state.riwayatTo = riwayatTo.value;
        renderRiwayat();
      });
    }

    var periodEl = document.getElementById('laporan-period');
    if (periodEl) {
      periodEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-period]');
        if (!btn) return;
        state.laporanPeriod = btn.getAttribute('data-period');
        state.laporanFrom = '';
        state.laporanTo = '';
        renderLaporan();
      });
    }
    var laporanFrom = document.getElementById('laporan-from');
    if (laporanFrom) {
      laporanFrom.addEventListener('change', function () {
        state.laporanFrom = laporanFrom.value;
        renderLaporan();
      });
    }
    var laporanTo = document.getElementById('laporan-to');
    if (laporanTo) {
      laporanTo.addEventListener('change', function () {
        state.laporanTo = laporanTo.value;
        renderLaporan();
      });
    }
    var csvBtn = document.getElementById('btn-export-csv');
    if (csvBtn) csvBtn.addEventListener('click', function () { downloadExport('csv'); });
    var jsonBtn = document.getElementById('btn-export-json');
    if (jsonBtn) jsonBtn.addEventListener('click', function () { downloadExport('json'); });
    var xlsxBtn = document.getElementById('btn-export-xlsx');
    if (xlsxBtn) xlsxBtn.addEventListener('click', function () { downloadExport('xlsx'); });
    var pdfBtn = document.getElementById('btn-export-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', function () { downloadExport('pdf'); });
    var reportFileBtn = document.getElementById('btn-export-laporan-file');
    if (reportFileBtn) reportFileBtn.addEventListener('click', function () { downloadExport('json'); });
    var reportXlsxBtn = document.getElementById('btn-export-laporan-xlsx');
    if (reportXlsxBtn) reportXlsxBtn.addEventListener('click', function () { downloadExport('xlsx'); });
    var reportPdfBtn = document.getElementById('btn-export-laporan-pdf');
    if (reportPdfBtn) reportPdfBtn.addEventListener('click', function () { downloadExport('pdf'); });
    var backupBtn = document.getElementById('btn-backup');
    if (backupBtn) backupBtn.addEventListener('click', function () { downloadExport('json'); });
    var restoreInput = document.getElementById('input-restore');
    if (restoreInput) restoreInput.addEventListener('change', handleRestoreFile);
    var resetBtn = document.getElementById('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', handleReset);
    var settingsForm = document.getElementById('form-settings');
    if (settingsForm) settingsForm.addEventListener('submit', handleSaveSettings);
    var themeOpts = document.getElementById('ui-theme-options');
    if (themeOpts) {
      themeOpts.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-theme]');
        if (btn) setUiPref('theme', btn.getAttribute('data-theme'));
      });
    }
    var brandOpts = document.getElementById('ui-brand-options');
    if (brandOpts) {
      brandOpts.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-brand]');
        if (!btn) return;
        var id = btn.getAttribute('data-brand');
        state.ui.brand = id;
        state.ui.brandHex = hexFromBrand(id);
        saveUiPrefs();
        applyAppearance();
      });
    }
    var btnOpts = document.getElementById('ui-btn-options');
    if (btnOpts) {
      btnOpts.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-button]');
        if (!btn) return;
        var id = btn.getAttribute('data-button');
        state.ui.button = id;
        state.ui.buttonHex = hexFromButton(id);
        saveUiPrefs();
        applyAppearance();
      });
    }
    var brandPicker = document.getElementById('ui-brand-picker');
    if (brandPicker) {
      brandPicker.addEventListener('input', function () {
        setCustomColor('brand', brandPicker.value);
      });
    }
    var btnPicker = document.getElementById('ui-btn-picker');
    if (btnPicker) {
      btnPicker.addEventListener('input', function () {
        setCustomColor('button', btnPicker.value);
      });
    }
    var brandHexInput = document.getElementById('ui-brand-hex');
    if (brandHexInput) {
      brandHexInput.addEventListener('change', function () {
        setCustomColor('brand', brandHexInput.value);
      });
    }
    var btnHexInput = document.getElementById('ui-btn-hex');
    if (btnHexInput) {
      btnHexInput.addEventListener('change', function () {
        setCustomColor('button', btnHexInput.value);
      });
    }
    var textOpts = document.getElementById('ui-text-options');
    if (textOpts) {
      textOpts.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-text]');
        if (btn) setUiPref('text', btn.getAttribute('data-text'));
      });
    }
  }

  function brandHex() {
    return normalizeHex(state.ui.brandHex) || hexFromBrand(state.ui.brand);
  }

  function buttonHex() {
    return normalizeHex(state.ui.buttonHex) || hexFromButton(state.ui.button);
  }

  function paintUiColors(brand, btn) {
    var style = document.getElementById('ui-override-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ui-override-style';
      document.body.appendChild(style);
    }
    style.textContent =
      '#topbar,#sidebar,.bg-umkm{background-color:' + brand + ' !important;}' +
      '.bg-emerald-600,.hover\\:bg-emerald-500:hover{background-color:' + btn + ' !important;}' +
      'html.dark #topbar,html.dark #sidebar{background-color:' + brand + ' !important;}';
    ['topbar', 'sidebar'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.setProperty('background-color', brand, 'important');
    });
    document.querySelectorAll('.bg-umkm').forEach(function (el) {
      el.style.setProperty('background-color', brand, 'important');
    });
    document.querySelectorAll('.bg-emerald-600').forEach(function (el) {
      el.style.setProperty('background-color', btn, 'important');
    });
  }

  /* Terapkan mode, warna, dan ukuran teks */
  function applyAppearance() {
    var dark = state.ui.theme === 'dark';
    var brand = brandHex();
    var btn = buttonHex();
    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.setAttribute('data-text', state.ui.text || 'sedang');
    root.style.setProperty('--brand', brand);
    root.style.setProperty('--btn', btn);
    paintUiColors(brand, btn);
    var moon = document.getElementById('theme-icon-moon');
    var sun = document.getElementById('theme-icon-sun');
    if (moon) moon.classList.toggle('hidden', dark);
    if (sun) sun.classList.toggle('hidden', !dark);
    renderUiOptions();
  }

  function applyTheme(dark) {
    state.ui.theme = dark ? 'dark' : 'light';
    saveUiPrefs();
    applyAppearance();
  }

  function toggleTheme() {
    applyTheme(state.ui.theme !== 'dark');
  }

  function setUiPref(key, value) {
    state.ui[key] = value;
    saveUiPrefs();
    applyAppearance();
  }

  function setCustomColor(kind, value) {
    var hex = normalizeHex(value);
    if (!hex) return;
    if (kind === 'brand') {
      state.ui.brand = 'custom';
      state.ui.brandHex = hex;
    } else {
      state.ui.button = 'custom';
      state.ui.buttonHex = hex;
    }
    saveUiPrefs();
    applyAppearance();
  }

  function loadSession() {
    try { state.user = JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || 'null'); } catch (e) { state.user = null; }
  }

  function saveSession() {
    if (state.user) localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.user));
    else localStorage.removeItem(STORAGE_KEYS.session);
  }

  function showLoginError(msg, ok) {
    var el = document.getElementById('login-error');
    if (!el) return;
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
      el.classList.remove('text-rose-600', 'text-emerald-700');
      return;
    }
    el.textContent = msg;
    el.classList.remove('hidden', 'text-rose-600', 'text-emerald-700');
    el.classList.add(ok ? 'text-emerald-700' : 'text-rose-600');
  }

  function setAuthMode(mode) {
    var loginForm = document.getElementById('form-login');
    var registerForm = document.getElementById('form-register');
    var title = document.getElementById('auth-title');
    var toggle = document.getElementById('btn-toggle-auth');
    var register = mode === 'register';
    if (loginForm) loginForm.classList.toggle('hidden', register);
    if (registerForm) registerForm.classList.toggle('hidden', !register);
    if (title) title.textContent = register ? 'Daftar Akun Baru' : 'Masuk ke Kasir';
    if (toggle) toggle.textContent = register ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar';
    showLoginError('');
  }

  function setAuthUi(loggedIn) {
    var login = document.getElementById('login-screen');
    var app = document.getElementById('app');
    if (login) login.classList.toggle('hidden', loggedIn);
    if (app) {
      if (loggedIn) app.classList.remove('hidden');
      else app.classList.add('hidden');
    }
    var userEl = document.getElementById('header-user');
    if (userEl) userEl.textContent = loggedIn && state.user ? state.user.username : '';
  }

  function enterApp() {
    loadLocalPrefs();
    setAuthUi(true);
    setPage('kasir');
    renderKasir();
    renderCart();
    showToast('Memuat data...');
    syncState().then(function () {
      showToast('Data tersinkron');
    }).catch(function (err) {
      showToast(err.message || 'Gagal terhubung ke database. Coba muat ulang.');
    });
  }

  function handleLogin(event) {
    event.preventDefault();
    var form = event.target;
    var username = formField(form, 'username').value.trim();
    var password = formField(form, 'password').value;
    if (!username || !password) return showLoginError('Username dan password wajib diisi');
    var btn = document.getElementById('btn-login');
    if (btn) btn.disabled = true;
    showLoginError('');
    sheetsPost(API_LOGIN, { action: 'login', username: username, password: password })
      .then(function (body) {
        if (!authOk(body)) throw new Error(body.message || body.error || 'Login gagal');
        state.user = { username: body.username || username };
        saveSession();
        enterApp();
      })
      .catch(function (err) { showLoginError(err.message || 'Login gagal'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function handleRegister(event) {
    event.preventDefault();
    var form = event.target;
    var username = formField(form, 'username').value.trim();
    var password = formField(form, 'password').value;
    var password2El = formField(form, 'password2');
    var password2 = password2El ? password2El.value : '';
    if (!username || !password) return showLoginError('Isi username dan password untuk daftar');
    if (username.length < 3) return showLoginError('Username minimal 3 karakter');
    if (password.length < 4) return showLoginError('Password minimal 4 karakter');
    if (password !== password2) return showLoginError('Password tidak sama');
    var btn = document.getElementById('btn-register');
    if (btn) btn.disabled = true;
    showLoginError('');
    sheetsPost(API_LOGIN, { action: 'register', username: username, password: password, name: username })
      .then(function (body) {
        if (!authOk(body)) throw new Error(body.message || body.error || 'Registrasi gagal');
        showLoginError(body.message || 'Akun berhasil dibuat. Masuk otomatis...', true);
        return sheetsPost(API_LOGIN, { action: 'login', username: username, password: password });
      })
      .then(function (body) {
        if (!authOk(body)) {
          setAuthMode('login');
          showLoginError('Akun dibuat. Silakan masuk.', true);
          return;
        }
        state.user = { username: body.username || username };
        saveSession();
        enterApp();
      })
      .catch(function (err) { showLoginError(err.message || 'Registrasi gagal'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function handleLogout() {
    state.user = null;
    state.products = [];
    state.batches = [];
    state.transactions = [];
    state.cart = [];
    saveSession();
    loadLocalPrefs();
    setAuthUi(false);
  }

  /* Inisialisasi aplikasi: preferensi lokal, event, lalu tarik data Sheets jika sudah login */
  function init() {
    loadSession();
    loadLocalPrefs();
    try {
      if (!localStorage.getItem(STORAGE_KEYS.ui) && localStorage.getItem('umkm_theme') === 'dark') {
        state.ui.theme = 'dark';
      }
    } catch (e) {}
    applyAppearance();
    renderNav();
    bindKasirEvents();
    var loginForm = document.getElementById('form-login');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    var registerForm = document.getElementById('form-register');
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    var toggleAuth = document.getElementById('btn-toggle-auth');
    if (toggleAuth) {
      toggleAuth.addEventListener('click', function () {
        var registerFormEl = document.getElementById('form-register');
        var registerVisible = registerFormEl && !registerFormEl.classList.contains('hidden');
        setAuthMode(registerVisible ? 'login' : 'register');
      });
    }
    var logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (state.user && state.user.username) enterApp();
    else setAuthUi(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
