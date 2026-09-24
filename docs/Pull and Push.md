---
title: Pull and Push
aliases:
  - l pull
  - l push
tags:
  - l-cli
  - deployment
---

# Pull and Push

`l pull` mengunduh paket deployment Lambda. `l push` mengemas file lokal dan
memperbarui kode `$LATEST` pada function yang sudah ada. Auth tetap global;
target dan region awal berasal dari [[Project Configuration]].
Profile mengikuti `--profile`, field `profile` project, lalu `default`, dan
ditampilkan sebelum preview. Profile yang sama dipakai untuk listing, download,
upload, dan refresh credentials selama command berjalan.

## Penggunaan

```sh
l login
l init
l pull
# Edit kode di lambda/<nama-function>/ dan jalankan build jika diperlukan.
l push --dry-run
l push
```

Target dapat berupa satu atau beberapa nama function. Tanpa argumen/selector, CLI
tetap memakai `lambda.functionName` atau meminta pilihan satu function dari prefix
project. Nama harus berupa nama function tanpa ARN, alias, atau version.

```sh
l pull billing-api
l push billing-api
l pull billing-api --region us-east-1
l pull billing-api billing-worker
l push billing-api billing-worker --dry-run
l push billing-api billing-worker
l pull --prefix billing-
l push --all
```

| Option | Fungsi |
| --- | --- |
| `-r, --region <region>` | Mengganti region project |
| `--all` | Semua target yang cocok dengan prefix project, jika dikonfigurasi |
| `-p, --prefix <prefix>` | Semua target dengan prefix ini, menggantikan prefix project |
| `--dry-run` | Preview tanpa menerapkan perubahan |
| `-y, --yes` | Lewati konfirmasi normal; konflik tetap ditolak |

Dry-run tetap melakukan operasi baca AWS. Dry-run push memvalidasi paket secara
lokal, tanpa memanggil API update untuk memvalidasi IAM atau kelayakan deployment.
Push pertama tanpa baseline tetap membutuhkan persetujuan eksplisit meskipun
menggunakan `--yes`. Pemilihan satu function dari prefix config dan konfirmasi
membutuhkan terminal interaktif; `--all`/`--prefix` tidak membuka pemilihan function.

## Banyak function sekaligus

| Cara memilih | Pull | Push |
| --- | --- | --- |
| `l pull api worker` / `l push api worker` | Nama eksplisit | Nama eksplisit, folder lokal harus tersedia |
| `--all` | Daftar function AWS di region yang dipilih | Folder function dalam `lambda/` lokal |
| `--prefix billing-` | Semua nama AWS berawalan `billing-` | Semua folder lokal berawalan `billing-` |

`--all` mengikuti `lambda.prefix` jika ada. Tanpa prefix config, cakupannya seluruh
function AWS untuk pull atau seluruh folder function lokal untuk push, termasuk
ketika config hanya berisi `lambda.functionName`. Gunakan `--dry-run` untuk meninjau
daftar dan perubahan. Push massal tidak mengambil daftar target dari AWS.

Nama eksplisit tidak dapat digabung dengan `--all` atau `--prefix`. Nama yang
berulang hanya diproses sekali, sesuai urutan argumen. Target dari selector diurutkan
berdasarkan nama. Tidak ada target yang cocok menghasilkan error.

Semua target diperiksa dan paket disiapkan sebelum satu konfirmasi gabungan. Jika
satu target gagal pada tahap pemeriksaan awal, tidak ada kode atau baseline yang
diubah. Konflik lokal pada pull dengan `--yes` juga membatalkan seluruh batch.
Jika ada push pertama tanpa baseline, konfirmasi tetap diperlukan meskipun memakai
`--yes`. Function push tanpa perubahan dilewati dengan status `unchanged`.

Setelah persetujuan, seluruh target diperiksa kembali sebelum perubahan pertama,
lalu diterapkan satu per satu dengan pemeriksaan tambahan per target. Satu lock
project melindungi keseluruhan operasi. ZIP disimpan sementara di direktori temp
sistem agar seluruh paket tidak ditahan di memori sekaligus; file ini dibersihkan
saat command selesai atau gagal, termasuk pada dry-run.

Ringkasan menampilkan hasil setiap function: `success`, `failed`, `skipped`,
`unchanged`, `preview` untuk dry-run, atau `cancelled` jika konfirmasi ditolak.
Kegagalan saat eksekusi menghentikan target berikutnya dan menghasilkan exit status
`1`. Function yang sudah berhasil tetap diterapkan dan state-nya tetap tersimpan.
Batch bukan transaksi atomik antar-function; tidak ada rollback AWS otomatis.
Periksa target gagal sebelum mencoba ulang hanya nama yang masih perlu diproses:

```sh
l push billing-worker billing-cron --dry-run
l push billing-worker billing-cron
```

## Struktur folder

```text
project/
├── l.config.json
├── .lignore
├── .gitignore
├── lambda/
│   └── billing-api/
│       ├── index.js
│       └── node_modules/
└── .l/
    ├── state.json
    ├── sync.lock
    └── backups/
        └── <function>-<timestamp>-<id>/
            ├── code/
            └── state.json
```

Project root adalah lokasi `l.config.json` terdekat. Command dari subfolder tetap
membaca/menulis `lambda/<nama>/` di project root. Folder `.l/` project menyimpan
state, lock sementara, dan backup; `~/.l/` tetap menyimpan auth global.
Rule `/.l/` ditambahkan ke `.gitignore` sebelum perubahan diterapkan.

