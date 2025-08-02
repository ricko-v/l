import * as fs from 'node:fs';

export const getConfig = async () => {
    const configPath = process.cwd() + '/l.js';
    if (!fs.existsSync(configPath)) {
        console.log('Configuration file l.js not found in the current directory.');
        process.exit(1);
    }

    const {l} = await import(configPath);

    return l;
}