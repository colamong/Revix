You are working in plan mode.

Task:
Design the reviewer skill pack system for Revix.

Revix should load reviewer definitions from skill files.

Built-in reviewer skills:
1. architecture
2. contract
3. domain
4. security
5. reliability
6. performance
7. test
8. observability
9. documentation
10. readability

Each skill should define:
- reviewer_id
- display_name
- responsibility
- background
- bias
- flexibility_score
- allowed_scope
- forbidden_scope
- severity_policy
- quality_rules_focus
- prompt_instructions
- examples

Important:
- Skills should be readable markdown or YAML files.
- Users should be able to override or add custom skills.
- Built-in skills should be versioned.
- Skills must not contain project-private assumptions.
- Reviewers should produce evidence-based claims only.

Please propose:
- Skill file format
- Built-in skills directory structure
- User override behavior
- Skill validation rules
- Example Security skill
- Example Contract skill
- Test strategy

Do not implement yet.