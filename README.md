# l

CLI untuk melihat informasi, mengunduh, dan memperbarui kode AWS Lambda, dengan login melalui browser.

Dokumentasi lengkap tersedia di [docs/Home.md](docs/Home.md). Folder `docs`
juga dapat dibuka langsung sebagai Obsidian vault.

## Persiapan

Gunakan Node.js 22 atau lebih baru.

```sh
npm ci
npm run build
npm link
```

## Penggunaan

```sh
l login
l whoami
l init
l lambda list
l lambda list --prefix my-service
l lambda info my-function
l pull
# Edit kode di lambda/<nama-function>/.
l push --dry-run
l push
```

Untuk beberapa function sekaligus:

```sh
l pull billing-api billing-worker
l push billing-api billing-worker --dry-run
l push billing-api billing-worker
l pull --prefix billing-
l push --all
```

`--all` mengikuti prefix project jika ada; tanpa prefix, pull mengambil semua
function AWS di region yang dipilih dan push memakai semua folder dalam `lambda/`.
Semua target diperiksa sebelum satu konfirmasi. Hasil ditampilkan per function;
jika eksekusi gagal, keberhasilan sebelumnya tetap tersimpan dan target berikutnya
dilewati. Detail ada di [Pull and Push](docs/Pull%20and%20Push.md).

Untuk menjalankan dari source tanpa `npm link`:

```sh
npm run dev -- lambda list
```

Region login mengikuti `AWS_REGION`, kemudian `AWS_DEFAULT_REGION`, dengan default
`ap-southeast-1`. Contoh:

```sh
AWS_REGION=ap-southeast-1 l login
```

`l init` menanyakan nama project, region resource, dan pilihan Lambda, kemudian
menampilkan ringkasan sebelum menyimpan `l.config.json` di folder saat ini. Pilih
function dari AWS, masukkan nama manual, gunakan prefix, atau lewati konfigurasi
Lambda. Mode manual/prefix/lewati dapat dipakai tanpa login.

Command Lambda mencari `l.config.json` terdekat dari folder saat ini ke parent.
Region mengikuti `--region`, config project, lalu session login. Jika function telah
dikonfigurasi, cukup jalankan `l lambda info`. Prefix project menjadi default
`l lambda list`, dan dapat diganti dengan `--prefix`.

Auth mendukung beberapa profile global. Pilihan mengikuti `--profile`, field
`profile` di `l.config.json`, lalu `default`. Contoh:

```sh
l login --profile production
l login --profile staging
l init --profile production
l whoami
l pull --all
l push --all --profile staging --dry-run
```

`l init` menyimpan nama profile dalam config project. Tanpa option, wizard menanyakan
profile terlebih dahulu. Semua command memakai profile yang dipilih, termasuk
refresh token. Profile yang belum login menghasilkan error tanpa beralih ke akun lain.
Detail tersedia di [Project Configuration](docs/Project%20Configuration.md).

Login menunggu callback browser maksimal lima menit. Browser mengarahkan pengguna
kembali ke terminal; login baru dinyatakan berhasil setelah penukaran token,
verifikasi identitas, dan penyimpanan session selesai.

Session `default` tetap tersimpan di `~/.l/session.json`; profile lain memakai
`~/.l/profiles/<profile>/session.json`. Masing-masing menyimpan credentials sementara, refresh
token, dan private key DPoP. Direktori memakai permission `0700` dan file `0600`
pada sistem POSIX. Credentials diperbarui otomatis saat mendekati expiry. Jalankan
`l login` kembali jika session tidak valid atau refresh token tidak bisa digunakan.

## Pengembangan

Pull/push mendukung paket ZIP dan memeriksa konflik revision AWS. Push memperbarui
kode `$LATEST`; state dan backup lokal disimpan di `.l/` project. Panduan packaging,
`.lignore`, serta pemulihan ada di [Pull and Push](docs/Pull%20and%20Push.md).

```sh
npm run typecheck
npm test
npm run build
```

Build menjalankan type-check sebelum bundling. Pengujian memakai server loopback,
file sementara, dan mock STS; tidak memerlukan login atau mengakses akun AWS.
