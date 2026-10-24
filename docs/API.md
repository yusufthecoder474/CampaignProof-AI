# API and model contract

All endpoints use JSON and `Cache-Control: no-store`. GET /api/health reports local data readiness, pool count and whether live usage is enabled. The public API never accepts uploaded customer records or returns hidden labels.

```powershell
$headers = @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$body = @{ providers=@('mock'); size=20; seed=474; threshold=0.5; confirm_paid=$false } | ConvertTo-Json
$run = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/runs' -Headers $headers -ContentType 'application/json' -Body $body
Invoke-RestMethod "http://127.0.0.1:8787/api/runs/$($run.id)"
Invoke-RestMethod "http://127.0.0.1:8787/api/runs/$($run.id)/results"
# Wait for status=complete before revealing historical outcomes:
Invoke-RestMethod -Method Post "http://127.0.0.1:8787/api/runs/$($run.id)/score"
```

POST /api/runs automatically adds constant and baseline. An Idempotency-Key of 8–80 alphanumeric/hyphen/underscore characters is required. Reusing the key with equivalent normalized parameters returns the original run; different parameters return 409. Workflow ID and run ID are deterministic hashes of the key. A failed run remains failed; use a new key for a deliberate new experiment. An unavailable scheduler returns 503 and may be retried with the same key. Repeated requests do not duplicate prediction records.

GET /api/runs/:id returns status and sample IDs. GET results returns immutable prediction records, input snapshot/hash, evidence, timestamp, model metadata, status, measured latency and nullable usage/cost. Outcome is null before reveal. POST score rejects unfinished runs with 409 and requires a complete matrix; it then records genuine historical outcomes and returns code-calculated metrics. Repeating score is idempotent.

```typescript
interface DecisionModel {
  provider: Provider;
  model: string;
  version: string;
  kind: 'mock' | 'statistical' | 'real-api';
  predict(input: Input): Promise<ModelOutput>;
}
```

Adapters return raw structured output plus observable usage and cost. The runner validates against the same schema for every adapter, then adds response status, measured latency, attempt count, prompt/config versions and provider identity. Evidence uses exact feature/value references and allowed reason codes. Probabilities are estimates, while counts/rates and observed outcomes are independently calculated facts.

Live adapters use real documented HTTP endpoints when configured. Unit tests intercept their transport; passing those tests does not imply live model execution. API keys stay on the Worker. Malformed output produces invalid status and is never silently substituted with a mock result. Timeout/network/429/5xx retries stop at three attempts; 4xx and schema violations are terminal. No attempt is made to integrate undocumented APIs.
