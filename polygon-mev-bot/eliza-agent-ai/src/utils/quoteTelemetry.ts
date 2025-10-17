import fs from 'fs';
import path from 'path';

const TELEMETRY_DIR = path.join(process.cwd(), 'telemetry');
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'quotes.log');

function ensureDir() {
    try {
        if (!fs.existsSync(TELEMETRY_DIR)) fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    } catch (e) {
        // ignore
    }
}

export function appendTelemetry(entry: Record<string, any>) {
    try {
        ensureDir();
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
        fs.appendFileSync(TELEMETRY_FILE, line + '\n', { encoding: 'utf8' });
    } catch (e) {
        // ignore telemetry errors
    }
}

export function readTelemetryLines(limit = 500) {
    try {
        if (!fs.existsSync(TELEMETRY_FILE)) return [];
        const data = fs.readFileSync(TELEMETRY_FILE, 'utf8').trim().split('\n').filter(Boolean);
        if (limit && data.length > limit) return data.slice(-limit);
        return data;
    } catch (e) {
        return [];
    }
}

export default { appendTelemetry, readTelemetryLines };
