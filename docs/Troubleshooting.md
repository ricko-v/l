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

## Windows dan Linux

- **Windows: `EPERM`/`EBUSY` saat rename atau mengganti folder:** tutup proses yang
  masih membuka file target dan periksa izin folder. CLI mempertahankan pemeriksaan
  konflik; jangan menghapus config/state untuk memaksa update.
- **Windows: nama profile ditolak:** hindari nama device seperti `con`, `nul`,
  `com1`, dan `lpt1`. Aturan ini juga diterapkan di OS lain untuk portabilitas.
- **Windows: executable Lambda:** mode executable file yang sudah dikenal mengikuti
  baseline deployment. File baru memakai `0644`; gunakan Linux/WSL atau macOS untuk
  menyiapkan executable baru. Lihat [[Pull and Push#Windows dan permission executable]].
- **Linux: browser tidak terbuka:** buka URL login yang ditampilkan pada browser di
  komputer yang sama. CLI tetap menunggu callback; browser di komputer lain melalui
  SSH tidak otomatis dapat menjangkau `127.0.0.1` milik proses CLI.
- **Native dependency:** CLI tidak menjalankan build. Siapkan binary/dependency untuk
  OS Linux dan architecture Lambda yang dituju, bukan binary Windows/macOS lokal.

Referensi: [batasan filesystem Node.js](https://nodejs.org/api/fs.html),
[aturan nama file Windows](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).

## Termux: `EACCES: permission denied, link`

Jika pesan menyebut `.l.config-*.tmp` dan `l.config.json`, kegagalan terjadi saat
`l init` menyimpan config baru, setelah file sementara berhasil ditulis. Android
dapat membatasi operasi hard link di Termux. Implementasi terbaru mencoba salinan
eksklusif jika hard link ditolak; config yang sudah ada tetap tidak ditimpa.
Perbaikan ini belum terdapat pada package npm versi `2.0.0`.

Sambil menunggu rilis perbaikan, buat `l.config.json` secara manual di folder
project **jika file belum ada**, dengan isi berikut:

```json
{
  "version": 1,
  "name": "my-project",
  "region": "ap-southeast-1",
  "profile": "default"
}
```

Sesuaikan nama, region, dan profile, lalu jalankan `l init` lagi untuk memilih
function/prefix. Update config yang sudah ada menggunakan rename, bukan hard link.
Jika file sudah ada, periksa dan edit file tersebut; jangan menimpanya dengan contoh
ini. Jika salinan juga menghasilkan `EACCES`, periksa izin tulis folder/file.

Referensi: [laporan hard link di Termux](https://github.com/termux/termux-app/issues/837).

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
