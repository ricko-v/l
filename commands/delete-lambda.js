import { input, select } from '@inquirer/prompts';
import { aws } from '../utils/aws.js';

export const deleteLambda = async () => {
  const reqLambdas = await aws(`aws lambda list-functions --output json`);
  const listLambdas = JSON.parse(reqLambdas).Functions;

  if (listLambdas.length === 0) {
    console.log('Tidak ada fungsi Lambda yang ditemukan di akun AWS Anda.');
    return;
  }

  const selectedLambda = await select({
    message: 'Pilih fungsi Lambda untuk dihapus',
    choices: listLambdas.map((lambda) => ({
      name: lambda.FunctionName,
      value: lambda.FunctionName,
    })),
  });

  const confirmDelete = await input({
    message: "Ketik 'konfirmasi' untuk menghapus:",
    validate: (input) => {
      if (input !== 'konfirmasi') {
        return "Anda harus mengetik 'konfirmasi' untuk melanjutkan penghapusan.";
      }
      return true;
    },
  });

  if (confirmDelete === 'konfirmasi') {
    await aws(`aws lambda delete-function --function-name ${selectedLambda}`);
    console.log(`Fungsi Lambda telah dihapus: ${selectedLambda}`);
  } else {
    console.log('Penghapusan dibatalkan.');
  }
};
