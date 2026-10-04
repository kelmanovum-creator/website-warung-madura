/**
 * Pengujian FIFO mandiri (tanpa browser).
 * Simpan 2 batch nama sama, expired berbeda, checkout, pastikan batch
 * expired lebih awal berkurang lebih dulu.
 */

function fifoBatches(batches, productName) {
  const key = productName.trim().toLowerCase();
  return batches
    .filter(function (b) { return b.name.trim().toLowerCase() === key && b.stock > 0; })
    .sort(function (a, b) { return a.expiredDate.localeCompare(b.expiredDate); });
}

function consumeFifo(batches, productName, qty) {
  const ordered = fifoBatches(batches, productName);
  let remain = qty;
  const used = [];
  for (let i = 0; i < ordered.length && remain > 0; i++) {
    const take = Math.min(ordered[i].stock, remain);
    ordered[i].stock -= take;
    remain -= take;
    used.push({ batchId: ordered[i].id, qty: take, expiredDate: ordered[i].expiredDate });
  }
  return { ok: remain === 0, used: used, remain: remain };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('PASS:', msg);
  }
}

const batches = [
  { id: 'B-late', name: 'Susu UHT', stock: 10, expiredDate: '2026-12-31' },
  { id: 'B-early', name: 'Susu UHT', stock: 5, expiredDate: '2026-10-10' }
];

const result = consumeFifo(batches, 'Susu UHT', 7);

assert(result.ok, 'checkout 7 pcs harus cukup dari total stok 15');
assert(result.used.length === 2, 'harus memakai 2 batch (5 dari early + 2 dari late)');
assert(result.used[0].batchId === 'B-early' && result.used[0].qty === 5, 'batch expired lebih awal habis dulu (5)');
assert(result.used[1].batchId === 'B-late' && result.used[1].qty === 2, 'sisa 2 diambil dari batch expired belakangan');
assert(batches.find(function (b) { return b.id === 'B-early'; }).stock === 0, 'stok batch early = 0');
assert(batches.find(function (b) { return b.id === 'B-late'; }).stock === 8, 'stok batch late = 8');

const insufficient = consumeFifo(
  [{ id: 'X', name: 'Teh', stock: 2, expiredDate: '2026-11-01' }],
  'Teh',
  5
);
assert(!insufficient.ok && insufficient.remain === 3, 'stok kurang harus gagal dengan sisa 3');

if (process.exitCode) {
  console.error('FIFO tests failed');
  process.exit(1);
}
console.log('Semua uji FIFO lulus.');
