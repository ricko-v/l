#!/usr/bin/env node

import { findPackageJSON } from 'node:module';
import {
  createLambda,
  deleteLambda,
  deployLambda,
  init,
  syncLambda,
} from '../commands/index.js';
import { readFileSync } from 'node:fs';

const cmd = process.argv.slice(2);
const packageJSON = readFileSync(findPackageJSON(import.meta.url), 'utf8');
const { version } = JSON.parse(packageJSON);

if (cmd.length === 0) {
  console.error(`
   l
    L      L - Alat sederhana untuk mengelola fungsi AWS Lambda
   L L     Versi: ${version}
  L   L    Repositori: https://github.com/ricko-v/l
 L     L   Penggunaan: l <perintah> [opsi]
L       L

Perintah yang tersedia:
init              Menginisialisasi proyek L
sync-lambda       Sinkronisasi AWS Lambda dengan prefix
create-lambda     Membuat fungsi Lambda baru
deploy-lambda     Mendeploy fungsi Lambda ke AWS
delete-lambda     Menghapus fungsi Lambda dari AWS
`);
  process.exit(1);
}

if (cmd[0] === 'init') {
  init();
} else if (cmd[0] === 'sync-lambda') {
  syncLambda();
} else if (cmd[0] === 'deploy-lambda') {
  if (!cmd[1]) {
    console.log('Penggunaan: l deploy-lambda <nama-lambda> [--with-config]');
    process.exit(1);
  } else if (cmd[2] == '--with-config') {
    deployLambda(cmd[1], { withConfig: true });
  } else {
    deployLambda(cmd[1]);
  }
} else if (cmd[0] === 'create-lambda') {
  createLambda();
} else if (cmd[0] === 'delete-lambda') {
  deleteLambda();
}
