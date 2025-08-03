import * as fs from 'node:fs';

export const getConfig = async () => {
  const configPath = process.cwd() + '/l.js';
  if (!fs.existsSync(configPath)) {
    console.log('File konfigurasi l.js tidak ditemukan di direktori saat ini.');
    process.exit(1);
  }

  const { l } = await import(configPath);

  return l;
};
