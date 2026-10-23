'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'umkm.db');
const PORT = Number(process.env.PORT) || 8000;
const MAX_BODY = 2 * 1024 * 1024;
const APP_USERNAME = process.env.APP_USERNAME || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_ENABLED = Boolean(APP_USERNAME && APP_PASSWORD);

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category TEXT DEFAULT 'Umum',
    sell_price INTEGER NOT NULL DEFAULT 0,
    buy_price INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 5,
    unit TEXT DEFAULT 'pcs',
    location TEXT
  );
  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE,
    stock INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    expired_date TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_batches_name ON batches(name);
  CREATE INDEX IF NOT EXISTS idx_batches_exp ON batches(expired_date);
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    cashier TEXT,
    pay_method TEXT,
    paid INTEGER NOT NULL DEFAULT 0,
    change_amount INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    tax INTEGER NOT NULL DEFAULT 0,
    subtotal INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS transaction_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    batch_id TEXT,
    name TEXT,
    qty INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    expired_date TEXT,
    location TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_lines_trx ON transaction_lines(trx_id);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const DEFAULT_SETTINGS = { storeName: 'UMKM Kasir', cashierName: 'Kasir', taxPercent: 0 };

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  rows.forEach((row) => {
    if (row.key === 'taxPercent') {
      const n = Number(row.value);
      settings.taxPercent = Number.isFinite(n) ? n : 0;
    } else {
      settings[row.key] = row.value;
    }
  });
  return settings;
}

function writeSettings(patch) {
  const allowed = ['storeName', 'cashierName', 'taxPercent'];
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  allowed.forEach((key) => {
    if (patch[key] === undefined || patch[key] === null) return;
    let value = patch[key];
    if (key === 'taxPercent') {
      value = Number(value);
      if (!Number.isFinite(value)) value = 0;
      value = Math.min(Math.max(value, 0), 100);
    } else {
      value = String(value).trim();
    }
    stmt.run(key, String(value));
  });
}

function seedIfEmpty() {
  const seeded = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
  if (seeded) return;
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (count > 0) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
    return;
  }

  const demo = [
    { name: 'Indomie Goreng', stock: 20, price: 3500, location: 'A-01', expiredDate: '2026-12-31', category: 'Makanan' },
    { name: 'Aqua 600ml', stock: 15, price: 3000, location: 'B-02', expiredDate: '2026-10-20', category: 'Minuman' },
    { name: 'Minyak Goreng', stock: 10, price: 18000, location: 'A-03', expiredDate: '2026-10-10', category: 'Sembako' },
    { name: 'Gula 1kg', stock: 8, price: 17000, location: 'A-04', expiredDate: '2026-10-07', category: 'Sembako' },
    { name: 'Susu UHT', stock: 12, price: 8000, location: 'C-01', expiredDate: '2026-11-15', category: 'Minuman' },
    { name: 'Teh Botol', stock: 18, price: 4000, location: 'B-05', expiredDate: '2026-10-25', category: 'Minuman' }
  ];

  const insertProduct = db.prepare(
    `INSERT INTO products (id, sku, name, category, sell_price, buy_price, min_stock, unit, location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertBatch = db.prepare(
    `INSERT INTO batches (id, name, stock, price, location, expired_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    demo.forEach((p, i) => {
      insertProduct.run(
        'P-DEMO-' + (i + 1), 'SKU-' + (1001 + i), p.name, p.category,
        p.price, Math.round(p.price * 0.8), 5, 'pcs', p.location
      );
      insertBatch.run(
        'B-DEMO-' + (i + 1), p.name, p.stock, p.price, p.location,
        p.expiredDate, '2026-09-01T00:00:00.000Z'
      );
    });
    writeSettings(DEFAULT_SETTINGS);
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function mapProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    sellPrice: Number(row.sell_price) || 0,
    buyPrice: Number(row.buy_price) || 0,
    minStock: Number(row.min_stock) || 0,
    unit: row.unit,
    location: row.location
  };
}

