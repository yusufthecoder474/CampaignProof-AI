# Windows PowerShell setup

Install Node.js 24 LTS, Python 3.12 and Git from their official installers. Open a new PowerShell window. Extract the ZIP, then enter its CampaignProof-AI folder.

```powershell
cd "$HOME\Downloads\CampaignProof-AI"
node --version
python --version
npm.cmd ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r ml\requirements.txt
.\.venv\Scripts\python.exe ml\prepare.py
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run build
npm.cmd run dev
```

Open http://127.0.0.1:8787. Keep the terminal running. The bundled data, model and seed SQL already exist; rerunning prepare.py rebuilds them deterministically. If Python 3.12 is your default but the `py` launcher is absent, use `python -m venv .venv`.

Select deterministic mock (optional), size 20, seed 474, threshold .5. Run comparison; wait for complete; inspect saved predictions with hidden outcomes. Then choose **Reveal outcomes & score**. The base-rate predictor and Logistic Regression always participate. No cloud account or paid model is required.

For frontend hot reload, keep the Worker running and use a second PowerShell:

```powershell
npm.cmd run dev:web
```

Open the Vite address printed in that terminal. API calls proxy to the local Worker.

## Verification

Stop the dev Worker with Ctrl+C before the integrated check, which starts its own Worker on port 8787.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
.\.venv\Scripts\python.exe -m pytest tests\test_data.py -q
npm.cmd run build
npm.cmd run test:integration
```

`npm.cmd` avoids PowerShell script execution-policy issues without changing machine policy. No virtualenv activation is necessary.

## Optional live APIs (requires a conscious cost decision)

Copy `.env.example` to `.dev.vars`, keep it out of Git, configure only the provider you plan to run, and choose an available Claude model from its authenticated Models API. Set `ALLOW_PAID_MODELS=true` only when ready to allow paid calls. Configure provider-specific rates if you want cost estimates. Restart Wrangler. Select the live provider and explicitly tick the per-run authorization checkbox; start at 20 or fewer records. Do not treat this as a spending cap: at most three attempts per sample/provider can incur charges, and costs may be unknown. A larger run requires deliberately changing the server's MAX_LIVE_SAMPLE and explicit authorization again.

## Restricted Linux container note

The build environment's OS interface enumeration was unavailable. An optional `scripts/loopback-fallback.cjs` supplies only a loopback entry if that specific OS call fails. Ordinary Windows setup uses `npm run dev` and needs no workaround. In a matching Linux container:

```bash
npm run dev:restricted
NODE_OPTIONS='--require ./scripts/loopback-fallback.cjs' npm run test:integration
```

Wrangler also logged a nonfatal Request.cf metadata fetch timeout before using a placeholder. The actual local API/D1/Workflow assertions still executed. These container conditions are not cloud deployment tests.
