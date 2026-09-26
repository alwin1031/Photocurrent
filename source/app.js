'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const defaults = { gain: 200, baseline: 1000, lightOn: 0, lightOff: .85, peakWindow: 250, timeUnit: 's', fitEnabled: true };
  const state = { data: null, result: null, name: '', dirty: false, busy: false, version: 0, worker: null, view: null };
  const fmt = (v, digits = 5) => !Number.isFinite(v) ? '—' : v === 0 ? '0' : Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4 ? v.toExponential(3) : Number(v.toPrecision(digits)).toString();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function settings() { return Object.fromEntries(Object.keys(defaults).map(k => [k, typeof defaults[k] === 'boolean' ? $(k).checked : k === 'timeUnit' ? $(k).value : $(k).value.trim() === '' ? NaN : Number($(k).value)])); }
  function syncFittingControls() {
    const enabled = $('fitEnabled').checked;
    $('peakWindow').disabled = !enabled;
    for (const key of ['showOn', 'showOff']) { $(key).disabled = !enabled; $(key).closest('label').hidden = !enabled; }
    $('responseHeading').hidden = !enabled; $('fitResults').hidden = !enabled; $('fitDisabledNote').hidden = enabled;
    $('chartDescription').textContent = enabled ? 'Baseline corrected · Single-exponential fit' : 'Baseline corrected · Fitting off';
    $('chart').setAttribute('aria-label', enabled ? 'Corrected photocurrent and fitted light responses' : 'Corrected photocurrent without fitting');
  }
  function applyDefaults(preserveFit = false) {
    Object.entries(defaults).forEach(([k, v]) => { if (preserveFit && k === 'fitEnabled') return; if (typeof v === 'boolean') $(k).checked = v; else $(k).value = v; });
    syncFittingControls();
  }
  function title() { return $('plotTitle').value.trim() || state.name.replace(/\.[^.]+$/, '') || 'Photocurrent response'; }
  function setStatus(text, kind = '') { $('statusBadge').textContent = text; $('statusBadge').className = `status-badge ${kind}`; }
  function showError(message) { $('errorBox').textContent = message || ''; $('errorBox').hidden = !message; }
  function enableExports() { document.querySelectorAll('.export-button').forEach(b => { b.disabled = !state.result || state.dirty || state.busy || state.plotError; }); }
  function setBusy(busy) { state.busy = busy; $('analyzeButton').disabled = busy || !state.data; $('analyzeLabel').textContent = busy ? 'Analyzing…' : 'Analyze measurement'; enableExports(); }
  function cancelAnalysis() { state.version++; if (state.worker) { state.worker.terminate(); state.worker = null; } setBusy(false); }
  function invalidate() {
    if (!state.data) return;
    cancelAnalysis(); state.dirty = true; enableExports();
    if (state.result) setStatus('Settings changed · Reanalyze', 'pending');
    showError('');
  }
  let toastTimer;
  function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
  function resetResults() {
    state.result = null; state.view = null;
    $('emptyState').hidden = false; $('chart').setAttribute('hidden', ''); $('chartTooltip').hidden = true;
    $('statCount').textContent = '—'; $('statRange').textContent = '—'; $('statSpacing').textContent = '—'; $('statBaseline').textContent = '—';
    for (const phase of ['on', 'off']) {
      for (const key of ['Tau', 'Half', 'R2', 'Peak', 'Samples']) $(phase + key).textContent = '—';
      $(phase + 'Quality').textContent = 'Awaiting data'; $(phase + 'Quality').className = 'quality'; $(phase + 'Note').hidden = true;
    }
    $('warningsBox').hidden = true; $('dataRows').replaceChildren(); $('resetView').disabled = true;
    $('lastAnalysis').textContent = 'Ready for analysis.'; enableExports();
  }
  async function loadText(text, name, token) {
    if (token !== state.version) return;
    try {
      const data = SSPC.parseCSV(text);
      if (token !== state.version) return;
      state.data = data; state.name = name; state.dirty = true;
      $('dropTitle').textContent = name; $('dropSubtitle').textContent = `${data.time.length.toLocaleString()} measurements · Click to replace`;
      $('plotTitle').value = name.replace(/\.[^.]+$/, '');
      $('measurementHeading').textContent = title(); $('measurementDescription').textContent = `${name} · Ready for analysis`;
      setStatus('Measurement loaded'); setBusy(false); await runAnalysis();
    } catch (e) { if (token === state.version) { showError(e.message); setStatus('File needs attention', 'pending'); setBusy(false); } }
  }
  async function loadFile(file) {
    if (!file) return;
    cancelAnalysis(); const token = state.version;
    state.data = null; state.name = ''; resetResults(); showError('');
    $('measurementHeading').textContent = 'Your next measurement'; $('measurementDescription').textContent = 'Reading your CSV file…';
    $('dropTitle').textContent = 'Choose a CSV file'; $('dropSubtitle').textContent = 'or drop it here · up to 20 MB';
    if (file.size > 20 * 1024 * 1024) { showError('This file is larger than 20 MB. Choose a smaller CSV.'); setStatus('File too large', 'pending'); return; }
    setStatus('Reading measurement…');
    try { await loadText(await file.text(), file.name, token); }
    catch (e) { if (token === state.version) { showError(`Could not read this file: ${e.message}`); setStatus('File needs attention', 'pending'); } }
  }
  function loadSample() {
    cancelAnalysis(); state.data = null; resetResults(); showError('');
    applyDefaults(true);
    const sample = JSON.parse($('sampleData').textContent); loadText(sample.csv, sample.name, state.version);
  }
  async function runAnalysis() {
    if (!state.data) return;
    cancelAnalysis(); const token = state.version;
    showError(''); setBusy(true); setStatus('Analyzing measurement…');
    state.dirty = true;
    const currentSettings = settings();
    const complete = result => {
      if (token !== state.version) return;
      state.result = result; state.view = null; state.dirty = false; setBusy(false);
      if (state.worker) { state.worker.terminate(); state.worker = null; }
      renderResult();
    };
    const failed = message => {
      if (token !== state.version) return;
      if (state.worker) { state.worker.terminate(); state.worker = null; }
      setBusy(false); showError(message); setStatus('Check analysis settings', 'pending');
    };
    const fallback = () => setTimeout(() => { if (token !== state.version) return; try { complete(SSPC.analyze(state.data, currentSettings)); } catch (e) { failed(e.message); } }, 30);
    try {
      const source = $('analysisCore').textContent + '\nself.onmessage = function(e) { try { self.postMessage({ result: SSPC.analyze(e.data.data, e.data.settings) }); } catch (error) { self.postMessage({ error: error.message }); } };';
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      let worker;
      try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      state.worker = worker;
      worker.onmessage = e => e.data.error ? failed(e.data.error) : complete(e.data.result);
      worker.onerror = e => { e.preventDefault(); worker.terminate(); if (token !== state.version) return; state.worker = null; fallback(); };
      worker.postMessage({ data: state.data, settings: currentSettings });
    } catch (_) { fallback(); }
  }
  function renderResult() {
    const r = state.result;
    syncFittingControls();
    $('measurementHeading').textContent = title(); $('measurementDescription').textContent = `${state.name} · Baseline corrected and scaled to nA`;
    $('statCount').textContent = r.time.length.toLocaleString();
    $('statRange').innerHTML = `${fmt(r.time[0], 4)} → ${fmt(r.time.at(-1), 4)} <small>s</small>`;
    $('statSpacing').innerHTML = `${fmt(r.meanSpacing * 1e6, 4)} <small>µs</small>`;
    $('statBaseline').textContent = fmt(r.baseline, 6);
    $('statBaseline').title = `Mean of the first ${r.settings.baseline} raw samples, before scaling`;
    let issue = r.warnings.length > 0;
    for (const phase of ['on', 'off']) {
      const f = r[phase];
      $(phase + 'Tau').innerHTML = `${f.ok ? fmt(f.tau) : '—'} <small>s</small>`;
      $(phase + 'Half').innerHTML = `${f.ok ? fmt(f.halfTime) : '—'} <small>s</small>`;
      $(phase + 'R2').textContent = f.ok ? fmt(f.r2, 4) : '—';
      $(phase + 'Peak').textContent = f.ok ? `${fmt(f.peakAmplitude, 4)} nA` : '—';
      $(phase + 'Samples').textContent = f.ok ? f.count.toLocaleString() : '—';
      const caution = !f.disabled && (!f.ok || f.warnings.length);
      issue ||= Boolean(caution);
      $(phase + 'Quality').textContent = f.disabled ? 'Fitting off' : !f.ok ? 'Fit unavailable' : caution ? 'Inspect fit' : 'Fit complete';
      $(phase + 'Quality').className = `quality${caution ? ' warning' : ''}`;
      $(phase + 'Note').textContent = !f.ok ? f.message : f.warnings.join(' '); $(phase + 'Note').hidden = !caution;
      $(phase + 'Card').title = f.ok ? `Peak time: ${fmt(f.peakTime)} s. Fitted plateau: ${fmt(f.plateau)} nA. RMSE: ${fmt(f.rmse)} nA.` : f.message;
    }
    setStatus(issue ? 'Complete · Review notes' : r.settings.fitEnabled ? 'Analysis complete' : 'Data processed · Fitting off', issue ? 'pending' : 'success');
    $('warningsBox').replaceChildren(...r.warnings.map(w => { const p = document.createElement('p'); p.textContent = w; return p; }));
    $('warningsBox').hidden = !r.warnings.length;
    $('emptyState').hidden = true; $('chart').removeAttribute('hidden'); $('resetView').disabled = false;
    $('lastAnalysis').textContent = `Analyzed ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    drawChart(); renderTable(); enableExports();
  }
  function renderTable() {
    const r = state.result;
    $('previewCount').textContent = `First ${Math.min(100, r.time.length)} of ${r.time.length.toLocaleString()} rows`;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < Math.min(100, r.time.length); i++) {
      const tr = document.createElement('tr');
      for (const v of [r.time[i], r.raw[i], r.signal[i], r.on.ok && i >= r.on.start && i < r.on.end ? r.on.fitted[i - r.on.start] : null, r.off.ok && i >= r.off.start && i < r.off.end ? r.off.fitted[i - r.off.start] : null]) { const td = document.createElement('td'); td.textContent = v === null ? '—' : fmt(v, 8); tr.append(td); }
      fragment.append(tr);
    }
    $('dataRows').replaceChildren(fragment);
  }
  const plot = { left: 80, top: 32, width: 894, height: 343 };
  function lowerBound(values, target) { let lo = 0, hi = values.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid] < target) lo = mid + 1; else hi = mid; } return lo; }
  function axesRange() {
    const r = state.result, span = r.time.at(-1) - r.time[0];
    const x = state.view || [r.time[0] - span * .015, r.time.at(-1) + span * .015];
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < r.time.length; i++) {
      if (r.time[i] < x[0] || r.time[i] > x[1]) continue;
      min = Math.min(min, r.signal[i]); max = Math.max(max, r.signal[i]);
      for (const phase of ['on', 'off']) { const f = r[phase]; if ($(phase === 'on' ? 'showOn' : 'showOff').checked && f.ok && i >= f.start && i < f.end) { const y = f.fitted[i - f.start]; min = Math.min(min, y); max = Math.max(max, y); } }
    }
    if (!Number.isFinite(min)) { min = -1; max = 1; }
    let y;
    if ($('yMode').value === 'original') y = [-4, 6];
    else if ($('yMode').value === 'manual') {
      const a = $('yMin').value.trim() === '' ? NaN : Number($('yMin').value), b = $('yMax').value.trim() === '' ? NaN : Number($('yMax').value);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) throw new Error('The lower plot limit must be smaller than the upper plot limit.');
      y = [a, b];
    } else { const pad = Math.max(max - min, Math.abs(max) * .1, 1e-9) * .12; y = [min - pad, max + pad]; }
    return { x, y };
  }
  function ticks(min, max, target) {
    const rough = (max - min) / target, power = 10 ** Math.floor(Math.log10(rough));
    const rel = rough / power, step = (rel >= 5 ? 5 : rel >= 2 ? 2 : 1) * power;
    const values = [];
    for (let value = Math.ceil(min / step) * step, i = 0; value <= max + step * 1e-8 && i < 30; value += step, i++) values.push(Math.abs(value) < step * 1e-8 ? 0 : value);
    return values;
  }
  function signalPath(time, values, offset, range, px, py, budget = 900) {
    let start = Math.max(0, lowerBound(time, range[0]) - 1 - offset), end = Math.min(values.length, lowerBound(time, range[1]) + 1 - offset);
    start = Math.min(values.length, start); end = Math.max(start, end);
    if (end <= start) return '';
    const stride = Math.max(1, Math.ceil((end - start) / budget)), indices = [start];
    for (let i = start; i < end; i += stride) {
      let lo = i, hi = i;
      for (let j = i + 1; j < Math.min(end, i + stride); j++) { if (values[j] < values[lo]) lo = j; if (values[j] > values[hi]) hi = j; }
      if (lo < hi) indices.push(lo, hi); else if (hi < lo) indices.push(hi, lo); else indices.push(lo);
    }
    indices.push(end - 1);
    return indices.map((i, j) => `${j ? 'L' : 'M'}${px(time[i + offset]).toFixed(2)},${py(values[i]).toFixed(2)}`).join('');
  }
  function plotSVG(forExport = false) {
    const r = state.result, range = axesRange();
    const narrow = !forExport && $('chartShell').clientWidth < 500, canvasWidth = narrow ? 600 : 1000;
    const p = { left: 80, top: 32, width: canvasWidth - 106, height: 343 };
    if (!forExport) { state.range = range; Object.assign(plot, p); $('chart').setAttribute('viewBox', `0 0 ${canvasWidth} 440`); }
    const px = t => p.left + (t - range.x[0]) / (range.x[1] - range.x[0]) * p.width;
    const py = y => p.top + p.height - (y - range.y[0]) / (range.y[1] - range.y[0]) * p.height;
    const parts = [`<defs><clipPath id="plotClip"><rect x="${p.left}" y="${p.top}" width="${p.width}" height="${p.height}"/></clipPath></defs>`, `<rect width="${canvasWidth}" height="440" fill="white"/>`];
    const onX = Math.max(p.left, Math.min(p.left + p.width, px(r.settings.lightOn))), offX = Math.max(p.left, Math.min(p.left + p.width, px(r.settings.lightOff)));
    parts.push(`<rect x="${onX}" y="${p.top}" width="${Math.max(0, offX - onX)}" height="${p.height}" fill="#f0f4e9"/>`);
    for (const y of ticks(...range.y, 5)) parts.push(`<path d="M${p.left} ${py(y)}H${p.left + p.width}" stroke="#eeeef0" stroke-width="1"/><text x="${p.left - 15}" y="${py(y) + 4}" text-anchor="end" fill="#94909d" font-size="12">${esc(fmt(y, 5))}</text>`);
    for (const t of ticks(...range.x, narrow ? 4 : 6)) parts.push(`<path d="M${px(t)} ${p.top + p.height}v5" stroke="#cecbd3"/><text x="${px(t)}" y="${p.top + p.height + 24}" text-anchor="middle" fill="#94909d" font-size="12">${esc(fmt(t, 5))}</text>`);
    parts.push(`<path d="M${p.left} ${p.top}v${p.height}h${p.width}" fill="none" stroke="#d0cdd5"/>`);
    parts.push(`<g clip-path="url(#plotClip)"><path d="M${p.left} ${py(0)}h${p.width}" stroke="#b8b4c0" stroke-width="1" stroke-dasharray="3 5"/>`);
    for (const boundary of [r.settings.lightOn, r.settings.lightOff]) parts.push(`<path d="M${px(boundary)} ${p.top}v${p.height}" stroke="#d8dfcd" stroke-dasharray="3 5"/>`);
    if ($('showSignal').checked) parts.push(`<path d="${signalPath(r.time, r.signal, 0, range.x, px, py)}" stroke="#a0a1aa" stroke-width=".85" stroke-opacity=".65" fill="none"/>`);
    for (const [phase, color] of [['on', '#bc7940'], ['off', '#7860b8']]) {
      const f = r[phase];
      if (!f.ok || !$(phase === 'on' ? 'showOn' : 'showOff').checked) continue;
      parts.push(`<path d="${signalPath(r.time, f.fitted, f.start, range.x, px, py, 450)}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linejoin="round"/><circle cx="${px(f.peakTime)}" cy="${py(f.a)}" r="3.3" fill="white" stroke="${color}" stroke-width="1.8"/>`);
    }
    parts.push('</g>');
    if (offX - onX > 65) parts.push(`<text x="${(onX + offX) / 2}" y="20" text-anchor="middle" fill="#8e9c78" font-size="10" letter-spacing="1.2">LIGHT ON</text>`);
    parts.push(`<text x="${p.left + p.width / 2}" y="430" text-anchor="middle" fill="#82798f" font-size="12">Time (s)</text><text transform="translate(20 ${p.top + p.height / 2}) rotate(-90)" text-anchor="middle" fill="#82798f" font-size="12">Photocurrent (nA)</text>`);
    const content = parts.join('');
    return `<g font-family="Arial, Helvetica, sans-serif">${narrow ? content.replace(/font-size="12"/g, 'font-size="18"').replace(/font-size="10"/g, 'font-size="15"') : content}</g>`;
  }
  function drawChart() {
    if (!state.result) return;
    try { $('chart').innerHTML = plotSVG(); state.plotError = false; if (state.errorFromPlot) showError(''); state.errorFromPlot = false; }
    catch (e) { state.plotError = true; state.errorFromPlot = true; showError(e.message); }
    enableExports();
  }
  function svgPosition(e) {
    const point = $('chart').createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
    return point.matrixTransform($('chart').getScreenCTM().inverse());
  }
  function inspect(e) {
    if (!state.result || !state.range) return;
    const pos = svgPosition(e), p = plot;
    if (pos.x < p.left || pos.x > p.left + p.width || pos.y < p.top || pos.y > p.top + p.height) { $('chartTooltip').hidden = true; return; }
    const r = state.result, t = state.range.x[0] + (pos.x - p.left) / p.width * (state.range.x[1] - state.range.x[0]);
    let i = Math.min(r.time.length - 1, lowerBound(r.time, t));
    if (i && Math.abs(r.time[i - 1] - t) < Math.abs(r.time[i] - t)) i--;
    let lines = `<strong>${fmt(r.time[i], 7)} s</strong><br>Measured: ${fmt(r.signal[i], 6)} nA`;
    for (const phase of ['on', 'off']) { const f = r[phase]; if (f.ok && i >= f.start && i < f.end) lines += `<br>Light ${phase} fit: ${fmt(f.fitted[i - f.start], 6)} nA`; }
    $('chartTooltip').innerHTML = lines; $('chartTooltip').hidden = false;
    const box = $('chartShell').getBoundingClientRect();
    $('chartTooltip').style.left = `${Math.max(0, Math.min(e.clientX - box.left + 14, box.width - $('chartTooltip').offsetWidth - 4))}px`;
    $('chartTooltip').style.top = `${Math.max(0, e.clientY - box.top - $('chartTooltip').offsetHeight - 10)}px`;
  }
  function zoom(e) {
    if (!state.result || !state.range) return;
    const point = svgPosition(e);
    if (point.x < plot.left || point.x > plot.left + plot.width || point.y < plot.top || point.y > plot.top + plot.height) return;
    e.preventDefault(); $('chartTooltip').hidden = true;
    const r = state.result, range = state.range.x, fraction = (point.x - plot.left) / plot.width, center = range[0] + fraction * (range[1] - range[0]);
    const fullSpan = r.time.at(-1) - r.time[0], fullLo = r.time[0] - .015 * fullSpan, fullHi = r.time.at(-1) + .015 * fullSpan;
    const span = Math.min(fullHi - fullLo, Math.max(r.meanSpacing * 12, (range[1] - range[0]) * (e.deltaY > 0 ? 1.18 : .85)));
    let lo = center - fraction * span; lo = Math.max(fullLo, Math.min(lo, fullHi - span));
    state.view = [lo, lo + span]; drawChart();
  }
  let exportURL = null;
  function download(contents, mime, extension, suffix) {
    const blob = contents instanceof Blob ? contents : new Blob([contents], { type: mime });
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = URL.createObjectURL(blob);
    const filename = (title().replace(/[^\p{L}\p{N}_ .-]/gu, '_').replace(/^\.+/, '').trim() || 'measurement') + suffix + '.' + extension;
    $('downloadLink').href = exportURL; $('downloadLink').download = filename;
    $('exportHeading').textContent = filename;
    $('exportDescription').textContent = `${extension.toUpperCase()} · ${(blob.size / 1024).toFixed(1)} KB${extension === 'png' ? ' · 4800 × 2880 pixels' : ''}`;
    const isImage = mime.startsWith('image/');
    $('exportPreview').hidden = !isImage;
    if (isImage) $('exportPreview').src = exportURL; else $('exportPreview').removeAttribute('src');
    $('exportDialog').showModal();
  }
  function exportSVGText() {
    const r = state.result;
    const fits = ['on', 'off'].map(k => r[k].disabled ? `Light ${k}: fitting off` : r[k].ok ? `Light ${k}: τ ${fmt(r[k].tau)} s · t½ ${fmt(r[k].halfTime)} s · R² ${fmt(r[k].r2, 4)}` : `Light ${k}: fit unavailable`);
    const hasNotes = r.warnings.length || ['on', 'off'].some(k => !r[k].disabled && (!r[k].ok || r[k].warnings.length));
    const description = r.settings.fitEnabled ? 'Baseline-corrected photocurrent with positive-tau exponential fits.' : 'Baseline-corrected photocurrent. Exponential fitting is disabled.';
    const legend = r.settings.fitEnabled ? 'Grey: measured signal · Amber: light on fit · Purple: light off fit · Green area: light on' : 'Grey: measured signal · Green area: light on · Fitting disabled';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><title>${esc(title())}</title><desc>${description} ${esc(fits.join('. '))}. ${hasNotes ? 'Inspect notes in the exported summary.' : ''}</desc><rect width="1000" height="600" fill="white"/><g font-family="Arial, Helvetica, sans-serif"><text x="80" y="37" font-size="24" font-weight="600" fill="#292532">${esc(title().slice(0, 62))}</text><text x="80" y="62" font-size="11" fill="#8f879b">Baseline: first ${r.settings.baseline} samples · Scale: ${r.settings.gain} · Light: ${r.settings.lightOn}–${r.settings.lightOff} s</text></g><g transform="translate(0 80)">${plotSVG(true)}</g><g font-family="Arial, Helvetica, sans-serif" font-size="11"><text x="80" y="545" fill="#aa6c32">${esc(fits[0])}</text><text x="540" y="545" fill="#7860b8">${esc(fits[1])}</text><text x="80" y="575" font-size="9" fill="#918b9a">SSPC Studio · ${legend}${hasNotes ? ' · See notes in summary' : ''}</text></g></svg>`;
  }
  async function exportPNG() {
    if (!state.result || state.dirty || state.busy || state.plotError) return;
    try {
      const text = exportSVGText(), url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
      const image = new Image();
      try { await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The browser could not render the image. Try the SVG export.')); image.src = url; }); }
      finally { URL.revokeObjectURL(url); }
      const canvas = document.createElement('canvas'); canvas.width = 4800; canvas.height = 2880;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image export is unavailable in this browser. Try SVG.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not create the PNG. Try the SVG export.');
      download(blob, 'image/png', 'png', '_photocurrent'); 
    } catch (e) { showError(e.message); }
  }
  $('dropZone').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
  for (const event of ['dragenter', 'dragover']) $('dropZone').addEventListener(event, e => { e.preventDefault(); $('dropZone').classList.add('drag-over'); });
  for (const event of ['dragleave', 'drop']) $('dropZone').addEventListener(event, e => { e.preventDefault(); $('dropZone').classList.remove('drag-over'); });
  $('dropZone').addEventListener('drop', e => { if (e.dataTransfer.files.length !== 1) { showError('Drop one CSV file at a time.'); return; } loadFile(e.dataTransfer.files[0]); });
  window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { e.preventDefault(); });
  $('sampleButton').addEventListener('click', loadSample); $('emptySample').addEventListener('click', loadSample);
  $('settingsForm').addEventListener('submit', e => { e.preventDefault(); runAnalysis(); });
  Object.keys(defaults).filter(k => k !== 'fitEnabled').forEach(k => { $(k).addEventListener(k === 'timeUnit' ? 'change' : 'input', invalidate); });
  $('fitEnabled').addEventListener('change', () => { syncFittingControls(); invalidate(); if (state.data) runAnalysis(); });
  $('plotTitle').addEventListener('input', () => { if (state.data) $('measurementHeading').textContent = title(); });
  $('resetSettings').addEventListener('click', () => { applyDefaults(); invalidate(); toast('Original analysis settings restored.'); });
  $('plotSettingsButton').addEventListener('click', () => { const hidden = !$('plotSettings').hidden; $('plotSettings').hidden = hidden; $('plotSettingsButton').setAttribute('aria-expanded', String(!hidden)); });
  $('yMode').addEventListener('change', () => { const manual = $('yMode').value === 'manual'; $('yMin').disabled = !manual; $('yMax').disabled = !manual; drawChart(); });
  for (const key of ['yMin', 'yMax']) $(key).addEventListener('input', drawChart);
  for (const key of ['showSignal', 'showOn', 'showOff']) $(key).addEventListener('change', drawChart);
  $('resetView').addEventListener('click', () => { state.view = null; drawChart(); });
  $('chart').addEventListener('pointermove', inspect); $('chart').addEventListener('pointerleave', () => { $('chartTooltip').hidden = true; });
  $('chart').addEventListener('wheel', zoom, { passive: false });
  $('chart').addEventListener('dblclick', () => { state.view = null; drawChart(); });
  $('exportPNG').addEventListener('click', exportPNG);
  $('exportSVG').addEventListener('click', () => { if (!state.result || state.dirty || state.plotError) return; try { download(exportSVGText(), 'image/svg+xml;charset=utf-8', 'svg', '_photocurrent');  } catch (e) { showError(e.message); } });
  $('exportData').addEventListener('click', () => {
    if (!state.result || state.dirty || state.busy) return;
    const kind = $('csvKind').value;
    if (kind === 'json') download(JSON.stringify({ application: 'SSPC Studio', version: '1.1', sourceFile: state.name, title: title(), generatedAt: new Date().toISOString(), model: state.result.settings.fitEnabled ? 'I(t) = (a-p) exp(-(t-t0)/tau) + p; tau > 0' : null, ...state.result }, null, 2), 'application/json', 'json', '_analysis');
    else download(kind === 'summary' ? SSPC.summaryCSV(state.result) : SSPC.correctedCSV(state.result), 'text/csv;charset=utf-8', 'csv', kind === 'summary' ? '_fit_summary' : '_corrected');
    
  });
  $('closeExport').addEventListener('click', () => $('exportDialog').close());
  new ResizeObserver(() => { if (state.result) drawChart(); }).observe($('chartShell'));
  $('methodButton').addEventListener('click', () => $('methodDialog').showModal());
  $('closeMethod').addEventListener('click', () => $('methodDialog').close()); $('methodDone').addEventListener('click', () => $('methodDialog').close());
  $('methodDialog').addEventListener('click', e => { if (e.target !== $('methodDialog')) return; const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); });
  syncFittingControls();
  if (new URLSearchParams(location.search).get('sample') === '1') loadSample();
})();
