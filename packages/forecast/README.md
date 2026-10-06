# packages/forecast

Beta-Binomial scene forecast. `score.js` and `calibrate.js` are pure functions. No LLM.

`scoreForecast({ cell, signals, weights })` returns a probability, a percent rounded to the nearest 5, and a confidence derived from the cell's effective sample size. Category cells start at α+β = 10. Those numbers are starting assumptions, not learned values.

`labelFor` keeps the conservative rule: low confidence shows the pattern and never a now-claim.

`scripts/calibrate.mjs` is the only writer of `data/forecast/cells.json` and `weights.json`.
