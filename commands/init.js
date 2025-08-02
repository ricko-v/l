import * as path from 'node:path';
import * as fs from 'node:fs';
import { select } from '@inquirer/prompts';
import { execSync } from 'node:child_process';
import { listRegion } from '../constants/region.js';

export async function init() {
    console.log('Menginisialisasi proyek L ...');
    const listAwsProfiles = execSync('aws configure list-profiles', { encoding: 'utf8' })
        .split('\n')
        .filter(profile => profile.trim() !== '');
    const currentDir = process.cwd();
    const selectAwsProfile = await select({
        message: 'Pilih profil AWS',
        choices: listAwsProfiles.map(profile => ({ name: profile, value: profile })),
    })
    const selectedRegion = await select({
        message: 'Pilih wilayah AWS',
        choices: listRegion.map(region => ({ name: region.name, value: region.value })),
        validate: (input) => {
            if (input === null) {
                return 'Kamu harus memilih wilayah AWS!';
            }
            return true;
        },
    });
    const listRoles = execSync(`aws iam list-roles --region ${selectedRegion} --profile ${selectAwsProfile} --output json`, { encoding: 'utf8' });
    const roles = JSON.parse(listRoles).Roles.map(role => ({
        name: role.RoleName,
        value: role.Arn,
    }));
    if (roles.length === 0) {
        console.log('Tidak ada role yang ditemukan di akun AWS Anda. Silakan buat role dengan izin eksekusi Lambda!');
        return;
    }
    const selectedRoleExecution = await select({
        message: 'Pilih role untuk eksekusi Lambda',
        choices: roles,
        validate: (input) => {
            if (input === null) {
                return 'Kamu harus memilih role!';
            }
            return true;
        },
    });
    const awsId = execSync(`aws sts get-caller-identity --profile ${selectAwsProfile} --region ${selectedRegion}`, { encoding: 'utf8' });
  const awsIdParsed = JSON.parse(awsId).Account;
    fs.mkdirSync(path.join(currentDir, 'lambda'), { recursive: true });
    fs.mkdirSync(path.join(currentDir, 'lambda/config'), { recursive: true });
    fs.mkdirSync(path.join(currentDir, 'lambda/code'), { recursive: true });
    fs.writeFileSync(path.join(currentDir, 'l.js'), `// File ini dibuat secara otomatis oleh L
export const l = {
    awsId: '${awsIdParsed}',
    awsProfile: '${selectAwsProfile}',
    awsRegion: '${selectedRegion}',
    awsRoleExecution: '${selectedRoleExecution}'
}`, 'utf8');
    console.log(`Berhasil menginisialisasi proyek dengan profil AWS: ${selectAwsProfile}`);
}