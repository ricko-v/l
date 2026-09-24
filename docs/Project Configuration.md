---
title: Project Configuration
aliases:
  - l init
  - Konfigurasi Project
tags:
  - l-cli
  - configuration
  - guide
---

# Project Configuration

## Memulai

Jalankan `l init` dari folder project. Command menanyakan konfigurasi lebih dulu,
menampilkan ringkasan JSON, lalu menyimpan ke `l.config.json` setelah konfirmasi.

```text
AWS profile (default): production
Project name (billing-service):
AWS resource region (ap-southeast-1):

Lambda configuration
  1. Select existing function from AWS
  2. Enter function name manually
  3. Use a function name prefix
  4. Skip Lambda configuration
Choose [1-4] (2): 2
Lambda function name: billing-api
...
Save l.config.json? [Y/n]:
```

Menu memakai nomor lalu Enter. Nama project diambil dari config lama, `package.json`,
atau nama folder. Region default mengikuti config lama, `AWS_REGION`,
`AWS_DEFAULT_REGION`, session profile yang dipilih, lalu `ap-southeast-1`.
Profile default wizard berasal dari config lama atau `default`. `l init --profile
production` langsung memakai profile tersebut tanpa menanyakan nama profile lagi.

Memilih function dari AWS membutuhkan login dan izin `lambda:ListFunctions`.
Semua halaman daftar diambil, kemudian nama diurutkan dan ditampilkan. Opsi Back
mengembalikan pengguna ke mode konfigurasi. Jika daftar kosong atau AWS gagal,
pengguna bisa memilih mode manual, prefix, atau lewati.

Mode manual hanya memvalidasi format nama; keberadaan function belum diverifikasi.
`l init` tidak membuat atau mengubah resource AWS.

## Schema versi 1

```json
{
  "version": 1,
  "name": "billing-service",
  "region": "ap-southeast-1",
  "profile": "production",
  "lambda": {
    "functionName": "billing-api"
  }
}
```

| Field | Aturan |
| --- | --- |
| `version` | Wajib; saat ini hanya `1` |
| `name` | Wajib; string yang tidak kosong |
| `region` | Wajib; format region, misalnya `ap-southeast-1` atau `us-gov-west-1` |
| `profile` | Opsional; default `default`. Nama 1–64 huruf kecil, angka, underscore atau hyphen; diawali huruf/angka |
| `lambda` | Opsional; tepat satu dari `functionName` atau `prefix` |
| `lambda.functionName` | Nama 1–64 huruf, angka, underscore, atau hyphen |
| `lambda.prefix` | Prefix 1–64 huruf, angka, underscore, atau hyphen |

Nama profile tidak boleh memakai nama device Windows seperti `con`, `nul`,
`com1`–`com9`, atau `lpt1`–`lpt9`. Nama function AWS yang valid tetapi tidak dapat
dipakai sebagai nama folder lokal akan ditolak saat pull/push.

Jika memilih prefix, bagian Lambda menjadi:

```json
{
  "lambda": {
    "prefix": "billing-"
  }
}
```

Contoh kedua hanya cuplikan bagian `lambda`; field wajib tetap harus disertakan.
Mode lewati menghilangkan field `lambda`. Field lain di luar schema ditolak.
Validasi region memeriksa format, bukan ketersediaan region di account AWS.

## Auth global

Config ini dapat disimpan bersama source project; hanya nama profile yang dicatat.
Session `default` memakai `~/.l/session.json`, sedangkan profile lain memakai
`~/.l/profiles/<profile>/session.json`. Login pada satu profile hanya mengganti
session profile tersebut. Config lama tanpa field `profile` tetap memakai `default`
tanpa migrasi file session. Lihat [[Authentication and Session]].
Panduan penggunaan beberapa account dari awal tersedia di [[Multi Profile]].

```sh
l login --profile production
l login --profile staging
l init --profile production
l whoami
l lambda list --profile staging
```

Nama profile adalah label lokal untuk login `l`, bukan profile AWS CLI dari
`~/.aws/config`. `AWS_PROFILE` tidak dipakai untuk memilih profile `l`.
Profile yang belum login/rusak menghentikan command; tidak ada fallback ke `default`.
CLI hanya memvalidasi format nama pada config sehingga init manual tetap bisa offline.

Region config adalah region resource Lambda. Region session adalah region auth
untuk AWS Sign-In, refresh, serta `whoami`; keduanya boleh berbeda.

## Default command

Command Lambda mencari `l.config.json` dari current directory naik ke parent sampai
menemukan file terdekat. File yang rusak menghentikan pencarian; tidak dilewati
diam-diam. `l init` sendiri selalu membuat/memperbarui config di current directory.

| Nilai | Urutan prioritas |
| --- | --- |
| Profile auth | `--profile` → `profile` project → `default` |
| Region Lambda | `--region` → `region` project → region session profile |
| Prefix list | `--prefix` → `lambda.prefix` → tanpa filter |
| Nama info | argumen nama → `lambda.functionName` → error jika tidak tersedia |

```sh
l lambda info
l lambda info another-function --region us-east-1
l lambda list
l lambda list --prefix other-
l lambda list --prefix ""
```

Nama function yang dikonfigurasi tidak memfilter `lambda list`; hanya prefix yang
menjadi filter default. Tanpa config, command Lambda tetap dapat dipakai seperti
sebelumnya dengan region dari session dan nama info eksplisit.

## Update dan pembatalan

Command [[Pull and Push]] menggunakan config yang sama, menyimpan kode pada
`lambda/<nama-function>/`, dan mencatat ARN serta revision di `.l/state.json`.
Tidak ada field config tambahan untuk folder kode pada versi ini.
Mengganti profile tidak menghapus pemeriksaan ARN/account pada sync history. Untuk
account atau region lain, gunakan folder project terpisah; profile berbeda dengan
identitas account dan region yang sama tetap dapat memakai baseline yang sama.

Jalankan kembali `l init` untuk mengubah project. Wizard meminta persetujuan update
dan memakai nilai lama sebagai default. Tidak ada `--force` atau mode noninteraktif.
File JSON yang rusak atau versi yang tidak didukung harus diperbaiki terlebih dulu.

Menjawab tidak pada konfirmasi tidak menulis file. Ctrl+C/EOF membatalkan input.
Penulisan menggunakan file sementara lalu publikasi atomik melalui hard link untuk
config baru. Jika sistem menolak atau tidak mendukung hard link (misalnya Termux),
CLI memakai salinan eksklusif yang tetap gagal jika tujuan sudah ada. Salinan ini
tidak atomik: proses lain dapat membaca file yang belum lengkap saat penyalinan,
dan penghentian paksa dapat meninggalkan config parsial. Periksa/perbaiki JSON jika
proses terhenti saat menyimpan. Untuk update, wizard
memeriksa kembali isi file sebelum menggantinya; ini bukan mekanisme locking antar
process. Hindari mengubah file secara bersamaan saat konfirmasi simpan berlangsung.

Lihat [[CLI Reference]] untuk command dan [[Troubleshooting]] untuk pesan error.
