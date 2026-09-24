---
title: CLI Reference
aliases:
  - Command Reference
tags:
  - l-cli
  - reference
---

# CLI Reference

## Command global

```text
l [options] [command]
```

| Option | Fungsi |
| --- | --- |
| `-V`, `--version` | Menampilkan versi dari `package.json` |
| `-h`, `--help` | Menampilkan bantuan |
| `--profile <name>` | Mengganti profile project untuk command ini |

Prioritas auth: `--profile` → `profile` di config project terdekat → `default`.
Option global dapat ditulis sebelum atau sesudah command, termasuk subcommand
Lambda. `-p` tetap berarti prefix Lambda; profile hanya memakai `--profile`.
Contoh lengkap dan lokasi session tersedia di [[Multi Profile]].

## `l init`

Menginisialisasi konfigurasi project secara interaktif di folder saat ini.

```sh
l init
l init --profile production
```

Pertanyaannya: profile auth, nama project, region resource, mode konfigurasi Lambda, nama/prefix
atau pilihan function, lalu konfirmasi simpan. Mode Lambda yang tersedia:

- Pilih function dari AWS (memerlukan login).
- Masukkan nama function manual.
- Gunakan prefix nama function.
- Lewati konfigurasi Lambda.

File yang sudah ada memerlukan konfirmasi update; nilai lama menjadi default.
Jawaban batal tidak menulis file. Ctrl+C/EOF membatalkan input. File config yang
rusak harus diperbaiki terlebih dahulu. Command membutuhkan terminal interaktif;
tidak ada mode `--yes`, `--force`, atau input pipe saat ini.

Rincian schema dan perilaku project ada di [[Project Configuration]].
Jika `--profile` diberikan, pertanyaan profile dilewati dan nilai tersebut disimpan.

## `l login`

Mengautentikasi pengguna melalui AWS Sign-In di browser.

```sh
l login
l login --profile production
l login --profile staging --region us-east-1
```

Command ini:

1. Memilih profile dari option/config/default dan region auth dari `--region`,
   `AWS_REGION`, `AWS_DEFAULT_REGION`, lalu `ap-southeast-1`.
2. Membuat state OAuth, PKCE verifier/challenge, dan key DPoP.
3. Membuka callback server pada `127.0.0.1` dengan port acak.
4. Membuka AWS Sign-In di browser.
5. Menukar authorization code menjadi credentials sementara.
6. Memverifikasi credentials dengan STS.
7. Menyimpan session lokal hanya untuk profile yang dipilih.

`-r, --region <region>` mengatur region AWS Sign-In untuk login tersebut. Region
project tetap khusus resource Lambda. Detail keamanan ada di [[Authentication and Session]].

## `l whoami`

Menampilkan identitas AWS dari session profile yang dipilih.

```sh
l whoami
l whoami --profile production
```

Output berisi:

| Field | Sumber |
| --- | --- |
| `Profile` | Profile yang dipilih dari option/config/default |
| `Account` | Respons STS `GetCallerIdentity` |
| `Identity` | ARN dari respons STS |
| `Region` | Session login |
| `Expires` | Credentials yang dipakai oleh STS |

Jika credentials mendekati expiry, provider mencoba memperbaruinya lebih dulu.

## `l lambda list`

Mengambil seluruh halaman `ListFunctions` lalu menampilkan function sebagai tabel.

```sh
l lambda list
l lambda list --prefix billing-
l lambda list -p billing-
```

| Option | Wajib | Fungsi |
| --- | --- | --- |
| `-p`, `--prefix <prefix>` | Tidak | Menampilkan nama function yang diawali prefix |
| `-r`, `--region <region>` | Tidak | Mengganti region resource untuk command ini |

Default prefix berasal dari project. Option `--prefix` menggantinya; gunakan
`--prefix ""` untuk menampilkan seluruh function. Region mengikuti option CLI,
config project, kemudian session login.

Filter prefix diterapkan setelah semua halaman diambil. Kolom output saat ini:
`name`, `runtime`, `memory`, dan `timeout`.

Izin AWS yang dibutuhkan: `lambda:ListFunctions`.

## `l lambda info`

Menampilkan konfigurasi satu Lambda function.

```sh
l lambda info billing-worker
l lambda info
l lambda info billing-worker --region us-east-1
```

Argumen `name` opsional jika project menyimpan `lambda.functionName`. Nama eksplisit
menggantikan nilai project. Option `-r, --region <region>` menggantikan region project.
`name` dapat berupa nama function atau identifier lain yang diterima AWS SDK untuk
`GetFunction`. Output mencakup runtime, handler, memory, timeout, architecture,
state, status update terakhir, waktu modifikasi, dan execution role.

Izin AWS yang dibutuhkan: `lambda:GetFunction`.

## `l pull` dan `l push`

```sh
l pull [names...]
l push [names...]
l pull billing-api --region us-east-1
l pull billing-api billing-worker
l push billing-api billing-worker --dry-run
l pull --prefix billing-
l push --all --dry-run
l push --dry-run
l push --yes
l pull --all --profile production --dry-run
```

Memerlukan project config. Beberapa nama argumen diproses dalam satu command.
Tanpa argumen/selector, target berasal dari config function atau pilihan satu
function berdasarkan prefix. Kode ada di `lambda/<nama-function>/`.

| Option | Fungsi |
| --- | --- |
| `-r, --region <region>` | Mengganti region project |
| `--dry-run` | Preview tanpa menerapkan perubahan |
| `-y, --yes` | Lewati konfirmasi normal; konflik tetap ditolak |
| `--all` | Semua function AWS (pull) atau folder lokal (push), mengikuti prefix config jika ada |
| `-p, --prefix <prefix>` | Semua target dengan prefix ini, menggantikan prefix config |
| `--profile <name>` | Option global untuk memilih session auth pada seluruh batch |

Nama eksplisit tidak dapat digabung dengan `--all`/`--prefix`. Tanpa prefix config,
`--all` mencakup seluruh target meskipun `lambda.functionName` dikonfigurasi.
Seluruh target diperiksa sebelum satu konfirmasi. Push pertama tanpa baseline
tetap meminta persetujuan. Kegagalan eksekusi menghentikan target berikutnya;
keberhasilan sebelumnya tetap diterapkan. Ringkasan mencatat hasil per function.
Detail izin AWS, packaging, backup, dan pemulihan tersedia di [[Pull and Push]].

## Exit status

- `0`: command selesai tanpa error.
- `1`: action command melempar error, termasuk session tidak tersedia, akses AWS
  ditolak, atau resource gagal dibaca.
- `130`: input interaktif `l init` dibatalkan dengan Ctrl+C/EOF. Menjawab tidak pada
  konfirmasi init dianggap pembatalan normal dengan status `0`.

Pembatalan prompt pull/push juga menghasilkan status `130`; menjawab tidak pada
konfirmasi normal menghasilkan status `0` tanpa menerapkan operasi.

Pesan error ditulis ke standard error. Output tabel dan status normal ditulis ke
standard output.
