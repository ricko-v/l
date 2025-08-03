import { execSync } from 'node:child_process';
import { getConfig } from './get-config.js';

export const aws = async (command) => {
  const config = await getConfig();
  const c = execSync(
    `${command} --region ${config.awsRegion} --profile ${config.awsProfile}`,
    { encoding: 'utf-8' },
  );
  return c;
};