function mapBatch(row) {
  return {
    id: row.id,
    name: row.name,
    stock: Number(row.stock) || 0,
    price: Number(row.price) || 0,
    location: row.location,
    expiredDate: row.expired_date,
    createdAt: row.created_at
  };
}

function mapTransaction(row, lines) {
  return {
    id: row.id,
    at: row.at,
    cashier: row.cashier,
    payMethod: row.pay_method,
    paid: Number(row.paid) || 0,
    change: Number(row.change_amount) || 0,
    discount: Number(row.discount) || 0,
    tax: Number(row.tax) || 0,
    subtotal: Number(row.subtotal) || 0,
    total: Number(row.total) || 0,
    lines: lines || []
  };
}

function loadTransactions(limit) {
  const sql = 'SELECT * FROM transactions ORDER BY at DESC, id DESC' + (limit ? ' LIMIT ' + Number(limit) : '');
  const rows = db.prepare(sql).all();
  if (!rows.length) return [];
  const lineStmt = db.prepare('SELECT * FROM transaction_lines WHERE trx_id = ? ORDER BY id ASC');
  return rows.map((row) => mapTransaction(
    row,
    lineStmt.all(row.id).map((l) => ({
      batchId: l.batch_id,
      name: l.name,
      qty: Number(l.qty) || 0,
      price: Number(l.price) || 0,
      expiredDate: l.expired_date,
      location: l.location
    }))
  ));
}

function getState() {
  const products = db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE ASC').all().map(mapProduct);
  const batches = db.prepare('SELECT * FROM batches ORDER BY name COLLATE NOCASE ASC, expired_date ASC').all().map(mapBatch);
  return {
    products,
    batches,
    transactions: loadTransactions(),
    settings: readSettings()
  };
}

function normalizeName(name) {
  return String(name || '').trim();
}

function catalogPrice(name) {
  const product = db.prepare('SELECT sell_price FROM products WHERE name = ? COLLATE NOCASE').get(name);
  if (product && Number(product.sell_price) > 0) return Number(product.sell_price);
  const batch = db.prepare(
    'SELECT price FROM batches WHERE name = ? COLLATE NOCASE AND stock > 0 ORDER BY expired_date ASC, created_at ASC LIMIT 1'
  ).get(name);
  return batch ? Number(batch.price) || 0 : null;
}

function createBatch(payload) {
  const name = normalizeName(payload.name);
  const stock = Math.floor(Number(payload.stock));
  const price = Math.floor(Number(payload.price));
  const location = String(payload.location || '').trim();
  const expiredDate = String(payload.expiredDate || '').trim();
  const category = String(payload.category || '').trim() || 'Umum';

  if (!name) throw new ApiError(400, 'Nama barang wajib diisi');
  if (!Number.isFinite(stock) || stock < 1) throw new ApiError(400, 'Stok minimal 1');
  if (!Number.isFinite(price) || price < 0) throw new ApiError(400, 'Harga tidak valid');
  if (!location) throw new ApiError(400, 'Lokasi rak wajib diisi');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiredDate)) throw new ApiError(400, 'Tanggal expired tidak valid');

  const id = 'B-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const createdAt = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM products WHERE name = ? COLLATE NOCASE').get(name);
    if (existing) {
      db.prepare(
        `UPDATE products SET sell_price = ?, location = ? WHERE id = ?`
      ).run(price, location, existing.id);
      if (payload.category && String(payload.category).trim()) {
        db.prepare('UPDATE products SET category = ? WHERE id = ?').run(category, existing.id);
      }
    } else {
      const productId = 'P-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      db.prepare(
        `INSERT INTO products (id, sku, name, category, sell_price, buy_price, min_stock, unit, location)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        productId,
        'SKU-' + (1000 + db.prepare('SELECT COUNT(*) AS n FROM products').get().n + 1),
        name, category, price, Math.round(price * 0.8), 5, 'pcs', location
      );
    }
    db.prepare(
      `INSERT INTO batches (id, name, stock, price, location, expired_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, stock, price, location, expiredDate, createdAt);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const row = db.prepare('SELECT * FROM batches WHERE id = ?').get(id);
  return mapBatch(row);
}

