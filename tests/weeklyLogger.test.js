const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { weekStart, createWeeklyLogger, installWeeklyLogging } = require('../utils/weeklyLogger');

function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movieapi-weekly-log-test-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('movieapi-weekly-log-test-'));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}

test('KST Monday boundary, year boundary and leap day', () => {
    assert.equal(weekStart(new Date('2026-11-15T14:59:59.999Z')), '2026-11-09');
    assert.equal(weekStart(new Date('2026-11-15T15:00:00.000Z')), '2026-11-16');
    assert.equal(weekStart(new Date('2026-01-01T00:00:00Z')), '2025-12-29');
    assert.equal(weekStart(new Date('2024-02-29T00:00:00Z')), '2024-02-26');
});

test('rotates without restart; restart appends and preserves old files', t => {
    const directory = temporary(t);
    fs.writeFileSync(path.join(directory, 'app_server.log'), 'legacy log');
    let current = new Date('2026-11-15T14:59:59Z');
    const write = createWeeklyLogger({ directory, now: () => current });
    write('INFO', 'first');
    current = new Date('2026-11-15T15:00:00Z');
    write('ERROR', 'second');
    createWeeklyLogger({ directory, now: () => current })('INFO', 'restart');
    assert.match(fs.readFileSync(path.join(directory, 'app-2026-11-09.log'), 'utf8'), /first/);
    const next = fs.readFileSync(path.join(directory, 'app-2026-11-16.log'), 'utf8');
    assert.match(next, /2026-11-16T00:00:00.000\+09:00/);
    assert.match(next, /\[ERROR\] second/);
    assert.match(next, /restart/);
    assert.equal(fs.readFileSync(path.join(directory, 'app_server.log'), 'utf8'), 'legacy log');
});

test('Unicode, multiline, sensitive URL query and bearer redaction', t => {
    const directory = temporary(t);
    createWeeklyLogger({ directory, now: () => new Date('2026-11-13T00:00:00Z') })('INFO', '한글 🎬\nhttps://example.test/stream?token=secret Bearer abc.def.ghi');
    const output = fs.readFileSync(path.join(directory, 'app-2026-11-09.log'), 'utf8');
    assert.match(output, /한글 🎬/);
    assert.equal(output.trim().split('\n').length, 2);
    assert.ok(!output.includes('secret'));
    assert.ok(!output.includes('abc.def.ghi'));
});

test('disk error falls back without throwing or losing the record', () => {
    const outputs = [];
    const write = createWeeklyLogger({ directory: 'unused', fallback: value => outputs.push(value), fileSystem: {
        mkdirSync() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }
    } });
    assert.doesNotThrow(() => write('ERROR', 'important error'));
    assert.match(outputs[0], /EACCES/);
    assert.match(outputs[0], /important error/);
});

test('stream capture avoids duplicate output, handles split UTF8 and callbacks, restores streams', async t => {
    const directory = temporary(t);
    const native = [];
    const stdout = { write: value => native.push(value) };
    const stderr = { write: value => native.push(value) };
    const originalOut = stdout.write;
    const restore = installWeeklyLogging({ directory, stdout, stderr, now: () => new Date('2026-11-13T00:00:00Z') });
    const unicode = Buffer.from('한글');
    stdout.write(unicode.subarray(0, 1));
    await new Promise(resolve => stdout.write(unicode.subarray(1), resolve));
    stderr.write('failure\n');
    restore();
    assert.equal(stdout.write, originalOut);
    assert.equal(native.length, 0);
    const output = fs.readFileSync(path.join(directory, 'app-2026-11-09.log'), 'utf8');
    assert.match(output, /한글/);
    assert.match(output, /\[ERROR\] failure/);
});