State mengikat folder function ke ARN lengkap, termasuk account dan region.
Sinkronisasi ditolak jika login/region menunjuk identitas lain. Gunakan login/region
semula atau project terpisah untuk account/region lain.

## Pull

Paket yang diunduh adalah kode yang terpasang di AWS. Hasilnya mungkin berupa bundle
atau binary; source TypeScript dan repository asli tidak selalu tersedia.

CLI memverifikasi checksum SHA-256 paket dan CRC entry ZIP. Path traversal, nama
duplikat atau bentrok huruf besar/kecil, symlink, file khusus, dan ZIP terenkripsi
ditolak. Paket disiapkan dahulu sebelum folder tujuan diganti.

Preview menampilkan file ditambah, berubah, dan dihapus. Bila ada perubahan lokal
sejak sinkronisasi terakhir, CLI meminta konfirmasi penggantian; `--yes` tidak dapat
melewati konflik ini. Folder lama disimpan utuh di backup sebelum paket baru
dipasang. Kegagalan pemasangan/state memicu upaya pemulihan folder lama.

Pull tidak melakukan merge. File lokal tambahan di folder function, termasuk file
yang dikecualikan `.lignore`, dapat hilang dari folder aktif tetapi tetap ada dalam
backup. Pembatalan tidak mengubah kode/baseline, walaupun folder `.l/` kosong dapat
tersisa dari pembuatan lock.

## Push

Revision AWS dibandingkan dengan hasil pull/push terakhir. Jika berbeda, push
berhenti dan meminta pengguna mengambil serta meninjau remote terbaru. `--yes`
tidak melewati pemeriksaan ini. Push pertama membandingkan file lokal dengan paket
remote dan meminta konfirmasi target tanpa baseline tersimpan.

Isi folder function berada langsung pada root ZIP. Sebelum upload, snapshot lokal
dan metadata remote diperiksa kembali. Request update menyertakan `RevisionId`
untuk mencegah perubahan remote di antara pemeriksaan dan upload.

CLI menampilkan account, region, ARN, perubahan file, dan ukuran ZIP, lalu meminta
konfirmasi. Setelah upload, CLI menunggu maksimal 120 detik per function dan memverifikasi
checksum serta status `Successful` sebelum memajukan state.

Upload gagal, timeout, atau update yang ditimpa process lain tidak memajukan state.
AWS mungkin telah menerima kode ketika koneksi terputus; periksa status AWS sebelum
mencoba ulang. `$LATEST` dapat dipakai invocation tanpa version/alias. Push tidak
membuat version baru, memindahkan alias, atau mengubah environment, runtime, role,
memory, layers, dan konfigurasi function lainnya.

## Packaging dan ignore

Buat `.lignore` di project root. Pola mengikuti gitignore dan dihitung relatif
terhadap folder kode masing-masing function:

```gitignore
.env
.env.*
*.test.js
tests/
coverage/
*.map
```

`.git`, `.l`, `.lignore`, dan `l.config.json` selalu dikecualikan pada tingkat mana
pun. Dependencies runtime seperti `node_modules` tetap masuk kecuali di-ignore.
File lain, termasuk dotfiles, dapat ikut upload; atur pola sesuai kebutuhan.

CLI tidak menjalankan install/build/script project. Siapkan output siap deploy
sebelum push. Permission file dinormalisasi ke `0644` atau `0755` jika executable.
Empty directories tidak disertakan dalam ZIP hasil push.

## Batasan dan izin

- Hanya function ZIP yang sudah ada; container image dan pembuatan function belum didukung.
- Upload langsung maksimal 50 MiB compressed; S3 upload belum didukung.
- Setiap paket dibatasi 250 MiB uncompressed dan 10.000 entry. Layer ikut dihitung AWS
  dalam batas deployment, sehingga validasi akhir tetap dilakukan AWS.
- Symlink yang tidak di-ignore ditolak, termasuk symlink dependency.
- Tidak ada penandatanganan ulang paket, automatic merge, atau rollback AWS.
- Pull memerlukan `lambda:GetFunction`. Push juga memerlukan
  `lambda:UpdateFunctionCode`. Pull dengan `--all`/`--prefix` dan pemilihan satu
  function dari prefix config memerlukan `lambda:ListFunctions`. Push dengan
  `--all`/`--prefix` memilih folder lokal sehingga tidak memerlukan izin listing.

Referensi: [GetFunction](https://docs.aws.amazon.com/lambda/latest/api/API_GetFunction.html),
[UpdateFunctionCode](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionCode.html),
dan [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

## Pemulihan

**Perubahan lokal tertimpa:** bandingkan `code/` dalam backup dengan kode terbaru,
lalu salin perubahan yang masih diperlukan. Pertahankan state terbaru sebagai
pembanding remote; review hasil penggabungan lewat `l push --dry-run`.

**Konflik revision:** backup pekerjaan lokal, pull remote terbaru, lalu gabungkan
kembali perubahan dari backup. Jangan menghapus state untuk melewati konflik.

**AWS update berhasil tetapi state gagal disimpan:** perbaiki masalah disk,
backup kode lokal, lalu pull untuk menyamakan kode dan revision.

**Process berhenti mendadak:** periksa PID dan waktu dalam `.l/sync.lock`. Hapus
lock usang hanya setelah memastikan process telah berhenti. Tinjau backup dan
`pull-stage-*` jika process terhenti saat pergantian folder. State yang rusak dapat
dipulihkan dari backup yang sesuai sebelum melakukan sinkronisasi lagi.

Lihat [[Troubleshooting]] dan [[CLI Reference]].