function deleteBatch(id) {
  const exists = db.prepare('SELECT id FROM batches WHERE id = ?').get(id);
  if (!exists) throw new ApiError(404, 'Batch tidak ditemukan');
  db.prepare('DELETE FROM batches WHERE id = ?').run(id);
}

function checkout(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new ApiError(400, 'Keranjang kosong');
  const payMethod = ['tunai', 'qris', 'transfer', 'debit'].indexOf(payload.payMethod) !== -1
    ? payload.payMethod
    : 'tunai';

  db.exec('BEGIN IMMEDIATE');
  try {
    const lines = [];
    let subtotal = 0;

    items.forEach((item) => {
      const name = normalizeName(item.name);
      const qty = Math.floor(Number(item.qty));
      if (!name || !Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(400, 'Item keranjang tidak valid');
      }
      const price = catalogPrice(name);
      if (price === null) throw new ApiError(404, 'Produk ' + name + ' tidak ditemukan');

      const batches = db.prepare(
        `SELECT * FROM batches
         WHERE name = ? COLLATE NOCASE AND stock > 0
         ORDER BY (expired_date IS NULL) ASC, expired_date ASC, created_at ASC, id ASC`
      ).all(name);
      const available = batches.reduce((sum, b) => sum + Number(b.stock), 0);
      if (available < qty) throw new ApiError(409, 'Stok ' + name + ' tidak cukup (tersedia ' + available + ')');

      let remain = qty;
      for (const batch of batches) {
        if (remain <= 0) break;
        const take = Math.min(Number(batch.stock), remain);
        db.prepare('UPDATE batches SET stock = stock - ? WHERE id = ?').run(take, batch.id);
        lines.push({
          batchId: batch.id,
          name: batch.name,
          qty: take,
          price,
          expiredDate: batch.expired_date,
          location: batch.location
        });
        subtotal += take * price;
        remain -= take;
      }
    });

    let discount = Math.floor(Number(payload.discount) || 0);
    if (discount < 0) discount = 0;
    if (discount > subtotal) discount = subtotal;

    const taxPercent = Number(readSettings().taxPercent) || 0;
    const tax = Math.round((subtotal - discount) * taxPercent / 100);
    const total = subtotal - discount + tax;

    let paid;
    if (payMethod === 'tunai') {
      paid = Math.floor(Number(payload.paid) || 0);
      if (paid < total) throw new ApiError(400, 'Uang diterima kurang dari total');
    } else {
      paid = total;
    }
    const change = Math.max(0, paid - total);

    const id = 'TRX-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const at = new Date().toISOString();
    const settings = readSettings();
    const cashier = normalizeName(payload.cashier) || settings.cashierName || 'Kasir';

    db.prepare(
      `INSERT INTO transactions
       (id, at, cashier, pay_method, paid, change_amount, discount, tax, subtotal, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, at, cashier, payMethod, paid, change, discount, tax, subtotal, total);

    const insertLine = db.prepare(
      `INSERT INTO transaction_lines (trx_id, batch_id, name, qty, price, expired_date, location)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    lines.forEach((line) => {
      insertLine.run(id, line.batchId, line.name, line.qty, line.price, line.expiredDate, line.location);
    });

    db.exec('COMMIT');

    return {
      id,
      at,
      cashier,
      payMethod,
      paid,
      change,
      discount,
      tax,
      subtotal,
      total,
      lines
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function resetData() {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM transaction_lines').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM batches').run();
    db.prepare('DELETE FROM products').run();
    db.prepare('DELETE FROM settings').run();
    db.prepare("DELETE FROM meta WHERE key = 'seeded'").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  seedIfEmpty();
  return { ok: true };
}

function restoreData(payload) {
  const products = Array.isArray(payload.products) ? payload.products : [];
  const batches = Array.isArray(payload.batches) ? payload.batches : [];
  const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};

  if (!products.length && !batches.length && !transactions.length) {
    throw new ApiError(400, 'File backup tidak berisi data');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM transaction_lines').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM batches').run();
    db.prepare('DELETE FROM products').run();
    db.prepare('DELETE FROM settings').run();

    const insertProduct = db.prepare(
      `INSERT INTO products (id, sku, name, category, sell_price, buy_price, min_stock, unit, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    products.forEach((p, i) => {
      const name = normalizeName(p.name);
      if (!name) return;
      insertProduct.run(
        String(p.id || 'P-' + Date.now() + '-' + i),
        String(p.sku || 'SKU-' + (1000 + i)),
        name,
        String(p.category || 'Umum'),
        Math.max(0, Math.floor(Number(p.sellPrice) || 0)),
        Math.max(0, Math.floor(Number(p.buyPrice) || 0)),
        Math.max(0, Math.floor(Number(p.minStock) || 0)),
        String(p.unit || 'pcs'),
        String(p.location || '')
      );
    });

    const insertBatch = db.prepare(
      `INSERT INTO batches (id, name, stock, price, location, expired_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    batches.forEach((b, i) => {
      const name = normalizeName(b.name);
      if (!name) return;
      insertBatch.run(
        String(b.id || 'B-' + Date.now() + '-' + i),
        name,
        Math.max(0, Math.floor(Number(b.stock) || 0)),
        Math.max(0, Math.floor(Number(b.price) || 0)),
        String(b.location || ''),
        b.expiredDate ? String(b.expiredDate) : null,
        String(b.createdAt || new Date().toISOString())
      );
    });

    const insertTrx = db.prepare(
      `INSERT INTO transactions
       (id, at, cashier, pay_method, paid, change_amount, discount, tax, subtotal, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertLine = db.prepare(
      `INSERT INTO transaction_lines (trx_id, batch_id, name, qty, price, expired_date, location)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    transactions.forEach((t, i) => {
      const id = String(t.id || 'TRX-' + Date.now() + '-' + i);
      insertTrx.run(
        id,
        String(t.at || new Date().toISOString()),
        String(t.cashier || 'Kasir'),
        String(t.payMethod || 'tunai'),
        Math.floor(Number(t.paid) || 0),
        Math.floor(Number(t.change) || 0),
        Math.floor(Number(t.discount) || 0),
        Math.floor(Number(t.tax) || 0),
        Math.floor(Number(t.subtotal) || 0),
        Math.floor(Number(t.total) || 0)
      );
      (Array.isArray(t.lines) ? t.lines : []).forEach((l) => {
        insertLine.run(
          id,
          l.batchId ? String(l.batchId) : null,
          String(l.name || ''),
          Math.floor(Number(l.qty) || 0),
          Math.floor(Number(l.price) || 0),
          l.expiredDate ? String(l.expiredDate) : null,
          l.location ? String(l.location) : null
        );
      });
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  writeSettings(Object.assign({}, DEFAULT_SETTINGS, settings));
  db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
  return { ok: true };
}

function transactionFilter(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  let rows = db.prepare('SELECT * FROM transactions ORDER BY at DESC').all();
  if (from) rows = rows.filter((r) => localDateKey(r.at) >= from);
  if (to) rows = rows.filter((r) => localDateKey(r.at) <= to);
  return rows;
}

function localDateKey(iso) {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv(url) {
  const rows = transactionFilter(url);
  const header = ['id', 'tanggal', 'kasir', 'metode', 'subtotal', 'diskon', 'pajak', 'total', 'dibayar', 'kembalian'];
  const lines = [header.join(',')];
  rows.forEach((t) => {
    lines.push([
      t.id, t.at, t.cashier, t.pay_method, t.subtotal, t.discount,
      t.tax, t.total, t.paid, t.change_amount
    ].map(csvEscape).join(','));
  });
  return lines.join('\n');
}

function exportBackup() {
  return {
    app: 'umkm-kasir',
    version: 1,
    exportedAt: new Date().toISOString(),
    products: db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE ASC').all().map(mapProduct),
    batches: db.prepare('SELECT * FROM batches ORDER BY name COLLATE NOCASE ASC, expired_date ASC').all().map(mapBatch),
    transactions: loadTransactions(),
    settings: readSettings()
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store'
  }, extraHeaders || {}));
  res.end(data);
}

function sendText(res, status, body, type, extraHeaders) {
  res.writeHead(status, Object.assign({
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, extraHeaders || {}));
  res.end(body);
}

function downloadName(ext) {
  return 'umkm-laporan-' + localDateKey(new Date().toISOString()) + '.' + ext;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'Data terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new ApiError(400, 'JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.resolve(ROOT, '.' + rel);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return sendText(res, 403, 'Forbidden');
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!MIME[ext]) return sendText(res, 404, 'Not found');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[ext],
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const method = req.method;
  const parts = url.pathname.split('/').filter(Boolean);
  const action = parts[1];

  if (method === 'GET' && action === 'health') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString(), db: DB_FILE });
  }

  if (method === 'GET' && action === 'state') {
    return sendJson(res, 200, getState());
  }

  if (method === 'GET' && action === 'export') {
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
    if (format === 'csv') {
      return sendText(res, 200, exportCsv(url), 'text/csv; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="' + downloadName('csv') + '"'
      });
    }
    return sendJson(res, 200, exportBackup(), {
      'Content-Disposition': 'attachment; filename="' + downloadName('json') + '"'
    });
  }

  if (method === 'POST' && action === 'batches') {
    const body = await readBody(req);
    return sendJson(res, 201, createBatch(body));
  }

  if (method === 'DELETE' && action === 'batches' && parts[2]) {
    deleteBatch(decodeURIComponent(parts[2]));
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && action === 'checkout') {
    const body = await readBody(req);
    return sendJson(res, 201, checkout(body));
  }

  if (method === 'PUT' && action === 'settings') {
    const body = await readBody(req);
    writeSettings(body);
    return sendJson(res, 200, readSettings());
  }

  if (method === 'POST' && action === 'reset') {
    resetData();
    return sendJson(res, 200, getState());
  }

  if (method === 'POST' && action === 'restore') {
    const body = await readBody(req);
    restoreData(body);
    return sendJson(res, 200, getState());
  }

  throw new ApiError(404, 'Endpoint tidak ditemukan');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* Basic auth opsional: aktif hanya jika APP_USERNAME dan APP_PASSWORD diisi */
function isAuthorized(req) {
  if (!AUTH_ENABLED) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch (err) {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator === -1) return false;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const userOk = safeEqual(username, APP_USERNAME);
  const passOk = safeEqual(password, APP_PASSWORD);
  return userOk && passOk;
}

seedIfEmpty();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const isHealth = url.pathname === '/api/health';

  if (AUTH_ENABLED && !isHealth && !isAuthorized(req)) {
    res.writeHead(401, {
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="UMKM Kasir", charset="UTF-8"',
      'Cache-Control': 'no-store'
    });
    return res.end('Autentikasi diperlukan');
  }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      const status = err instanceof ApiError ? err.status : 500;
      if (status >= 500) console.error(err);
      sendJson(res, status, { error: err.message || 'Terjadi kesalahan server' });
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method not allowed');
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('UMKM Kasir server running on http://0.0.0.0:' + PORT);
  console.log('Database: ' + DB_FILE);
  console.log('Basic auth: ' + (AUTH_ENABLED ? 'aktif' : 'nonaktif (APP_USERNAME/APP_PASSWORD kosong)'));
});

function shutdown() {
  try { db.close(); } catch (err) { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
