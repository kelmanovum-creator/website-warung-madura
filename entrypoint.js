'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dataFile = process.env.DB_FILE || path.join(__dirname, 'data', 'umkm.db');
const dataDir = path.dirname(dataFile);

fs.mkdirSync(dataDir, { recursive: true });

const targetUid = Number(process.env.APP_UID) || 1000;
const targetGid = Number(process.env.APP_GID) || 1000;

try {
  fs.chownSync(dataDir, targetUid, targetGid);
  for (const entry of fs.readdirSync(dataDir)) {
    try { fs.chownSync(path.join(dataDir, entry), targetUid, targetGid); } catch (err) { /* ignore */ }
  }
} catch (err) {
  console.warn('Tidak dapat mengubah kepemilikan folder data:', err.message);
}

if (process.getuid && process.getuid() === 0 && targetUid !== 0) {
  try {
    process.setgid(targetGid);
    process.setuid(targetUid);
  } catch (err) {
    console.warn('Gagal menurunkan hak akses, lanjut sebagai root:', err.message);
  }
}

require('./server.js');
