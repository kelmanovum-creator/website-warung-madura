(function () {
  'use strict';

  var STORAGE_KEYS = {
    batches: 'umkm_batches_v1',
    cart: 'umkm_cart_v1',
    transactions: 'umkm_trx_v1',
    products: 'umkm_products_v1',
    settings: 'umkm_settings_v1'
  };

  var PAGES = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'kasir', label: 'Kasir' },
    { id: 'produk', label: 'Produk' },
    { id: 'stok', label: 'Stok' },
    { id: 'expired', label: 'Expired' },
    { id: 'riwayat', label: 'Riwayat' },
    { id: 'laporan', label: 'Laporan' },
    { id: 'pengaturan', label: 'Pengaturan' }
  ];

  var PAGE_SUB = {
    dashboard: 'Ringkasan omzet, stok, dan kedaluwarsa',
    kasir: 'Katalog & Kasir FIFO',
    produk: 'Master produk UMKM',
    stok: 'Input & daftar batch stok',
    expired: 'Monitoring H-7 kedaluwarsa',
    riwayat: 'Riwayat transaksi kasir',
    laporan: 'Riwayat transaksi otomatis',
    pengaturan: 'Toko, pajak, dan backup data'
  };

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
    lastTrx: null
  };

  /* Baca data dari LocalStorage dan isi state aplikasi */
  function loadState() {
    try { state.batches = JSON.parse(localStorage.getItem(STORAGE_KEYS.batches) || '[]'); } catch (e) { state.batches = []; }
    try { state.cart = JSON.parse(localStorage.getItem(STORAGE_KEYS.cart) || '[]'); } catch (e) { state.cart = []; }
    try { state.transactions = JSON.parse(localStorage.getItem(STORAGE_KEYS.transactions) || '[]'); } catch (e) { state.transactions = []; }
    try { state.products = JSON.parse(localStorage.getItem(STORAGE_KEYS.products) || '[]'); } catch (e) { state.products = []; }
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || 'null');
      if (s) state.settings = Object.assign(state.settings, s);
    } catch (e) {}
    if (!Array.isArray(state.batches)) state.batches = [];
    if (!Array.isArray(state.cart)) state.cart = [];
    if (!Array.isArray(state.transactions)) state.transactions = [];
    if (!Array.isArray(state.products)) state.products = [];
    seedDummyCatalog();
  }

  /* Isi 6 produk dummy agar kartu Kasir langsung tampil saat stok kosong */
  function dummyCatalog() {
    return [
      { name: 'Indomie Goreng', stock: 20, price: 3500, location: 'A-01', expiredDate: '2026-12-31', category: 'Makanan' },
      { name: 'Aqua 600ml', stock: 15, price: 3000, location: 'B-02', expiredDate: '2026-10-20', category: 'Minuman' },
      { name: 'Minyak Goreng', stock: 10, price: 18000, location: 'A-03', expiredDate: '2026-10-10', category: 'Sembako' },
      { name: 'Gula 1kg', stock: 8, price: 17000, location: 'A-04', expiredDate: '2026-10-07', category: 'Sembako' },
      { name: 'Susu UHT', stock: 12, price: 8000, location: 'C-01', expiredDate: '2026-11-15', category: 'Minuman' },
      { name: 'Teh Botol', stock: 18, price: 4000, location: 'B-05', expiredDate: '2026-10-25', category: 'Minuman' }
    ];
  }

  function seedDummyCatalog() {
    var demo = dummyCatalog();
    if (!state.batches.length) {
      state.batches = demo.map(function (p, i) {
        return {
          id: 'B-DEMO-' + (i + 1),
          name: p.name,
          stock: p.stock,
          price: p.price,
          location: p.location,
          expiredDate: p.expiredDate,
          createdAt: '2026-09-01T00:00:00.000Z'
        };
      });
    }
    if (!state.products.length) {
      state.products = demo.map(function (p, i) {
        return {
          id: 'P-DEMO-' + (i + 1),
          sku: 'SKU-' + (1001 + i),
          name: p.name,
          category: p.category,
          sellPrice: p.price,
          buyPrice: Math.round(p.price * 0.8),
          minStock: 5,
          unit: 'pcs',
          location: p.location
        };
      });
    }
    saveState();
  }

  /* Simpan seluruh state ke LocalStorage agar data persisten */
  function saveState() {
    localStorage.setItem(STORAGE_KEYS.batches, JSON.stringify(state.batches));
    localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(state.cart));
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(state.transactions));
    localStorage.setItem(STORAGE_KEYS.products, JSON.stringify(state.products));
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
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
    saveState();
    renderKasir();
    renderCart();
  }

  /* Kurangi stok dari batch expired paling awal (inti FIFO/FEFO) */
  function consumeFifo(productName, qty) {
    var batches = fifoBatches(productName);
    var remain = qty;
    var used = [];
    for (var i = 0; i < batches.length && remain > 0; i++) {
      var take = Math.min(Number(batches[i].stock), remain);
      batches[i].stock = Number(batches[i].stock) - take;
      remain -= take;
      used.push({
        batchId: batches[i].id,
        name: batches[i].name,
        qty: take,
        expiredDate: batches[i].expiredDate,
        location: batches[i].location,
        price: Number(batches[i].price) || 0
      });
    }
    if (remain > 0) return { ok: false, used: used, remain: remain };
    return { ok: true, used: used, remain: 0 };
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

  /* Checkout keranjang: validasi stok, bayar, lalu catat transaksi FIFO */
  function checkout() {
    if (!state.cart.length) return showToast('Keranjang kosong');
    var i;
    for (i = 0; i < state.cart.length; i++) {
      var c = state.cart[i];
      if (availableStock(c.name) < c.qty) {
        return showToast('Stok ' + c.name + ' tidak cukup');
      }
    }
    var total = cartTotal();
    var paid = cartPaid();
    if (state.payMethod === 'tunai' && paid < total) {
      return showToast('Uang diterima kurang');
    }
    if (state.payMethod !== 'tunai') paid = total;
    var lines = [];
    state.cart.forEach(function (item) {
      var result = consumeFifo(item.name, item.qty);
      result.used.forEach(function (u) {
        u.price = item.price;
        lines.push(u);
      });
    });
    var trx = {
      id: 'TRX-' + Date.now(),
      at: new Date().toISOString(),
      cashier: state.settings.cashierName || 'Kasir',
      payMethod: state.payMethod,
      paid: paid,
      change: Math.max(0, paid - total),
      discount: cartDiscount(),
      tax: cartTax(),
      subtotal: cartSubtotal(),
      lines: lines,
      total: total
    };
    state.transactions.unshift(trx);
    state.cart = [];
    state.lastTrx = trx;
    var discEl = document.getElementById('cart-discount');
    var paidEl = document.getElementById('cart-paid');
    if (discEl) discEl.value = '0';
    if (paidEl) paidEl.value = '0';
    saveState();
    closeCart();
    renderKasir();
    renderCart();
    showSuccess(trx);
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
      btn.classList.toggle('text-emerald-700', active);
      btn.classList.toggle('text-white', false);
      btn.classList.toggle('bg-emerald-700', false);
      btn.classList.toggle('text-slate-400', !active);
      if (btn.closest('#side-nav')) {
        btn.classList.toggle('bg-emerald-700', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('text-emerald-100', !active);
      }
    });
    var sub = document.getElementById('header-sub');
    if (sub) sub.textContent = PAGE_SUB[page] || '';
    if (page === 'kasir') {
      renderKasir();
      renderCart();
    }
  }

  function renderNav() {
    var side = document.getElementById('side-nav');
    var bottom = document.getElementById('bottom-nav');
    var mobileItems = PAGES.slice(0, 4);
    if (side) {
      side.innerHTML = PAGES.map(function (p) {
        return '<button data-page="' + p.id + '" class="nav-btn w-full text-left px-3 py-2 rounded-xl text-emerald-100" type="button">' + p.label + '</button>';
      }).join('');
    }
    if (bottom) {
      bottom.className = 'bg-white rounded-2xl card-shadow border border-emerald-100 grid grid-cols-4 overflow-hidden py-1';
      bottom.innerHTML = mobileItems.map(function (p) {
        return '<button data-page="' + p.id + '" class="nav-btn text-[11px] font-semibold text-slate-400 py-2" type="button">' + p.label + '</button>';
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

  /* Simpan batch baru dari form input barang (fitur existing Stok) */
  function handleSaveBatch(event) {
    event.preventDefault();
    var form = event.target;
    var name = form.name.value.trim();
    var stock = parseInt(form.stock.value, 10);
    var price = parseInt(form.price.value, 10);
    var location = form.location.value.trim();
    var expiredDate = form.expiredDate.value;
    if (!name || !location || !expiredDate || stock < 1 || price < 0 || isNaN(stock) || isNaN(price)) {
      return showToast('Lengkapi data barang dengan benar');
    }
    state.batches.push({
      id: 'B-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: name,
      stock: stock,
      price: price,
      location: location,
      expiredDate: expiredDate,
      createdAt: new Date().toISOString()
    });
    saveState();
    form.reset();
    renderKasir();
    showToast('Batch disimpan (FIFO)');
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
    var notif = document.getElementById('btn-notif');
    if (notif) notif.addEventListener('click', function () { setPage('expired'); });
  }

  /* Inisialisasi aplikasi: muat data, ikat event, render Kasir */
  function init() {
    loadState();
    renderNav();
    bindKasirEvents();
    setPage('kasir');
    renderKasir();
    renderCart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
