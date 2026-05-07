You are working in plan mode.

Task:
Design the Structured Negotiation and Option Evaluator modules for Revix.

Revix should not simply pick a winning reviewer.
It should synthesize resolution options and evaluate them against the Quality Constitution.

For each conflict, generate options:
- Option A: reviewer A preference
- Option B: reviewer B preference
- Option C: compromise
- Option D: minimal safe change, when useful

Each option should include:
- option_id
- description
- required_changes
- satisfied_quality_rules
- weakened_quality_rules
- risk
- implementation_cost: 0-5
- expected_benefit
- reviewers_likely_to_accept
- reviewers_likely_to_reject

Evaluation dimensions:
- security_safety: 0-5
- contract_safety: 0-5
- reliability: 0-5
- correctness: 0-5
- performance: 0-5
- maintainability: 0-5
- testability: 0-5
- observability: 0-5
- implementation_cost: 0-5

Rules:
- Hard constraint violations disqualify an option.
- Performance must not reduce correctness.
- Security and Contract concerns require explicit mitigation.
- Small PRs should prefer minimal safe changes.
- Low-confidence findings should reduce certainty, not automatically block.

Please propose:
- Input schema
- Output schema
- Option generation strategy
- Scoring model
- Disqualification rules
- Tie-breaking rules
- Final selection logic
- Test strategy

Do not implement yet.