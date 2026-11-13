const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Korea has no daylight-saving transitions. Name each week by its Monday in KST.
function weekStart(date = new Date()) {
    const local = new Date(date.getTime() + KST_OFFSET_MS);
    local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
    return local.toISOString().slice(0, 10);
}

function redact(message) {
    return message
        .replace(/\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]');
}

function createWeeklyLogger({ directory, now = () => new Date(), fallback = () => {}, fileSystem = fs }) {
    return function write(level, message) {
        if (!message) return;
        const date = now();
        const timestamp = new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace('Z', '+09:00');
        const lines = redact(String(message)).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
        const record = lines.map(line => `[${timestamp}] [${level}] ${line}\n`).join('');
        try {
            fileSystem.mkdirSync(directory, { recursive: true });
            // Append and close each time: no Windows rename/open-handle race at rotation.
            fileSystem.appendFileSync(path.join(directory, `app-${weekStart(date)}.log`), record, 'utf8');
        } catch (error) {
            // Preserve the original output via WinSW if disk writes fail; never recurse.
            fallback(`[weekly-log write failed: ${error.code || 'unknown'}]\n${record}`);
        }
    };
}

function installWeeklyLogging({ directory = path.join(__dirname, '..', 'logs'), now, stdout = process.stdout, stderr = process.stderr } = {}) {
    const originalOut = stdout.write;
    const originalErr = stderr.write;
    const fallback = message => originalErr.call(stderr, message);
    const write = createWeeklyLogger({ directory, now, fallback });
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    function capture(level, decoder) {
        return function (chunk, encoding, callback) {
            if (typeof encoding === 'function') callback = encoding;
            const message = Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
                ? decoder.write(Buffer.from(chunk)) : String(chunk);
            write(level, message);
            if (typeof callback === 'function') queueMicrotask(callback);
            return true;
        };
    }
    stdout.write = capture('INFO', outDecoder);
    stderr.write = capture('ERROR', errDecoder);
    return function restore() {
        write('INFO', outDecoder.end());
        write('ERROR', errDecoder.end());
        stdout.write = originalOut;
        stderr.write = originalErr;
    };
}

module.exports = { weekStart, redact, createWeeklyLogger, installWeeklyLogging };