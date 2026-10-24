# Research foundation and engineering response

Reviewed on 23 October 2026. This project applies established evaluation ideas; it introduces no new forecasting algorithm.

## References reviewed

1. Xu et al. (2026), [LLM-based Agents for Forecasting and Prediction: Methods, Training, Evaluation, and Applications](https://arxiv.org/abs/2608.23058), v1. The survey emphasizes measurement limitations, look-ahead and pretraining leakage, calibration under shift, and reporting inference costs with performance. Its discussion of negative results supports including simple baselines rather than assuming an LLM helps.
2. Turtel et al. (2026), [How Proper Scoring Rules Shape LLM Forecasting](https://arxiv.org/abs/2608.28482), downloaded v2 dated 9 September 2026. Different proper scoring rules used for training lead to different calibration and forecast behavior. This motivates displaying Brier and reliability separately. CampaignProof does not implement the paper's training experiments or establish that optimizing one metric guarantees better calibration.

Full PDFs were retrieved and text reviewed; they are not redistributed here.

## Application to this implementation

| Measurement issue | Engineering response | Remaining limitation |
|---|---|---|
| Unchecked confidence | Brier loss and ten-bin reliability table/chart | No calibration guarantee; no post-hoc calibrator is fitted |
| Missing simple baselines | Training-only constant and fixed Logistic Regression in every run | A small feature set is deliberately conservative |
| Feature/evaluation leakage | Source row order split, train-only encoder/scaler, allowlist, no targets in adapter input | Public UCI data may be in LLM pretraining; temporal splits cannot eliminate contamination |
| Incomplete cost reporting | Per-record elapsed time including retries, usage if provided, provider-specific cost rates | Retries can incur unknown charges; local CPU time and hosting costs are not a billing estimate |
| Untraceable prediction/outcome | Input snapshots/hash, model and prompt versions, immutable predictions, separate reveal table | D1 administrator can still modify infrastructure; this is not tamper-proof storage |

The dramatic change in historical response prevalence is a useful demonstration of temporal shift. It is not evidence that the software improves campaign effectiveness. No randomized experiment or causal analysis is performed.

## Implementation references

- [UCI source, documentation and CC BY 4.0](https://archive.ics.uci.edu/dataset/222/bank+marketing)
- [Cloudflare Workflow step retry configuration](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Cloudflare local Workflows](https://developers.cloudflare.com/workflows/build/local-development/)
- [Workers AI Llama 3.3 model reference](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic model discovery](https://platform.claude.com/docs/en/api/models/list)

Provider model availability may change; configure a model available to your account before requesting a paid run. No unverified Claude model alias is hard-coded.
