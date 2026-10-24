# Optional Cloudflare deployment — instructions only

No public deployment was performed. Obtain the owner's authorization before running these commands. The application has no authentication or production rate limiting; keep live models disabled on a public demonstration and use only the bundled public dataset. A paid, public endpoint requires access controls and spending protections beyond this MVP's scope.

1. Authenticate Wrangler: `npx wrangler login`.
2. Create a D1 database: `npx wrangler d1 create campaignproof`.
3. Replace the all-zero local placeholder database_id in wrangler.jsonc with the returned real ID.
4. Apply the migration: `npx wrangler d1 migrations apply campaignproof --remote`.
5. Load the public demonstration pool: `npx wrangler d1 execute campaignproof --remote --file artifacts/seed.sql`.
6. If authorized to configure live models, use Wrangler secrets (never frontend environment variables):

```powershell
npx.cmd wrangler secret put ANTHROPIC_API_KEY
npx.cmd wrangler secret put CLAUDE_MODEL
npx.cmd wrangler secret put CF_ACCOUNT_ID
npx.cmd wrangler secret put CF_AI_TOKEN
```

7. Keep ALLOW_PAID_MODELS=false unless you have explicitly authorized paid model usage. Confirm the open model ID and current provider documentation. Configure each provider's token rates separately when known; do not copy one model's price to another.
8. Build and inspect first: `npm run build` is Vite build plus **Wrangler dry-run only**.
9. After authorization: `npx wrangler deploy`. The workflow binding points to the exported PredictionWorkflow class in the same Worker.
10. Verify health, start a tiny offline run, inspect hidden outcomes, reveal and score, repeat the same Idempotency-Key, and inspect D1/Workflow logs. Local success does not prove remote success.

Cloudflare products and quotas can change; check your account's limits before deployment. Workflows are durable orchestration, while D1 holds the prediction and reveal records. This app does not send marketing messages or automatically target customers.
