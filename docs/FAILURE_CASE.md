# LLM Failure Case Study

**Classification: controlled injected failure. No failure was observed from a live LLM.**

Reproduce with `npm test -- --reporter=verbose` and locate `records injected malformed output as invalid without retries` and `controlled injection: unsupported numeric claim rejected`.

A stubbed Anthropic transport returns an otherwise valid probability/evidence JSON object with an additional fabricated dataset-level field such as `customer_count: 1000` or `fabricated_rate: 0.99`. This is a deliberate failure fixture, not measured model behavior. The strict Zod response schema rejects unknown fields. The prediction runner emits status `invalid`, preserves available usage metadata, stores no accepted probability, and makes one attempt. It does not retry a schema violation. A separate test changes the evidence attribute's value; that is rejected even when its field shape is correct.

The engineering change is to represent explanations as bounded, enumerated evidence references with exact input values, then render those references. Unrestricted free-text explanations are not accepted. Dataset-level facts and metrics are computed only by application code. This constrains factual output; it does not prove the model used the cited evidence causally.

Other controlled cases cover malformed JSON, NaN/infinite/out-of-range probability, wrong sample ID, missing fields, HTTP 429, 401, a stalled request aborted at 15 seconds, and transient retry exhaustion after three attempts. Transient failures use 100ms and 200ms backoff. Workflow prediction steps do not add another retry layer; persistence steps may retry safely because of their composite primary key. No paid API calls are needed for these tests.

During local integration, an initial early-score test raced a very fast offline Workflow. The test now inserts a dedicated queued fixture and checks the scoring guard there. The completed comparison separately verifies null outcomes before reveal, immutable prediction counts, and independent Brier arithmetic after reveal.
