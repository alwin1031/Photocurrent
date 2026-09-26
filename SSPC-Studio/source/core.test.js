'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const core = require('./core.js');
const defaults = { gain: 200, baseline: 100, lightOn: 0, lightOff: .85, peakWindow: 250, timeUnit: 's' };
function synthetic({ unit = 1, negative = false, offset = 0, irregular = false, noise = 0 } = {}) {
  const time = [], amplitude = []; let seed = 77;
  for (let i = 0; i <= 2200; i++) {
    const t = -.2 + i * .001 + (irregular && i ? .0001 * Math.sin(i) : 0);
    let y = t < 0 ? 0 : t < .85 ? 4 * Math.exp(-t / .06) + .2 : -2 * Math.exp(-(t - .85) / .18) - .05;
    if (negative) y = -y;
    seed = (1664525 * seed + 1013904223) >>> 0;
    y += noise * (seed / 4294967296 - .5);
    time.push((t + offset) * unit); amplitude.push(.035 + y / 200);
  }
  return { time, amplitude, warnings: [] };
}
function near(a, b, tolerance = 1e-6) { assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b} by more than ${tolerance}`); }
test('recovers known exponential constants, baseline, amplitude, plateau, and half-time', () => {
  const r = core.analyze(synthetic(), defaults);
  near(r.baseline, .035); near(r.on.tau, .06); near(r.off.tau, .18); near(r.on.plateau, .2); near(r.off.plateau, -.05);
  near(r.on.halfTime, Math.LN2 * .06); near(r.off.halfTime, Math.LN2 * .18); near(r.on.r2, 1); near(r.off.r2, 1);
  assert.equal(r.time[r.onStart], 0); assert.ok(r.time[r.offStart] >= .85);
});
test('handles both polarities without changing time constants', () => {
  const a = core.analyze(synthetic(), defaults), b = core.analyze(synthetic({ negative: true }), defaults);
  near(a.on.tau, b.on.tau); near(a.off.tau, b.off.tau); near(a.on.peakAmplitude, -b.on.peakAmplitude);
});
test('handles large absolute timestamps through a relative time origin', () => {
  const r = core.analyze(synthetic({ offset: 1000000 }), { ...defaults, lightOn: 1000000, lightOff: 1000000.85 });
  near(r.on.tau, .06); near(r.off.tau, .18);
});
test('seconds, milliseconds, and microseconds produce the same answer', () => {
  for (const [timeUnit, unit] of [['s', 1], ['ms', 1000], ['us', 1e6]]) {
    const r = core.analyze(synthetic({ unit }), { ...defaults, timeUnit }); near(r.on.tau, .06); near(r.off.tau, .18);
  }
});
test('uses actual irregular timestamps and warns about spacing', () => {
  const r = core.analyze(synthetic({ irregular: true }), defaults);
  near(r.on.tau, .06); near(r.off.tau, .18); assert.ok(r.warnings.some(w => w.includes('not uniform')));
});
test('fits noisy data near known constants', () => {
  const r = core.analyze(synthetic({ noise: .05 }), defaults); near(r.on.tau, .06, .001); near(r.off.tau, .18, .005);
});
test('flags a flat signal without crashing the other phase', () => {
  const data = synthetic(); for (let i = 0; i < data.time.length; i++) if (data.time[i] >= .85) data.amplitude[i] = .035;
  const r = core.analyze(data, defaults); assert.equal(r.on.ok, true); assert.equal(r.off.ok, false); assert.match(r.off.message, /flat/);
});
test('rejects invalid baseline, timing, gains, and blank-equivalent values', () => {
  for (const setting of [{ baseline: 0 }, { baseline: 2.5 }, { baseline: 100000 }, { lightOff: -.1 }, { lightOff: 5 }, { lightOn: -1 }, { gain: 0 }, { gain: NaN }, { peakWindow: 0 }, { timeUnit: 'minutes' }]) assert.throws(() => core.analyze(synthetic(), { ...defaults, ...setting }));
});
test('warns when baseline includes light-on samples', () => {
  const r = core.analyze(synthetic(), { ...defaults, baseline: 300 }); assert.ok(r.warnings.some(w => w.includes('baseline includes')));
});
test('locates headers through metadata, BOM, quoted fields, and alternate delimiters', () => {
  for (const delimiter of [',', '\t', ';']) {
    const text = '\uFEFFinstrument\r\n"Time"' + delimiter + '"Ampl"\r\n' + Array.from({ length: 8 }, (_, i) => `${i}${delimiter}${i ? '1e-3' : '0'}`).join('\r\n');
    const data = core.parseCSV(text); assert.equal(data.time.length, 8); assert.equal(data.amplitude[0], 0); assert.equal(data.amplitude[1], .001);
  }
});
test('rejects missing headers, NaNs, empty fields, duplicates, and malformed rows', () => {
  const good = 'Time,Ampl\n' + Array.from({ length: 8 }, (_, i) => `${i},.1`).join('\n');
  for (const text of ['', good.replace('Ampl', 'Current'), good.replace('3,.1', '3,NaN'), good.replace('3,.1', '3,'), good.replace('3,.1', '2,.1'), good.replace('3,.1', '3,"bad')]) assert.throws(() => core.parseCSV(text));
});
test('detects metadata count mismatch and uses actual rows', () => {
  const data = core.parseCSV('Segments,1,SegmentSize,10\nTime,Ampl\n' + Array.from({ length: 8 }, (_, i) => `${i},1`).join('\n'));
  assert.equal(data.time.length, 8); assert.equal(data.warnings.length, 1);
});
test('exports every measurement with fits only in their fitted intervals', () => {
  const r = core.analyze(synthetic(), defaults), rows = core.correctedCSV(r).trim().split('\r\n');
  assert.equal(rows.length, r.time.length + 1); assert.equal(rows[1].split(',')[3], '');
  near(Number(rows[r.on.start + 1].split(',')[3]), r.on.a); assert.equal(rows[r.off.start + 1].split(',')[5], 'light-off');
  const summary = core.summaryCSV(r); assert.match(summary, /Tau_s/); assert.match(summary, /baseline,100/); assert.match(summary, /light-off,fitted/);
});
test('disabling fitting preserves corrected data and contains no fit parameters', () => {
  const data = synthetic();
  const fitted = core.analyze(data, defaults), r = core.analyze(data, { ...defaults, fitEnabled: false });
  assert.deepEqual(r.signal, fitted.signal); assert.deepEqual(r.time, fitted.time); assert.equal(r.baseline, fitted.baseline);
  assert.equal(r.settings.fitEnabled, false);
  for (const f of [r.on, r.off]) {
    assert.equal(f.disabled, true); assert.equal(f.ok, false);
    for (const key of ['tau', 'halfTime', 'r2', 'fitted', 'peakTime']) assert.equal(key in f, false);
  }
  const rows = core.correctedCSV(r).trim().split('\r\n').slice(1);
  assert.equal(rows.length, data.time.length);
  for (const row of rows) { assert.equal(row.split(',')[3], ''); assert.equal(row.split(',')[4], ''); }
  const summary = core.summaryCSV(r);
  assert.match(summary, /light-on,disabled/); assert.match(summary, /light-off,disabled/); assert.match(summary, /fitEnabled,false/);
  assert.doesNotMatch(summary, /,failed,/);
});
test('data-only analysis ignores fit-only settings and works without a light event in the record', () => {
  const data = synthetic();
  const r = core.analyze(data, { ...defaults, fitEnabled: false, peakWindow: NaN, lightOn: 10, lightOff: 11 });
  assert.equal(r.onStart, data.time.length); assert.equal(r.offStart, data.time.length); assert.equal(r.on.segmentSamples, 0); assert.equal(r.off.segmentSamples, 0);
  assert.ok(core.correctedCSV(r).trim().split('\r\n').slice(1).every(row => row.endsWith(',baseline')));
  assert.throws(() => core.analyze(data, { ...defaults, fitEnabled: true, peakWindow: NaN }));
  const flat = { ...data, amplitude: data.amplitude.map(() => .1) };
  assert.equal(core.analyze(flat, { ...defaults, fitEnabled: false }).off.disabled, true);
});
test('re-enabling fitting recalculates original results without stale disabled fields', () => {
  const data = synthetic(), before = core.analyze(data, defaults);
  core.analyze(data, { ...defaults, fitEnabled: false });
  const after = core.analyze(data, { ...defaults, fitEnabled: true });
  for (const phase of ['on', 'off']) { assert.equal(after[phase].ok, true); assert.equal(after[phase].disabled, undefined); near(after[phase].tau, before[phase].tau); }
  assert.throws(() => core.analyze(data, { ...defaults, fitEnabled: 'false' }));
});
test('fits the original HEBR sample and flags its weak light-off fit', (t) => {
  const input = process.env.SSPC_SAMPLE || require('node:path').join(__dirname, '../sample/HEBR_ss.csv');
  if (!fs.existsSync(input)) return t.skip('Set SSPC_SAMPLE or place the sample in the adjacent sample folder.');
  const data = core.parseCSV(fs.readFileSync(input, 'utf8'));
  const r = core.analyze(data, { ...defaults, baseline: 1000 });
  assert.equal(r.time.length, 12501); assert.equal(r.on.ok, true); assert.equal(r.off.ok, true);
  near(r.baseline, -.0154468329984, 1e-12); near(r.on.tau, .0432824722, 1e-6); near(r.off.tau, .2967353603, 1e-6);
  assert.ok(r.off.warnings.length > 0); assert.equal(core.correctedCSV(r).trim().split('\r\n').length, 12502);
});
