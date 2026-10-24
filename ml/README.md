# Baseline training and reproducibility

`prepare.py` downloads the original UCI archive when needed, validates genuine rows, preserves chronological order, fits training-only preprocessing and Logistic Regression, exports TypeScript-compatible weights, and records real test metrics.

```bash
python -m pip install -r ml/requirements.txt
python ml/prepare.py
python -m pytest tests/test_data.py -q
```

Outputs live in artifacts/: baseline.json, evaluation.json, parity.json, seed.sql and pool.json. Reseeding uses INSERT OR IGNORE, preserving existing referenced samples and outcomes; if intentionally changing datasets, use a new local database/project rather than mutating old run inputs. Never insert synthetic outcomes into real benchmark artifacts. Read [evaluation assumptions](../docs/METHODOLOGY.md) before interpreting results.
