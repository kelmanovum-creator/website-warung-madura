# Kasir UMKM - FIFO & Expired Control

Aplikasi kasir web dengan pengelolaan stok FIFO/FEFO, monitoring kedaluwarsa, laporan penjualan, dan database SQLite di server. Frontend statis (`index.html`, `app.js`), backend Node.js tanpa dependency eksternal (`server.js`), data di `data/umkm.db`.

## Menjalankan lokal

```bash
npm start
```

Buka `http://localhost:8000`.

Variabel lingkungan yang tersedia:

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `8000` | Port HTTP |
| `DB_FILE` | `./data/umkm.db` | Lokasi file database SQLite |
| `APP_USERNAME` | kosong | Username basic auth, kosongkan untuk menonaktifkan |
| `APP_PASSWORD` | kosong | Password basic auth |

Jika `APP_USERNAME` dan `APP_PASSWORD` diisi, seluruh halaman dan API dilindungi basic auth. Endpoint `/api/health` tetap terbuka untuk health check platform.

## Deploy ke Vercel (disarankan, gratis)

Frontend ini statis; data bisnis tersimpan di Google Sheets. Vercel hanya mengunggah `index.html` dan `app.js`.

1. Push repository ini ke GitHub.
2. Buka [vercel.com](https://vercel.com), **Add New Project**, pilih repo.
3. Framework Preset: **Other**. Build Command dan Install Command biarkan sesuai `vercel.json`.
4. Deploy. URL publik berformat `https://nama-proyek.vercel.app`.

Jika masih 500: di Settings > General, set Framework Preset ke **Other**, Output Directory `dist`, lalu Redeploy.

## Deploy ke Render (SQLite, berbayar)

Render adalah hosting yang mendukung disk persisten untuk SQLite.

1. Push repository ini ke GitHub.
2. Buka dashboard Render, pilih **New > Blueprint**.
3. Hubungkan repository, Render membaca `render.yaml` secara otomatis.
4. Isi `APP_USERNAME` dan `APP_PASSWORD` saat diminta.
5. Deploy. URL publik berformat `https://umkm-kasir-xxxx.onrender.com`.

Catatan biaya: disk persisten hanya tersedia pada plan **Starter** (sekitar USD 7/bulan). Pada plan Free, filesystem bersifat sementara sehingga data hilang setiap redeploy atau saat service tidur.

## Deploy ke Fly.io

```bash
fly launch --no-deploy
fly volumes create umkm_data --size 1 --region sin
fly secrets set APP_USERNAME=admin APP_PASSWORD=ganti-password-kuat
fly deploy
```

`fly.toml` sudah mengatur mount volume ke `/app/data`, health check, dan `force_https`.

## Deploy ke Railway

1. Buat project baru dari repository GitHub.
2. Tambahkan volume dan mount ke `/app/data`.
3. Set `DB_FILE=/app/data/umkm.db`.
4. Set `APP_USERNAME` dan `APP_PASSWORD`.
5. Railway memberi domain HTTPS otomatis.

## Deploy dengan Docker (VPS sendiri)

```bash
docker compose up -d --build
```

Data tersimpan di volume `umkm-data`. Untuk mengaktifkan proteksi, isi `APP_USERNAME` dan `APP_PASSWORD` di file `.env` sebelum menjalankan compose.

## Backup dan pemulihan

- Backup: menu **Pengaturan > Backup JSON** mengunduh seluruh data.
- Pemulihan: menu **Pengaturan > Restore JSON** mengunggah kembali file backup.
- Backup manual: salin file `data/umkm.db` (hentikan container dulu agar konsisten).

## Catatan keamanan

- Selalu aktifkan `APP_USERNAME` dan `APP_PASSWORD` saat aplikasi dapat diakses publik.
- Jalankan hanya satu instance karena SQLite tidak mendukung multi-writer.
- Gunakan HTTPS dari platform, jangan membuka port HTTP mentah ke internet.
