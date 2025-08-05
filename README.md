# L

<pre>
   l
    L      L - Alat sederhana untuk mengelola fungsi AWS Lambda
   L L     Versi: 1.0.4
  L   L    Repositori: https://github.com/ricko-v/l
 L     L   Penggunaan: l &lt;perintah&gt [opsi]
L       L
</pre>

`L` adalah alat baris perintah yang sederhana namun kuat untuk mengelola fungsi AWS Lambda Anda. Alat ini dirancang untuk menyederhanakan alur kerja pengembangan, deployment, dan manajemen fungsi Lambda.

## Install

```
npm i -g @ricko-v/l
```

## Penggunaan

```
l <perintah> [opsi]
```

## Perintah yang Tersedia

| Perintah        | Deskripsi                                |
| --------------- | ---------------------------------------- |
| `init`          | Menginisialisasi proyek `L`.             |
| `sync-lambda`   | Mensinkronkan AWS Lambda dengan `prefix` |
| `create-lambda` | Membuat fungsi Lambda baru.              |
| `deploy-lambda` | Menerapkan fungsi Lambda ke AWS.         |
| `delete-lambda` | Menghapus fungsi Lambda dari AWS.        |

## Fitur yang Akan Datang

- [ ] Create layers
- [ ] Delete layers

## Histori Perubahan

### [1.0.0] - 2025-08-02

- Rilis awal alat `L`.
- Menyediakan perintah untuk menginisialisasi proyek, sinkronisasi, pembuatan, penerapan, dan penghapusan fungsi AWS Lambda.

### [1.0.1] - 2025-08-03

- Menambahkan README.md
- Menseragamkan semua input dan ouput menggunakan Bahasa Indonesia
- Menambahkan prettier dan eslint

### [1.0.2] - 2025-08-03

- Dukungan untuk bahasa pemrograman python 3.12 - 3.13

### [1.0.3] - 2025-08-03

- Menambahkan info repositori github

### [1.0.4] - 2025-08-05

- Memperbarui konfigurasi lambda dengan --with-config ketika deploy-lambda

<hr/>

_README.md oleh Gemini_
