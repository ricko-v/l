import { zip } from 'zip-a-folder';
import { aws } from '../utils/aws.js';
import * as fs from 'node:fs';

export const deployLambda = async (lambdaName) => {
  try {
    if (!fs.existsSync(`${process.cwd()}/lambda/code/${lambdaName}`)) {
      console.error(
        `Direktori kode untuk fungsi Lambda ${lambdaName} tidak ditemukan.`,
      );
      return;
    }
    fs.mkdirSync(`${process.cwd()}/lambda/tmp`, { recursive: true });
    await zip(
      `${process.cwd()}/lambda/code/${lambdaName}`,
      `${process.cwd()}/lambda/tmp/${lambdaName}.zip`,
    );
    await aws(
      `aws lambda update-function-code --function-name ${lambdaName} --zip-file fileb://${`${process.cwd()}/lambda/tmp/${lambdaName}.zip`} --publish`,
    );
    await aws(`aws lambda wait function-updated --function-name ${lambdaName}`);
    console.log(`Berhasil mendeploy fungsi Lambda ${lambdaName}.`);
    fs.rmSync(`${process.cwd()}/lambda/tmp`, { recursive: true, force: true });
  } catch (error) {
    console.error(
      `Gagal mengunggah kode untuk fungsi Lambda ${lambdaName}:`,
      error,
    );
    throw error;
  }
};
