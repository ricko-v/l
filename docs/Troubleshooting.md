---
title: Troubleshooting
aliases:
  - Pemecahan Masalah
  - FAQ
tags:
  - l-cli
  - troubleshooting
---

# Troubleshooting

## `Not authenticated. Run l login first.`

File session belum tersedia. Jalankan:

```sh
l login
```

Untuk profile bernama, gunakan nama dari pesan error, misalnya `l login --profile
production`. Profile project tidak otomatis memakai session `default` walaupun
profile default sudah login. Periksa identitas dengan `l whoami --profile production`.

Jika login baru saja selesai, pastikan command dijalankan oleh user sistem operasi
yang sama karena session berada di home directory user tersebut.

## `Invalid AWS session. Run l login again.`

Isi `~/.l/session.json` rusak, tidak lengkap, atau expiry bukan tanggal yang valid.
Jalankan login ulang. Jangan mencoba memperbaiki credential secara manual.
Untuk profile bernama, file berada di `~/.l/profiles/<profile>/session.json`.

## `Cannot read AWS session`

File ada tetapi tidak dapat dibaca. Periksa owner dan permission directory/file.
Nilai yang diharapkan pada macOS/Linux:

```sh
ls -ld ~/.l
ls -l ~/.l/session.json
```

Directory seharusnya hanya dapat diakses user (`0700`) dan file hanya dapat dibaca
atau ditulis user (`0600`). Login berikutnya juga mencoba memperketat permission.

## Profile salah atau tidak ditemukan

Periksa `profile` di config terdekat dan option `--profile` pada command. Option
menggantikan pilihan project. Nama profile menggunakan huruf kecil, tanpa spasi,
titik, atau separator path. `AWS_PROFILE` tidak dipakai CLI ini.

```sh
l whoami --profile production
l login --profile production
```

Session bernama berada di `~/.l/profiles/<profile>/session.json`. Hindari symlink
pada directory/file profile karena ditolak. Jika perlu account lain untuk kode yang
sudah dipull, gunakan project terpisah agar baseline ARN tetap sesuai.
Lihat [[Multi Profile]] untuk aturan pemilihan dan kompatibilitas session lama.

## Login timeout

Pesan `AWS login timed out` muncul jika callback tidak diterima dalam lima menit.

Periksa hal berikut:

- browser berhasil terbuka;
- proses `l login` masih berjalan;
- halaman AWS Sign-In tidak diblokir extension atau kebijakan jaringan;
- redirect menuju alamat `127.0.0.1` dapat dibuka dari browser yang sama.

Lalu jalankan `l login` kembali. Setiap percobaan memiliki state, PKCE verifier, dan
key DPoP baru.

## OAuth state mismatch

Callback berasal dari flow lain atau URL callback tidak lengkap. Kembali ke tab
yang dibuka oleh percobaan login terakhir. Jika tetap gagal, tutup flow lama dan
jalankan `l login` kembali.

## Refresh session gagal

Jika AWS mengembalikan `The refresh token has expired`, CLI menampilkan:

```text
Refreshing AWS session...
AWS session expired for profile "default": the refresh token has expired. Run `l login --profile default` to sign in again, then retry your command.
```

Command yang membutuhkan credentials berhenti dengan error; `l init` menampilkan
pesan tersebut dan tetap menawarkan konfigurasi manual. Jalankan `l login`, lalu
ulangi command awal. Kegagalan jaringan atau permission tetap menampilkan error
aslinya agar penyebabnya tidak tertukar dengan session kedaluwarsa.

Refresh token dapat kedaluwarsa atau ditolak. Jalankan login ulang:

```sh
l login
l whoami
```

## `AccessDeniedException`

Login berhasil, tetapi identity tidak mempunyai izin untuk operasi yang diminta.

