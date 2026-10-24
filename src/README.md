# Worker backend

| File | Responsibility |
|---|---|
| index.ts | HTTP routing and durable PredictionWorkflow |
| domain.ts | Strict schemas, contract, seeded sampling and SHA-256 |
| adapters.ts | Constant, Logistic Regression, mock and two optional live providers |
| storage.ts | Prediction runner, idempotent persistence and score/reveal service |
| evaluation.ts | Brier, threshold accuracy, reliability bins and quantiles |

See [API examples](../docs/API.md), [data integrity](../migrations/0001_initial.sql), and [deployment instructions](../docs/CLOUDFLARE.md). Default operation is local; paid APIs are explicitly gated. Models never receive outcome labels.
