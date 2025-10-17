#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..');
const PROJECT = path.join(ROOT, '..');
const DIAG_SCRIPT = path.join(PROJECT, 'scripts', 'runSingleScan.mjs');
const OUT_FILE = path.join(PROJECT, 'runSingleScan.autorun.out');
const AGENT_DIST = path.join(PROJECT, 'dist', 'index.js');

console.log('autoStartAndRunDiag: starting diagnostic run (output ->', OUT_FILE, ')');

function runDiag() {
    return new Promise((resolve) => {
        const out = fs.createWriteStream(OUT_FILE, { flags: 'w' });
        const child = spawn(process.execPath, [DIAG_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(out);
        child.stderr.pipe(out);
        child.on('close', (code) => {
            out.end();
            console.log('autoStartAndRunDiag: diagnostic finished with code', code);
            resolve(code);
        });
        child.on('error', (err) => {
            console.error('autoStartAndRunDiag: diagnostic spawn error', err && err.message);
            resolve(1);
        });
    });
}

async function startAgent() {
    try {
        await runDiag();
    } catch (e) {
        console.error('autoStartAndRunDiag: diag failed', e && e.message);
    }

    if (!fs.existsSync(AGENT_DIST)) {
        console.error('autoStartAndRunDiag: compiled agent not found at', AGENT_DIST, '\nPlease run `npm run build:prod` first.');
        process.exit(1);
    }

    console.log('autoStartAndRunDiag: launching agent', AGENT_DIST);
    const agent = spawn(process.execPath, [AGENT_DIST], { stdio: 'inherit' });
    agent.on('close', (c) => process.exit(c));
}

startAgent();
