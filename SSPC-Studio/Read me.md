# SSPC Studio 1.1

A local browser app based on your `sspc.py`, for steady-state photocurrent analysis.

## Open the app

1. Double-click **SSPC-Studio.html** to open it in your browser. If it opens in an editor, right-click it and choose **Open With → your browser**.
2. Choose your CSV, drag it onto the file box, or select **Try sample measurement**.
3. Check the scale factor, baseline sample count, and light times. Click **Analyze measurement** after changing a setting. Use **Fit exponential curves** to turn both fits on or off; switching it automatically updates the current measurement.
4. Inspect the plot, time constants, half-times, and any fit notes.
5. Choose PNG, SVG, or a data export. In the export window, click **Download file**.

The HTML file contains the whole app, including the sample. You can move that file anywhere or copy it to another computer. It needs no Python installation, internet connection, account, or server. Use a modern browser with JavaScript enabled.

Your measurements stay in the browser tab. Nothing is uploaded, and your original input files are not modified. Results are kept in memory; export them before refreshing or closing the tab.

## Input and settings

The app accepts the original oscilloscope format, including its metadata rows, or a simple file containing `Time` and `Ampl` columns. Commas, tabs, and semicolons are supported. Timestamps must be finite and strictly increasing; amplitude values must be finite numbers. The limit is one file at a time, 20 MB and 200,000 samples.

| Setting | Default | Meaning |
| --- | --- | --- |
| Scale factor | 200 | Multiply the baseline-corrected raw signal by this value to obtain nA. Check that it matches your measurement setup. |
| Baseline samples | 1000 | Subtract the mean of the first N raw samples. |
| Light on | 0 s | Start of illumination. |
| Light off | 0.85 s | End of illumination. |
| Peak search | 250 samples | Find the largest absolute corrected signal near the start of each interval. |
| Fit exponential curves | On | Turn off to skip fitting while preserving baseline correction, scaling, plotting, and data exports. |
| CSV time unit | Seconds | Change under Advanced settings for timestamps recorded in ms or µs. Light timing fields always use seconds. |

For files shorter than 1,000 rows, reduce the baseline count. A dark baseline should end before light-on. The app warns if your baseline extends into illumination.

Move your pointer over the plot to inspect measurements. Scroll over the plot to zoom around the pointer; **Reset view** or a double-click restores the full range. The legend switches individual curves on or off. Plot settings offer automatic scaling, custom vertical limits, or the script's original −4 to 6 nA limits.

## Results and exports

- **Time constant (τ)** and **half-time (t½)** are reported in seconds. Half-time is `τ × ln(2)`, measured toward the fitted plateau.
- **R²** describes how much measured variation the model explains. It is not a confidence interval. A low R² is flagged for inspection.
- **Peak** is the signed measured signal at the peak selected by absolute magnitude.
- **PNG** is 4800 × 2880 pixels. **SVG** is a scalable vector figure. Both reflect the current plot view and visible curves; reset the view for a complete plot. At a printed size of 8 × 4.8 inches, the PNG provides 600 pixels per inch.
- **Corrected data CSV** contains every timestamp (seconds), raw amplitude, corrected photocurrent, fitted values in their applicable intervals, and phase labels.
- **Fit summary CSV** contains the fitted parameters, half-times, R², RMSE, settings, and analysis notes.
- **Full analysis JSON** contains all measurements, fit arrays, settings, and results in a reusable structured file.

The displayed chart may reduce points while retaining local minima and maxima. Analysis and data exports use all measurements. If one interval cannot be fitted, the other interval and corrected data remain available. Changing analysis settings disables exports until you reanalyze. Turning **Fit exponential curves** off automatically processes the current file without fitting: fit curves, response-time cards, and fit legends disappear; CSV fit columns are blank; summary rows are labeled `disabled`; JSON contains no fitted parameters and has a null model. PNG/SVG exports show corrected measurements and say that fitting is off. Fit-only peak-search settings are ignored while fitting is off. Light event times may lie outside the record in this mode. Loading the sample preserves your fitting on/off choice; Reset restores all original defaults, including fitting on.

## How it relates to your Python script

The processing sequence is preserved: baseline subtraction → scaling → light-on/off grouping → absolute-peak search → single-exponential fit.

The model is:

`I(t) = (a − p) × exp(−(t − t₀) / τ) + p`

Here, `t₀` is the selected peak timestamp, `a` is the fitted signal at that timestamp, and `p` is the plateau. The browser implementation solves amplitude and plateau by linear least squares for each candidate positive τ, then refines local minima of the squared-error objective on a logarithmic τ scale.

Intentional differences from the script:

- Interval boundaries use the recorded timestamps directly, including a measurement exactly at light-on or light-off in the interval that begins there.
- Time is consistently converted to and labeled in seconds.
- The time origin is shifted to the detected peak to avoid exponential overflow with large absolute timestamps.
- τ is constrained to be positive. Its search extends from one-twentieth of the minimum sampling interval to 10,000 times the fit duration; extreme or poorly resolved results are flagged.
- The chart initially scales to the full data range instead of using the script's fixed limits.
- Errors and unsuccessful fits are explained instead of crashing the whole workflow.

Because of these changes, fitted values may differ from the original unconstrained SciPy fit. This is a browser implementation of the analysis, not an embedded Python runtime. The original script is included for reference and was not modified.

## Included sample and verification

The bundled `HEBR_ss.csv` comes from the `test` folder beside your script and contains 12,501 measurements. With the defaults, expected results are approximately:

| Phase | τ (s) | t½ (s) | R² |
| --- | ---: | ---: | ---: |
| Light on | 0.04328247 | 0.03000112 | 0.8006007 |
| Light off | 0.29673536 | 0.20568128 | 0.2433116 |

The light-off fit is flagged because it explains less than half of the measured variation.

Seventeen automated tests cover known synthetic time constants, signal polarity, time units, irregular and large timestamps, noise, flat signals, invalid settings, CSV parsing, complete data exports, the real sample, disabling/re-enabling fitting, and corrected-data exports with fitting off. Browser checks cover file selection, displayed results, invalid timing, stale-result export prevention, and PNG/SVG rendering. The PNG preview was verified at 4800 × 2880 pixels. Direct local-file navigation and download-event capture were unavailable in the test browser; UI testing used an isolated loopback preview. A browser/file-system compatibility matrix has not been tested.

See **Fit-model-notes.md** for a comparison of capacitor-style, double-exponential, and stretched-exponential models on the included sample. The app continues to use the single-exponential model when fitting is enabled.

## Editable source

The `source` folder contains the analysis engine, interface, styles, tests, and a small bundler. These tools are needed only if you want to modify the app, not to use it.

From this folder, with Node.js installed, run:

```sh
node --test source/core.test.js
```

To rebuild the HTML after editing the source, with Python 3 installed:

```sh
python3 source/build.py --sample sample/HEBR_ss.csv --output SSPC-Studio.html
```

The app itself has no third-party JavaScript dependencies and uses no external assets or services.
