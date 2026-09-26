/* Numerical analysis for SSPC Studio. No network or third-party libraries. */
(function (root) {
  'use strict';
  const MAX_SAMPLES = 200000;
  const finite = Number.isFinite;
  function fail(message) { throw new Error(message); }
  function parseDelimited(line, delimiter) {
    const values = []; let field = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (c === delimiter && !quoted) { values.push(field.trim()); field = ''; }
      else field += c;
    }
    if (quoted) fail('A CSV row contains an unclosed quote. Use one measurement per line.');
    values.push(field.trim()); return values;
  }
  function parseCSV(text) {
    if (typeof text !== 'string' || !text.trim()) fail('The file is empty. Choose a CSV containing Time and Ampl columns.');
    const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    let header = -1, columns, delimiter;
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
      for (const sep of [',', '\t', ';']) {
        const row = parseDelimited(lines[i], sep).map(v => v.toLowerCase());
        if (row.includes('time') && row.includes('ampl')) { header = i; columns = row; delimiter = sep; break; }
      }
      if (header >= 0) break;
    }
    if (header < 0) fail('No Time and Ampl header was found in the first 100 lines. Use the original oscilloscope CSV or a two-column CSV with those names.');
    if (columns.filter(v => v === 'time').length !== 1 || columns.filter(v => v === 'ampl').length !== 1) fail('The Time and Ampl column names must each appear once.');
    const ti = columns.indexOf('time'), yi = columns.indexOf('ampl');
    const time = [], amplitude = [];
    const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
    for (let i = header + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = parseDelimited(lines[i], delimiter);
      const ts = cells[ti], ys = cells[yi];
      if (!ts || !ys || !numberPattern.test(ts) || !numberPattern.test(ys)) fail(`Line ${i + 1} has a missing or nonnumeric Time or Ampl value.`);
      const t = Number(ts), y = Number(ys);
      if (!finite(t) || !finite(y)) fail(`Line ${i + 1} contains a value outside the supported numeric range.`);
      if (time.length && t <= time[time.length - 1]) fail(`Time must increase on every row. Check line ${i + 1} for duplicate or out-of-order timestamps.`);
      time.push(t); amplitude.push(y);
      if (time.length > MAX_SAMPLES) fail(`This version supports up to ${MAX_SAMPLES.toLocaleString()} measurements per file.`);
    }
    if (time.length < 8) fail('At least 8 numeric measurements are required.');
    const warnings = [];
    let declaredCount = null;
    for (let i = 0; i < header; i++) {
      const cells = parseDelimited(lines[i], delimiter);
      const pos = cells.findIndex(v => v.toLowerCase() === 'segmentsize');
      if (pos >= 0 && /^\d+$/.test(cells[pos + 1] || '')) declaredCount = Number(cells[pos + 1]);
    }
    if (declaredCount !== null && declaredCount !== time.length) warnings.push(`The metadata declares ${declaredCount} samples; ${time.length} numeric rows were found. Analysis uses the actual rows.`);
    return { time, amplitude, warnings, metadataLines: header, declaredCount };
  }
  function validate(data, settings) {
    if (typeof settings.fitEnabled !== 'boolean') fail('Fitting must be enabled or disabled.');
    for (const k of ['gain', 'baseline', 'lightOn', 'lightOff', ...(settings.fitEnabled ? ['peakWindow'] : [])]) if (!finite(settings[k])) fail('Fill in every analysis setting with a finite number.');
    if (!settings.gain) fail('The scale factor cannot be zero.');
    if (!Number.isInteger(settings.baseline) || settings.baseline < 1 || settings.baseline > data.time.length) fail(`Baseline samples must be a whole number from 1 to ${data.time.length.toLocaleString()}.`);
    if (settings.fitEnabled && (!Number.isInteger(settings.peakWindow) || settings.peakWindow < 1 || settings.peakWindow > MAX_SAMPLES)) fail(`Peak search must be a whole number from 1 to ${MAX_SAMPLES.toLocaleString()}.`);
    if (!(settings.lightOff > settings.lightOn)) fail('Light-off time must be later than light-on time.');
    if (!['s', 'ms', 'us'].includes(settings.timeUnit)) fail('Choose seconds, milliseconds, or microseconds for the CSV time unit.');
  }
  function fitSegment(time, signal, start, end, peakWindow) {
    const n = end - start;
    if (n < 6) return { ok: false, message: 'At least 6 measurements are needed in this interval.', segmentSamples: n };
    let peak = start;
    for (let i = start + 1; i < Math.min(end, start + peakWindow); i++) if (Math.abs(signal[i]) > Math.abs(signal[peak])) peak = i;
    const count = end - peak;
    if (count < 6) return { ok: false, message: 'Fewer than 6 measurements remain after the peak. Reduce the peak search window or adjust the light times.', segmentSamples: n };
    const t0 = time[peak], span = time[end - 1] - t0;
    const dt = new Float64Array(count), y = new Float64Array(count);
    let mean = 0, minDt = Infinity;
    for (let i = 0; i < count; i++) { dt[i] = time[peak + i] - t0; y[i] = signal[peak + i]; mean += y[i] / count; if (i) minDt = Math.min(minDt, dt[i] - dt[i - 1]); }
    let total = 0, maxAbs = 0;
    for (let i = 0; i < count; i++) { total += (y[i] - mean) ** 2; maxAbs = Math.max(maxAbs, Math.abs(y[i])); }
    if (!finite(total) || !finite(span) || span <= 0) return { ok: false, message: 'The values exceed the numerical range of this fit.', segmentSamples: n };
    if (total / count <= Math.max(maxAbs ** 2 * 1e-24, 1e-30)) return { ok: false, message: 'The signal is flat; a time constant cannot be determined.', segmentSamples: n };
    const basis = new Float64Array(count);
    // For each positive tau, solve the linear coefficients analytically.
    // Centering the basis avoids subtracting large, nearly equal moments.
    function profile(logTau) {
      const tau = Math.exp(logTau); let em = 0;
      for (let i = 0; i < count; i++) { basis[i] = Math.exp(-dt[i] / tau); em += basis[i] / count; }
      let variance = 0, covariance = 0;
      for (let i = 0; i < count; i++) { const d = basis[i] - em; variance += d * d; covariance += d * (y[i] - mean); }
      if (!(variance > 0)) return { loss: Infinity };
      const b = covariance / variance, p = mean - b * em; let loss = 0;
      for (let i = 0; i < count; i++) loss += (y[i] - (b * basis[i] + p)) ** 2;
      return { loss, tau, a: b + p, p };
    }
    const low = Math.log(Math.max(minDt / 20, 1e-15)), high = Math.log(span * 10000);
    const steps = 100, grid = [], values = [];
    for (let i = 0; i <= steps; i++) { grid.push(low + (high - low) * i / steps); values.push(profile(grid[i])); }
    let best = values[0], bestLog = grid[0], bestGrid = 0;
    for (let i = 1; i <= steps; i++) if (values[i].loss < best.loss) { best = values[i]; bestLog = grid[i]; bestGrid = i; }
    // Refine every sampled local minimum, avoiding dependence on one initial guess.
    const phi = (Math.sqrt(5) - 1) / 2;
    for (let j = 1; j < steps; j++) {
      if (!(values[j].loss <= values[j - 1].loss && values[j].loss <= values[j + 1].loss)) continue;
      let lo = grid[j - 1], hi = grid[j + 1], x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo);
      let f1 = profile(x1), f2 = profile(x2);
      for (let k = 0; k < 64 && hi - lo > 1e-10; k++) {
        if (f1.loss < f2.loss) { hi = x2; x2 = x1; f2 = f1; x1 = hi - phi * (hi - lo); f1 = profile(x1); }
        else { lo = x1; x1 = x2; f1 = f2; x2 = lo + phi * (hi - lo); f2 = profile(x2); }
      }
      const candidate = f1.loss < f2.loss ? f1 : f2;
      if (candidate.loss < best.loss) { best = candidate; bestLog = f1.loss < f2.loss ? x1 : x2; }
    }
    if (![best.tau, best.a, best.p, best.loss].every(finite)) return { ok: false, message: 'No finite exponential fit was found.', segmentSamples: n };
    const r2 = 1 - best.loss / total, warnings = [];
    if (bestLog - low < .02 || high - bestLog < .02) warnings.push('The time constant reached a search limit and is not well determined.');
    else if (best.tau > span * 10) warnings.push('The fitted time constant is much longer than the measured interval. Treat it as uncertain.');
    else if (best.tau < minDt) warnings.push('The fitted time constant is shorter than the sampling interval. Treat it as uncertain.');
    if (r2 < .5) warnings.push('The exponential model explains less than half the signal variation (R² < 0.5). Inspect the fit.');
    const fitted = Array.from(dt, x => (best.a - best.p) * Math.exp(-x / best.tau) + best.p);
    return { ok: true, tau: best.tau, halfTime: Math.LN2 * best.tau, a: best.a, plateau: best.p, r2, rmse: Math.sqrt(best.loss / count), peakIndex: peak, peakTime: t0, peakAmplitude: signal[peak], peakMagnitude: Math.abs(signal[peak]), start: peak, end, count, segmentSamples: n, fitted, warnings, searchBounds: [Math.exp(low), Math.exp(high)] };
  }
  function analyze(data, settings) {
    settings = { fitEnabled: true, ...settings };
    validate(data, settings);
    const multiplier = { s: 1, ms: .001, us: .000001 }[settings.timeUnit];
    const time = data.time.map(t => t * multiplier), raw = data.amplitude;
    if (!time.every(finite)) fail('Time values exceed the supported numeric range.');
    for (let i = 1; i < time.length; i++) if (!(time[i] > time[i - 1])) fail('Time values lose precision after unit conversion. Use relative timestamps.');
    if (settings.fitEnabled && (settings.lightOn < time[0] || settings.lightOn >= time[time.length - 1])) fail('Light-on time must lie within the measured time range. Check the CSV time unit.');
    if (settings.fitEnabled && settings.lightOff >= time[time.length - 1]) fail('Light-off time must leave measurements after it. Check the CSV time unit.');
    let baseline = 0;
    for (let i = 0; i < settings.baseline; i++) baseline += raw[i] / settings.baseline;
    const signal = raw.map(y => (y - baseline) * settings.gain);
    if (!signal.every(finite)) fail('The scale factor produces values outside the supported numeric range.');
    const firstAt = boundary => { const i = time.findIndex(t => t >= boundary); return i < 0 ? time.length : i; };
    const onStart = firstAt(settings.lightOn), offStart = firstAt(settings.lightOff);
    const warnings = [...data.warnings];
    if (time[settings.baseline - 1] >= settings.lightOn) warnings.push('The baseline includes samples at or after light-on. Reduce the baseline sample count if a dark baseline is intended.');
    const meanSpacing = (time[time.length - 1] - time[0]) / (time.length - 1);
    if (time.some((t, i) => i && Math.abs(t - time[i - 1] - meanSpacing) > meanSpacing * .01)) warnings.push('Sampling is not uniform. Analysis uses the actual timestamps.');
    const skipped = n => ({ ok: false, disabled: true, message: 'Fitting is turned off.', segmentSamples: n });
    const on = settings.fitEnabled ? fitSegment(time, signal, onStart, offStart, settings.peakWindow) : skipped(offStart - onStart);
    const off = settings.fitEnabled ? fitSegment(time, signal, offStart, time.length, settings.peakWindow) : skipped(time.length - offStart);
    return { time, raw, signal, baseline, meanSpacing, onStart, offStart, on, off, settings: { ...settings }, warnings };
  }
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function correctedCSV(result) {
    const rows = [['Time_s', 'Ampl_raw', 'Photocurrent_nA', 'Light_on_fit_nA', 'Light_off_fit_nA', 'Phase']];
    for (let i = 0; i < result.time.length; i++) rows.push([result.time[i], result.raw[i], result.signal[i], result.on.ok && i >= result.on.start && i < result.on.end ? result.on.fitted[i - result.on.start] : '', result.off.ok && i >= result.off.start && i < result.off.end ? result.off.fitted[i - result.off.start] : '', i < result.onStart ? 'baseline' : i < result.offStart ? 'light-on' : 'light-off']);
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  function summaryCSV(result) {
    const rows = [['Phase', 'Status', 'Tau_s', 'Half_time_s', 'Peak_time_s', 'Peak_nA', 'Fit_start_nA', 'Plateau_nA', 'R_squared', 'RMSE_nA', 'Fit_samples', 'Notes']];
    for (const phase of ['on', 'off']) { const f = result[phase]; rows.push([`light-${phase}`, f.disabled ? 'disabled' : f.ok ? 'fitted' : 'failed', f.tau, f.halfTime, f.peakTime, f.peakAmplitude, f.a, f.plateau, f.r2, f.rmse, f.count, f.ok ? f.warnings.join(' ') : f.message]); }
    rows.push([], ['Setting', 'Value'], ...Object.entries(result.settings), ['baseline_raw', result.baseline], ['mean_spacing_s', result.meanSpacing], ['sample_count', result.time.length], ['method', result.settings.fitEnabled === false ? 'baseline correction and scaling; exponential fitting disabled' : 'positive-tau exponential profile least squares; time relative to detected peak'], ['warnings', result.warnings.join(' ')]);
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const api = { parseCSV, analyze, fitSegment, correctedCSV, summaryCSV, MAX_SAMPLES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSPC = api;
})(typeof globalThis === 'object' ? globalThis : this);
