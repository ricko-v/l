import { checkbox, input, select } from '@inquirer/prompts';
import { aws } from '../utils/aws.js';
import { listRuntime } from '../constants/runtime.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import * as unzipper from 'unzipper';
import { getConfig } from '../utils/get-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const createLambda = async () => {
  const config = await getConfig();
  const currentDir = process.cwd();
  const lambdaName = await input({
    message: 'Masukkan nama fungsi Lambda yang ingin dibuat:',
    validate: (input) => {
      if (!input.match(/^[a-zA-Z0-9-_]+$/)) {
        return 'Harap masukkan nama fungsi Lambda yang valid (hanya alfanumerik, tanda hubung, dan garis bawah)';
      }
      return true;
    },
  });

  const selectedRuntime = await select({
    message: 'Pilih runtime untuk fungsi Lambda:',
    choices: listRuntime,
    validate: (input) => {
      if (input === null) {
        return 'Anda harus memilih runtime.';
      }
      return true;
    },
  });

  const selectedArchitecture = await select({
    message: 'Pilih arsitektur untuk fungsi Lambda:',
    choices: [
      { name: 'x86_64', value: 'x86_64' },
      { name: 'arm64', value: 'arm64' },
    ],
    validate: (input) => {
      if (input === null) {
        return 'Anda harus memilih arsitektur.';
      }
      return true;
    },
  });

  const listVpc = await aws(
    `aws ec2 describe-vpcs --query "Vpcs[*].VpcId" --output json`,
  );
  const vpcs = JSON.parse(listVpc).map((vpc) => ({
    name: vpc,
    value: vpc,
  }));

  const selectedVpc = await select({
    message: 'Pilih VPC untuk fungsi Lambda (opsional):',
    choices: [{ name: 'Tidak Ada', value: null }, ...vpcs],
    validate: (input) => {
      if (input === null) {
        return "Anda harus memilih VPC atau memilih 'Tidak Ada'.";
      }
      return true;
    },
  });

  let vpcConfig = {};

  if (selectedVpc !== null) {
    const listSubnets = await aws(
      `aws ec2 describe-subnets --filters "Name=vpc-id,Values=${selectedVpc}" --query "Subnets[*].SubnetId" --output json`,
    );
    const subnets = JSON.parse(listSubnets).map((subnet) => ({
      name: subnet,
      value: subnet,
    }));
    const selectedSubnets = await checkbox({
      message:
        'Pilih subnet untuk fungsi Lambda (opsional, dapat memilih lebih dari satu):',
      choices: subnets,
      validate: (input) => {
        if (input.length === 0) {
          return 'Anda harus memilih setidaknya satu subnet.';
        }
        return true;
      },
    });

    const listSecurityGroups = await aws(
      `aws ec2 describe-security-groups --filters "Name=vpc-id,Values=${selectedVpc}" --query "SecurityGroups[*].GroupId" --output json`,
    );
    const securityGroups = JSON.parse(listSecurityGroups).map((sg) => ({
      name: sg,
      value: sg,
    }));
    const selectedSecurityGroups = await checkbox({
      message:
        'Pilih grup keamanan untuk fungsi Lambda (opsional, dapat memilih lebih dari satu):',
      choices: securityGroups,
      validate: (input) => {
        if (input.length === 0) {
          return 'Anda harus memilih setidaknya satu grup keamanan.';
        }
        return true;
      },
    });

    vpcConfig = {
      SubnetIds: selectedSubnets,
      SecurityGroupIds: selectedSecurityGroups,
    };
  }

  const listGateways = await aws(`aws apigateway get-rest-apis --output json`);
  const gateways = JSON.parse(listGateways).items.map((gateway) => ({
    name: gateway.name,
    value: gateway.id,
  }));

  const selectedGateway = await select({
    message: 'Pilih API Gateway untuk dihubungkan dengan fungsi Lambda:',
    choices: gateways,
    validate: (input) => {
      if (input === null) {
        return 'Anda harus memilih API Gateway.';
      }
      return true;
    },
  });

  const listResources = await aws(
    `aws apigateway get-resources --rest-api-id ${selectedGateway} --output json`,
  );
  const resources = JSON.parse(listResources).items.map((resource) => ({
    name: resource.path,
    value: resource.id,
  }));

  const selectedParentResource = await select({
    message: 'Pilih resource induk untuk fungsi Lambda:',
    choices: resources,
    validate: (input) => {
      if (input === null) {
        return 'Anda harus memilih resource induk.';
      }
      return true;
    },
  });

  const getStages = await aws(
    `aws apigateway get-stages --rest-api-id ${selectedGateway} --output json`,
  );

  if (getStages === '') {
    console.error(
      'Tidak ada stage yang ditemukan untuk API Gateway yang dipilih. Harap buat stage terlebih dahulu.',
    );
    return;
  }

  const stages = JSON.parse(getStages).item.map((stage) => ({
    name: stage.stageName,
    value: stage.stageName,
  }));

  let selectedStage = null;

  if (stages.length === 0) {
    console.error(
      'Tidak ada stage yang ditemukan untuk API Gateway yang dipilih. Harap buat stage terlebih dahulu.',
    );
    selectedStage = await input({
      message: 'Masukkan nama stage untuk fungsi Lambda:',
      validate: (input) => {
        if (!input.match(/^[a-zA-Z0-9-_]+$/)) {
          return 'Harap masukkan nama stage yang valid (hanya alfanumerik, tanda hubung, dan garis bawah)';
        }
        return true;
      },
    });
  } else {
    selectedStage = await select({
      message: 'Pilih stage untuk fungsi Lambda:',
      choices: stages,
      validate: (input) => {
        if (input === null) {
          return 'Anda harus memilih stage.';
        }
        return true;
      },
    });
  }

  const newResourcePath = await input({
    message: 'Masukkan path untuk resource baru:',
    validate: (input) => {
      if (input && !input.match(/^[a-zA-Z0-9-_]+$/)) {
        return 'Harap masukkan path resource yang valid (hanya alfanumerik, tanda hubung, dan garis bawah)';
      }
      return true;
    },
  });

  const createNewResource = await aws(
    `aws apigateway create-resource --rest-api-id ${selectedGateway} --parent-id ${selectedParentResource} --path-part ${newResourcePath} --output json`,
  );
  const newResource = JSON.parse(createNewResource);

  let templateLambda = '';

  if (selectedRuntime.search('nodejs') !== -1) {
    templateLambda = `${__dirname}/../template/lambda-nodejs.zip`;
  }

  const createLambda = await aws(
    `aws lambda create-function --function-name ${lambdaName} --zip-file fileb://${templateLambda} --runtime ${selectedRuntime} --role ${
      config.awsRoleExecution
    } --handler index.handler --architectures ${selectedArchitecture} --vpc-config ${JSON.stringify(
      vpcConfig,
    )} --output json`,
  );

  const lambdaResponse = JSON.parse(createLambda);

  await aws(
    `aws apigateway put-method --rest-api-id ${selectedGateway} --resource-id ${newResource.id} --http-method ANY --authorization-type NONE --no-api-key-required`,
  );
  await aws(
    `aws apigateway put-integration --rest-api-id ${selectedGateway} --resource-id ${newResource.id} --http-method ANY --type AWS_PROXY --integration-http-method POST --uri arn:aws:apigateway:${config.awsRegion}:lambda:path/2015-03-31/functions/${lambdaResponse.FunctionArn}/invocations --output json`,
  );
  await aws(
    `aws lambda add-permission --function-name ${lambdaName} --principal apigateway.amazonaws.com --statement-id "AllowApiGatewayInvoke" --action lambda:InvokeFunction --source-arn arn:aws:execute-api:${config.awsRegion}:${config.awsId}:${selectedGateway}/*/*/${newResourcePath} --output json`,
  );
  await aws(
    `aws apigateway create-deployment --rest-api-id ${selectedGateway} --stage-name ${selectedStage} --output json`,
  );

  if (!fs.existsSync(`${currentDir}/lambda/code/${lambdaName}`)) {
    fs.mkdirSync(`${currentDir}/lambda/code/${lambdaName}`, {
      recursive: true,
    });
  }

  console.log(`Mengambil konfigurasi untuk ${lambdaName}...`);
  const getConfigLambda = await aws(
    `aws lambda get-function-configuration --function-name ${lambdaName} --output json`,
  );
  fs.writeFileSync(
    `${currentDir}/lambda/config/${lambdaName}.json`,
    getConfigLambda,
    'utf8',
  );
  console.log(`Mengunduh kode untuk ${lambdaName}...`);
  const getCode = await aws(
    `aws lambda get-function --function-name ${lambdaName} --query 'Code.Location' --output json`,
  );

  execSync(
    `curl -o '${currentDir}/lambda/code/${lambdaName}/${lambdaName}.zip' "${JSON.parse(
      getCode,
    )}"`,
    { stdio: 'ignore' },
  );

  console.log(`Mengekstrak kode untuk ${lambdaName}...`);
  const directory = await unzipper.Open.file(
    `${currentDir}/lambda/code/${lambdaName}/${lambdaName}.zip`,
  );
  await directory.extract({
    path: `${currentDir}/lambda/code/${lambdaName}`,
  });

  fs.rmSync(`${currentDir}/lambda/code/${lambdaName}/${lambdaName}.zip`);
};
