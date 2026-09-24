---
title: Getting Started
aliases:
  - Instalasi
  - Quick Start
tags:
  - l-cli
  - guide
---

# Getting Started

## Prasyarat

- Node.js 22 atau lebih baru
- npm
- Browser yang dapat dibuka dari terminal
- Identitas AWS yang memiliki izin Lambda sesuai dengan command yang dipakai

## Instalasi untuk pengembangan lokal

Dari root project:

```sh
npm ci
npm run build
npm link
```

`npm link` mendaftarkan executable `l` secara global dari checkout lokal. Setelah
itu, pastikan CLI dapat ditemukan:

```sh
l --version
l --help
```

> [!tip] Tanpa npm link
> Jalankan source secara langsung dengan `npm run dev -- <command>`, misalnya
> `npm run dev -- lambda list`.

Setelah package tersedia di registry npm, pengguna dapat memasang dengan
`npm install -g @ricko-v/l`. Panduan penerbitannya ada di [[Publishing]].

## Login pertama

```sh
l login
l login --profile production
```

CLI membuka halaman AWS Sign-In di browser dan menunggu callback maksimal lima
menit. Setelah browser menerima respons otorisasi, lihat terminal untuk hasil akhir.
Login baru berhasil setelah credentials diverifikasi dan session tersimpan.

Region dipilih dengan urutan berikut:

1. `--region` pada `l login`
2. `AWS_REGION`
3. `AWS_DEFAULT_REGION`
4. `ap-southeast-1`

Contoh memilih region secara eksplisit:

```sh
l login --profile production --region us-east-1
```

Region tersebut disimpan bersama session untuk login/refresh auth serta sebagai
fallback region Lambda jika project belum memiliki konfigurasi.
Lihat [[Authentication and Session]] untuk rincian alur dan data lokal.
`l login` tanpa `--profile` memakai profile project terdekat atau `default`.
Untuk beberapa account, ikuti [[Multi Profile]].

## Memastikan identitas

```sh
l whoami
l whoami --profile production
```

Periksa profile, account ID, ARN, region, dan waktu expiry sebelum mengakses Lambda.

## Inisialisasi project

Dari folder project, jalankan:

```sh
l init
l init --profile production
```

Pilih salah satu command di atas. Tanpa `--profile`, wizard menanyakan profile terlebih
dahulu. Jawab pertanyaan nama project, region resource, dan konfigurasi Lambda. Masukkan
nomor pilihan lalu tekan Enter. Ringkasan JSON ditampilkan sebelum konfirmasi simpan.
Hasilnya adalah `l.config.json`; auth tetap disimpan secara global.

Pilihan manual, prefix, dan lewati tersedia tanpa login. Memilih function langsung
dari AWS memerlukan session login dan izin `lambda:ListFunctions`.

Lihat [[Project Configuration]] untuk format file dan aturan default.

## Mencoba command Lambda

```sh
l lambda list
l lambda list --prefix my-service
l lambda info my-function
l lambda info
l lambda list --region us-east-1
```

Command `l lambda list` dan `l lambda info` hanya membaca data AWS. Penjelasan
setiap argumen dan output ada di [[CLI Reference]]. `l lambda info` tanpa nama
menggunakan function yang dipilih saat init.

## Langkah berikutnya

- [[Multi Profile]] untuk pemilihan profile per project dan override command
- [[Pull and Push]] untuk mengunduh kode, mengedit, dan memperbarui `$LATEST`
- [[CLI Reference]] untuk seluruh command
- [[Troubleshooting]] jika login atau akses AWS gagal
- [[Development]] jika ingin menambah command
