import { zip } from 'zip-a-folder';
import { aws } from '../utils/aws.js';
import * as fs from 'node:fs';

export const deployLambda = async (lambdaName, option) => {
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
    console.log(`Berhasil mendeploy fungsi Lambda ${lambdaName}.`);
    console.log(
      `Memperbarui konfigurasi fungsi Lambda ${lambdaName}...`,
    );
    await aws(`aws lambda wait function-updated --function-name ${lambdaName}`);

    if (option?.withConfig) {
      const configFile = `${process.cwd()}/lambda/config/${lambdaName}.json`;
      if (!fs.existsSync(configFile)) {
        console.error(
          `File konfigurasi untuk fungsi Lambda ${lambdaName} tidak ditemukan.`,
        );
        return;
      }
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      let args = '';
      if(config.Role) {
        args += `--role ${config.Role} `;
      }
       
      if (config.Timeout) {
        args += `--timeout ${config.Timeout} `;
      }

      if (config.MemorySize) {
        args += `--memory-size ${config.MemorySize} `;
      }

      if (config.Environment) {
        const envVars = Object.entries(config.Environment).map(
          ([key, value]) => `${key}=${value}`,
        );
        args += `--environment Variables={${envVars.join(',')}} `;
      }

      if (config.VpcConfig) {
        const vpcConfig = config.VpcConfig;
        args += `--vpc-config SubnetIds=${vpcConfig.SubnetIds.map((x) => x).join(
          ',',
        )},SecurityGroupIds=${vpcConfig.SecurityGroupIds.map((x) => x).join(',')} `;
      }

      if (config.TracingConfig) {
        args += `--tracing-config Mode=${config.TracingConfig.Mode} `;
      }

      if (config.KMSKeyArn) {
        args += `--kms-key-arn ${config.KMSKeyArn} `;
      }

      if (config.Layers) {
        args += `--layers ${config.Layers.map((x) => x.Arn).join(',')} `;
      }

      if (config.Runtime) {
        args += `--runtime ${config.Runtime} `;
      }

      if (config.Handler) {
        args += `--handler ${config.Handler} `;
      }

      if (config.Description) {
        args += `--description "${config.Description}" `;
      }

      await aws(
        `aws lambda update-function-configuration --function-name ${lambdaName} ${args}`,
      );
      console.log(
        `Berhasil memperbarui konfigurasi fungsi Lambda ${lambdaName}.`,
      );
    }

    fs.rmSync(`${process.cwd()}/lambda/tmp`, { recursive: true, force: true });
  } catch (error) {
    console.error(
      `Gagal mengunggah kode untuk fungsi Lambda ${lambdaName}:`,
      error,
    );
    throw error;
  }
};
