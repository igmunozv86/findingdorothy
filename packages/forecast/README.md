# packages/forecast

Bayesian nowcasting engine. **Pure functions. No I/O. No LLM.** Deterministic and unit-tested.

`score.js` exposes:
- `scoreForecast(prior, liveSignals)` → `{ score: 0..10, confidence: 'high'|'medium'|'low', drivers: string[] }`
- `labelFor(score, confidence)` → `{ label, action }` — the conservative display mapping.
