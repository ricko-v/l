---
title: Publishing
aliases:
  - Publish npm
  - Rilis CLI
tags:
  - l-cli
  - npm
  - release
---

# Publishing

Panduan merilis CLI sebagai package npm `@ricko-v/l`, dengan executable `l`.
Perintah publish pada catatan ini dijalankan secara manual oleh maintainer.

## Konfigurasi package

Package saat ini memiliki `bin.l` ke `dist/index.js`, membutuhkan Node.js 22+,
dan memakai konfigurasi berikut:

```json
{
  "files": ["dist/", "docs/*.md", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "prepublishOnly": "npm test && npm run build"
  }
}
```

Ini cuplikan; pertahankan field dan script lain di `package.json`. Field `files`
membatasi isi paket. Nama file yang dicantumkan tidak otomatis dibuat; pastikan
`LICENSE` benar-benar tersedia dan sesuai dengan metadata lisensi ISC saat rilis.
[Referensi field package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).

`prepublishOnly` menjalankan test dan build saat `npm publish`, bukan saat `npm pack`.
Karena itu build tetap diperlukan sebelum memeriksa tarball dengan pack.
[Lifecycle npm scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/).

## File lokal, Git, dan npm

Tidak perlu menghapus folder kerja lokal untuk publish. Perbedaannya:

| Mekanisme | Mengatur |
| --- | --- |
| `files` di `package.json` | File yang disertakan dalam paket npm |
| `.gitignore` | File lokal yang belum dilacak dan diabaikan Git |
| `.lignore` | File kode function yang dikecualikan dari ZIP `l push` |

Dengan daftar `files` di atas, `goffi-lunch/`, `test/`, `tests/`, `.obsidian/`,
dan `docs/.obsidian/` tidak masuk paket npm. Markdown dokumentasi tetap masuk.
Source map di `dist/` juga ikut dan dapat berisi source CLI; periksa seluruh hasil pack.
Konfigurasi vault lokal dapat tetap dipakai meskipun tidak diterbitkan.

Untuk folder yang hanya dipakai lokal, contoh tambahan `.gitignore`:

```gitignore
/goffi-lunch/
/test/
/.obsidian/
/docs/.obsidian/workspace*.json
*.tgz
```

`tests/` adalah test otomatis CLI dan umumnya tetap di-commit. Konfigurasi bersama
Obsidian boleh di-commit; file workspace pribadi dapat diabaikan secara terpisah.
`.gitignore` tidak mengeluarkan file yang sudah dilacak: periksa `git ls-files` dan
index sebelum commit. Jangan menganggap file yang tidak masuk npm pasti tidak masuk Git.

## Akun npm

Gunakan akun pemilik scope `ricko-v`, atau akun yang mendapat izin publish jika scope
tersebut merupakan organisasi. Untuk publish interaktif, siapkan 2FA dan ikuti
verifikasi npm. Login npm terpisah dari login AWS `l`.
[Panduan scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

## Verifikasi sebelum rilis

Dari root repository CLI:

```sh
npm ci
npm test
npm run build
npm pack --dry-run
```

Periksa daftar file: executable `dist/index.js` harus ada, sedangkan folder kerja,
session auth, dan workspace pribadi harus tidak ada. Dry-run tidak menerbitkan paket.

Untuk menguji tarball aktual, jalankan `npm pack`, lalu instal file `.tgz` yang
dihasilkan ke folder sementara terpisah dengan `npm install /path/ke/file.tgz`.
Jalankan `./node_modules/.bin/l --version` dan `./node_modules/.bin/l --help` dari
folder itu agar yang diuji benar-benar isi paket, bukan executable dari `npm link`.

## Commit dan publish

Commit Git tidak diwajibkan untuk `npm publish`; npm mengambil file dari folder lokal.
Untuk melacak rilis, tinjau `git status` dan `git diff --cached`, lalu commit file rilis
yang sudah dipilih. Jika baru menginisialisasi Git, tinjau juga semua file untracked.

Pastikan versi pada `package.json` dan lockfile sesuai. Versi rilis berikutnya harus
berbeda; nama dan versi yang telah diterbitkan tidak dapat dipakai ulang.
[Aturan npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

Setelah semua pemeriksaan selesai, terbitkan:

```sh
npm publish --access public
```

Script `prepublishOnly` kembali memeriksa test/build. Ikuti prompt autentikasi npm.
Setelah berhasil, beri tag Git sesuai versi yang benar-benar dirilis, misalnya
`git tag v1.0.0` untuk versi `1.0.0`, pada commit rilis tersebut.

## Memastikan hasil rilis

```sh
npm view @ricko-v/l version --registry=https://registry.npmjs.org/
npm install -g @ricko-v/l
l --version
l --help
```

Jika pernah memakai `npm link` atau project `l-tui`, periksa `command -v l` untuk
memastikan executable yang dijalankan berasal dari instalasi yang dimaksud.
Lihat [[Getting Started]] untuk pemakaian CLI dan [[Development]] untuk pengembangan.
