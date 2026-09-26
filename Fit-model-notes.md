# Which equation fits these photocurrent transients?

For the included HEBR measurement, start with an exponential relaxation toward an offset:

`I(t) = I∞ + A exp(−(t − t₀)/τ)`

Use separate values of A, I∞, and τ for light on and light off. A is positive for the positive light-on transient and negative for the negative light-off transient. Here t₀ is the selected peak timestamp, since the app fits the relaxation after that peak.

This has the same mathematical form as an ideal RC current transient. In an ideal RC circuit, τ = RC. The current magnitude decreases exponentially during charging as well as discharging; the familiar `1 − exp(−t/RC)` charging expression describes the capacitor's voltage. See [Northwestern's RC response notes](https://hades.mech.northwestern.edu/index.php/RC_and_RL_Exponential_Responses).

An exponential photocurrent curve alone does not establish that capacitance is the cause. Carrier trapping, release, recombination, and the measuring circuit can also affect relaxation. Multiple time scales and stretched exponentials are used in photocurrent studies; for example, [A Phenomenological Model for the Photocurrent Transient Relaxation Observed in ZnO-Based Photodetector Devices](https://pmc.ncbi.nlm.nih.gov/articles/PMC3812587/). This source concerns ZnO devices and does not establish the mechanism of this sample.

## Comparison on your sample

Using the same baseline, scaling, and fit intervals as the app, an exploratory comparison gave:

| Model | Equation, with u = t − t₀ | Light-on R² | Light-off R² |
| --- | --- | ---: | ---: |
| Single exponential | I∞ + A exp(−u/τ) | 0.8006 | 0.2433 |
| Double exponential | I∞ + A₁ exp(−u/τ₁) + A₂ exp(−u/τ₂) | 0.8319 | 0.2454 |
| Stretched exponential | I∞ + A exp(−(u/τ)^β), 0 < β ≤ 1 | 0.8276 | 0.2433 |

The double exponential gives the highest in-sample R² of these trials, with a modest improvement for light on and almost none for light off. It also uses more parameters. Higher in-sample R² alone does not demonstrate that the more complicated model is physically correct or predicts new measurements better.

The single-exponential residuals have their strongest spectral component above 10 Hz near 60 Hz in both intervals (approximately 60.2 and 60.6 Hz; frequency resolution differs with interval length). This suggests periodic interference or modulation worth investigating. It does not identify its source: electrical pickup and light-source modulation are possibilities. Repeated dark and illuminated measurements, and checks of the measurement circuit, would help distinguish them. Fitting additional slow exponentials does not model this ripple.

My recommendation is to retain the single exponential with an offset as the initial model, investigate the periodic component, and then check whether repeatable residual curvature justifies a second exponential. Do not interpret the fitted time constant as a measured capacitance unless the equivalent circuit and effective resistance are independently established.

The app continues to use the single exponential when fitting is enabled. This update adds the ability to disable fitting; it does not silently change the model.

## Scope of the comparison

All models used the original 5,297 light-on and 5,779 light-off fit samples, with no smoothing. The single exponential used the app's solver. Double exponentials were screened on a 50-point logarithmic grid of candidate positive time constants from one-fifth of the median sampling interval to five times the fit duration; pairs were separated by at least two grid steps. Amplitudes and offset were solved by linear least squares. Stretched exponentials used the same time-constant grid and β values from 0.2 to 1, followed by local refinement. The double-exponential results are exploratory grid fits, not certified global optima. These comparisons do not include validation on independent records or a noise model for correlated residuals.

For the single-exponential model, half-time is `τ ln(2)`. For a stretched exponential it would be `τ [ln(2)]^(1/β)`; a sum of two exponentials generally has no single τ or universal `τ ln(2)` half-time. This is another reason not to switch model families without changing how response times are reported.