| Command | Izin yang perlu diperiksa |
| --- | --- |
| `l whoami` | Tidak memerlukan izin eksplisit untuk `sts:GetCallerIdentity` |
| `l lambda list` | `lambda:ListFunctions` |
| `l lambda info <name>` | `lambda:GetFunction` |

Periksa juga account dan region dengan `l whoami`. IAM policy harus diperbaiki oleh
pihak yang mengelola akses account AWS.

## Function tidak ditemukan

Pastikan nama dan region benar:

```sh
l whoami
l lambda list --prefix nama-awal
```

Region Lambda mengikuti `--region`, project, lalu session login. Periksa
`l.config.json`, atau coba `l lambda list --region <region>`. Region di `l whoami`
adalah region auth, sehingga bisa berbeda dari region resource.

## Init membutuhkan terminal interaktif

Jalankan `l init` langsung di terminal. Piping atau redirect stdin/stdout tidak
didukung. Masukkan nomor pilihan dan tekan Enter; Ctrl+C membatalkan input.

## Init gagal mengambil daftar Lambda

Pastikan telah menjalankan `l login` dan mempunyai izin `lambda:ListFunctions` di
region resource yang dipilih. Jika daftar kosong atau request gagal, wizard kembali
ke pilihan mode. Nama manual, prefix, dan lewati tetap dapat digunakan.

## Config project rusak atau berubah selama init

Error `Invalid l.config.json` menghentikan proses agar file lama tetap tersedia.
Perbaiki format sesuai [[Project Configuration]], lalu jalankan ulang.

Jika file berubah selama wizard berjalan atau muncul `EEXIST`, tinjau config
terbaru dan ulangi `l init`. Config yang sudah ada memerlukan persetujuan update.

## `listen EPERM` saat test

Test callback perlu membuka server pada loopback. Beberapa sandbox melarang operasi
ini. Jalankan `npm test` langsung pada host lokal atau izinkan akses loopback untuk
process Node. Error ini tidak menunjukkan kegagalan implementasi callback di host
yang mengizinkan loopback.

## Pull atau push gagal

- **Preflight failed:** ada target yang gagal pemeriksaan awal. Belum ada kode atau
  baseline function yang berubah; perbaiki target berstatus `failed`, lalu ulangi.
- **Sync stopped after a failure:** tinjau ringkasan. Target `success` tetap diterapkan,
  target `skipped` belum dijalankan. Periksa AWS pada push yang gagal karena upload
  mungkin diterima sebelum error. Ulangi hanya nama target yang masih diperlukan.
- **Remote revision conflict:** backup perubahan lokal, pull, lalu gabungkan perubahan
  sebelum push ulang. `--yes` tidak melewati konflik.
- **Local changes need explicit review:** ulangi pull tanpa `--yes`, tinjau perubahan,
  lalu konfirmasi backup/penggantian jika sesuai.
- **Account or region differs:** gunakan login/region semula atau project terpisah.
- **Update timed out:** periksa AWS terlebih dulu; kode mungkin sudah ter-upload
  meskipun state lokal belum maju.
- **Another sync may be running:** periksa process dalam `.l/sync.lock` sebelum
  menghapus lock yang usang.

Rincian pemulihan dan batas ukuran paket ada di [[Pull and Push]].

## File lokal ikut masuk paket npm

Periksa `files` di `package.json` dan hasil `npm pack --dry-run`. Folder lokal tidak
perlu dihapus untuk dikecualikan. `files`, `.gitignore`, dan `.lignore` mengatur hal
berbeda; langkah pengecekan dan rilis ada di [[Publishing]].

## Build gagal

Jalankan pemeriksaan secara terpisah:

```sh
node --version
npm ci
npm run typecheck
npm test
npm run build
```

Versi Node harus 22 atau lebih baru. Jika type-check gagal, selesaikan error source
terlebih dahulu; script build memang menghentikan bundling ketika type-check gagal.

Masih perlu memahami alurnya? Lihat [[Authentication and Session]] atau
[[Architecture]].
