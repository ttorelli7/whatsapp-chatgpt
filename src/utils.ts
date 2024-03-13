const startsWithIgnoreCase = (str, prefix) => str.toLowerCase().startsWith(prefix.toLowerCase());

import dotenv from "dotenv";
const fs = require('fs');
const path = require('path');

let threadsFile = 'threads.txt';
let promptFile = 'pre-prompt.txt';

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
    if (!prePrompt && fs.existsSync(promptFile)) {
        prePrompt = fs.readFileSync(promptFile, 'utf8');
    }
    return prePrompt;
};

const saveEnv = async (key: string, value: string) => {
    const envFilePath = path.resolve(__dirname, '../.env');
    const fileContent = fs.readFileSync(envFilePath, 'utf8');
    const variableExists = fileContent.includes(`${key}=`);
    const updatedContent = variableExists
        ? fileContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`)
        : `${fileContent}\n${key}=${value}`;
    return fs.writeFileSync(envFilePath, updatedContent);
};

function loadThreads() {
    const file = 'threads.txt';
    let content = {};
    if (fs.existsSync(file)) {
        let fileContent = fs.readFileSync(file, 'utf8');
        if (fileContent) {
            content = JSON.parse(fileContent);
        }
    }
    return content;
};

const saveThreads = async (threads) => {
    return fs.writeFileSync(threadsFile, JSON.stringify(threads));
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export { startsWithIgnoreCase, loadPrePrompt, reloadEnv, saveEnv, loadThreads, saveThreads, sleep };
