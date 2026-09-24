---
title: Multi Profile
aliases:
  - Multi-profile
  - Profile AWS
tags:
  - l-cli
  - authentication
  - guide
---

# Multi Profile

Simpan login AWS untuk beberapa account atau identitas sekaligus, lalu pilih profile
per project. Setiap profile memiliki credentials, refresh token, dan key DPoP sendiri.

## Menyiapkan profile

```sh
l login --profile production
l login --profile staging
l whoami --profile production
l whoami --profile staging
```

Selesaikan login browser dengan identitas yang sesuai untuk masing-masing profile.
Nama `production` dan `staging` hanya label lokal; CLI tidak menentukan account AWS
dari nama tersebut. Periksa output `Profile`, `Account`, dan `Identity` dari `whoami`.

Nama profile terdiri dari 1–64 huruf kecil, angka, underscore, atau hyphen, dengan
karakter pertama huruf/angka. Contoh: `production`, `team-a`, `dev_01`. Nama dengan
huruf besar, spasi, titik, atau separator path ditolak.

## Mengikat profile ke project

Dari folder project, jalankan:

```sh
l init --profile production
```

Wizard menyimpan field `profile` tanpa menanyakan ulang namanya. Jika menjalankan
`l init` tanpa option, wizard menanyakan profile dengan default dari config lama
atau `default`. Config juga dapat diedit langsung:

```json
{
  "version": 1,
  "name": "billing",
  "region": "ap-southeast-1",
  "profile": "production",
  "lambda": {
    "prefix": "billing-"
  }
}
```

Sesudahnya, command ini otomatis memakai `production`:

```sh
l whoami
l lambda list
l pull --prefix billing-
l push --all --dry-run
```

Lihat [[Project Configuration]] untuk schema lengkap, dan [[Pull and Push#Banyak function sekaligus]]
untuk pemilihan beberapa function. Init manual tetap dapat digunakan sebelum login.

## Prioritas pemilihan

| Sumber | Prioritas | Berlaku |
| --- | --- | --- |
| `--profile <nama>` | Pertama | Untuk command yang sedang dijalankan |
| `profile` dalam config project terdekat | Kedua | Default project, termasuk saat bekerja dari subfolder |
| `default` | Terakhir | Jika tidak ada option maupun profile project |

Aturan ini berlaku pada login, whoami, Lambda list/info, dan pull/push. Init memakai
config di folder saat ini, bukan config parent, karena membuat atau memperbarui
project di folder tersebut.

```sh
l lambda list --profile staging
l --profile staging lambda list
l whoami --profile default
```

Override tidak mengubah config project. `l init --profile staging` adalah cara
menyimpan perubahan pilihan profile melalui wizard. `-p` tetap berarti prefix Lambda;
gunakan bentuk panjang `--profile` untuk auth.

> [!important] Tidak ada fallback antar-profile
> Jika profile pilihan belum login atau session-nya rusak, command berhenti dengan
> error. Session `default` tidak digunakan sebagai pengganti diam-diam.

## Penyimpanan dan kompatibilitas

```text
~/.l/
├── session.json                 # profile default, termasuk session CLI lama
└── profiles/
    ├── production/session.json
    └── staging/session.json
```

Config lama tanpa `profile` tetap bekerja menggunakan `default`; tidak perlu
memindahkan session. Login ulang hanya mengganti session profile yang dipilih.
Refresh otomatis juga hanya memperbarui profile tersebut. Data rahasia tetap berada
di home pengguna, bukan di `l.config.json` atau vault dokumentasi.

Profile `l` terpisah dari profile AWS CLI di `~/.aws/config`; `AWS_PROFILE` tidak
memilih profile `l`. Belum tersedia command `l profile list`, switch global, logout,
atau penghapusan profile. Pilih profile melalui config atau option yang tersedia.

## Region, account, dan sync history

Region login mengikuti `l login --region`, `AWS_REGION`, `AWS_DEFAULT_REGION`, lalu
`ap-southeast-1`. Region ini disimpan untuk auth/refresh. Region resource mengikuti
`--region` pada command Lambda/pull/push, lalu region project, dan region session jika
command mendukung operasi tanpa project. Pull/push selalu memerlukan config project.

> [!warning] Berpindah account bukan berpindah folder kode
> Mengganti profile tidak memisahkan `lambda/` atau `.l/state.json`. Baseline tetap
> mengikat kode ke ARN/account/region asal. Gunakan folder project terpisah untuk
> account atau region berbeda. Profile dengan account dan region yang sama tetap
> harus lolos pemeriksaan identitas dan revision.

Login ulang dengan account lain pada nama profile yang sama memengaruhi semua
project yang menggunakan profile itu. Verifikasi `whoami` sebelum sinkronisasi.

## Refresh token kedaluwarsa

Gunakan nama profile dari pesan error:

```sh
l login --profile production
l whoami --profile production
```

Setelah berhasil, ulangi command semula. Detail pemulihan ada di [[Troubleshooting]],
sedangkan alur PKCE, DPoP, dan penyimpanan ada di [[Authentication and Session]].
