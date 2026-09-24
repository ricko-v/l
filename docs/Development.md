---
title: Development
aliases:
  - Pengembangan
tags:
  - l-cli
  - development
---

# Development

## Setup

```sh
npm ci
```

Project memakai Node.js 22+, TypeScript strict mode, ESM, dan module resolution
`NodeNext`.

## Script

| Script | Fungsi |
| --- | --- |
| `npm run dev -- <args>` | Menjalankan `src/index.ts` melalui tsx |
| `npm run typecheck` | Menjalankan `tsc --noEmit` |
| `npm test` | Menjalankan test Node melalui tsx |
| `npm run build` | Type-check lalu bundle dengan tsup |
| `npm start -- <args>` | Menjalankan bundle `dist/index.js` |
| `npm run prepublishOnly` | Test dan build; juga dijalankan otomatis saat publish |

Build menghasilkan `dist/index.js` dengan shebang `#!/usr/bin/env node`, format ESM,
target Node.js 22, dan source map.
Panduan file paket, akun npm, commit, dan rilis ada di [[Publishing]].

## Menambah command

Gunakan pemisahan tanggung jawab yang sudah ada:

1. Tambahkan function use case di `src/commands/`.
2. Letakkan pembuatan client atau adapter AWS bersama module di `src/aws/`.
3. Daftarkan command dan option di `src/index.ts`.
4. Tangani error di boundary action Commander agar exit status konsisten.
5. Tambahkan test untuk parsing, transformasi, atau lifecycle yang berisiko.
6. Perbarui [[CLI Reference]] dan note terkait.

Contoh bentuk command:

```ts
import { createLambdaClient } from "../aws/lambda.js";
import { findProjectConfig } from "../config/project.js";
import { resolveProfile } from "../config/profiles.js";

export async function exampleCommand(options: { profile?: string; region?: string } = {}) {
  const project = await findProjectConfig();
  const profile = resolveProfile(options.profile, project?.profile);
  const client = await createLambdaClient(options.region ?? project?.region, profile);
  try {
    // Kirim command AWS dan format hasil untuk terminal.
  } finally {
    client.destroy();
  }
}
```

Import internal TypeScript tetap memakai ekstensi `.js`:

```ts
import { exampleCommand } from "./commands/example.js";
```

Ini diperlukan oleh output ESM dan resolusi `NodeNext`.
Pada action Commander, teruskan `command.optsWithGlobals()` agar `--profile`
tersedia juga untuk subcommand. Jangan mengambil session default secara langsung
pada command yang seharusnya mengikuti [[Multi Profile]].

## Pengujian

```sh
npm run typecheck
npm test
npm run build
node dist/index.js --help
```

Test yang tersedia menggunakan:

- loopback HTTP server untuk callback OAuth;
- directory sementara untuk penyimpanan session;
- store profile sementara untuk isolasi login/refresh, kompatibilitas default,
  prioritas config/option, dan propagasi profile ke seluruh command;
- mock AWS STS untuk memastikan expiry terbaru ditampilkan.
- prompt terprogram untuk alur init, pembatalan, update, dan fallback AWS;
- file sementara untuk validasi config, konflik update, dan pencarian parent;
- mock Lambda untuk pagination dan prioritas option CLI atas default project.
- ZIP fixture untuk path traversal, CRC, collision, permission, dan ignore;
- simulasi pull–edit–push, konflik revision/account, backup, serta rollback lokal;
- batch multi-function untuk selector, konfirmasi gabungan, konflik sebelum perubahan,
  kegagalan parsial, retry selektif, dan pembersihan paket sementara;
- mock adapter AWS untuk upload, penantian update, dan verifikasi checksum.

`src/cli/prompts.ts` menggunakan `node:readline/promises` tanpa dependency baru.
`initCommand` menerima dependency prompt/session/listing untuk pengujian offline.
Test tetap memeriksa data yang disimpan ke file, bukan hanya pemanggilan mock.

Test tidak memerlukan credentials dan tidak mengakses account AWS. Lingkungan
sandbox tertentu dapat melarang listen pada loopback; jalankan test pada host lokal
jika muncul `listen EPERM`.

## Definition of done

Sebelum perubahan dianggap selesai:

- type-check berhasil;
- test relevan berhasil;
- build executable berhasil;
- `--help` sesuai dengan command aktual;
- tidak ada secret dalam fixture, log, dokumentasi, atau source;
- dokumentasi dan contoh command diperbarui.

## Dokumentasi Obsidian

Setiap note utama memakai properties berikut:

```yaml
---
title: Nama Note
aliases:
  - Nama alternatif
tags:
  - l-cli
---
```

Gunakan wikilink `[[Nama Note]]` untuk hubungan internal. Gunakan heading link seperti
`[[CLI Reference#l login]]` untuk menuju bagian tertentu. Simpan gambar atau file
pendukung di `_attachments/` agar sesuai dengan konfigurasi vault.
