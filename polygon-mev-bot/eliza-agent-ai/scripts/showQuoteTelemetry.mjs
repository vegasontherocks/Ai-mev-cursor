#!/usr/bin/env node
import { readFileSync } from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'telemetry', 'quotes.log');
try {
    const data = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-200);
    const parsed = data.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    console.log('Last', parsed.length, 'telemetry entries');
    for (const p of parsed) console.log(p.ts, p.adapter, p.method, p.durationMs, p.success, p.error || '');
} catch (e) {
    console.error('No telemetry found or error reading file', e && e.message);
}
