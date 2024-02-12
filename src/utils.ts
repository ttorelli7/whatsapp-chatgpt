const startsWithIgnoreCase = (str, prefix) => str.toLowerCase().startsWith(prefix.toLowerCase());

import dotenv from "dotenv";
const fs = require('fs');
const path = require('path');

const reloadEnv = (key: string = '') => {
    const keys = dotenv.parse(fs.readFileSync('.env'));
    if (key) {
        return keys[key];
    }
    for (const i in keys) {
        process.env[i] = keys[i];
    }
};

const loadPrePrompt = (): string => {
    let prePrompt = process.env.PRE_PROMPT || '';
    let file = 'pre-prompt.txt';
    if (!prePrompt && fs.existsSync(file)) {
        prePrompt = fs.readFileSync(file, 'utf8');
    }
    return prePrompt;
};

const saveEnv = (key: string, value: string) => {
    const envFilePath = path.resolve(__dirname, '.env');
    fs.appendFileSync(envFilePath, `${key}=${value}`);
}

export { startsWithIgnoreCase, loadPrePrompt, reloadEnv, saveEnv };
