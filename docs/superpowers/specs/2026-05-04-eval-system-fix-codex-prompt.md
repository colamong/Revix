# Codex Implementation Prompt — Eval System Fix (Phase 1)

## Context

Revix는 AI 기반 PR 리뷰 오케스트레이터입니다. SWE-PRBench 데이터셋으로 성능 평가를 실행했을 때 detection rate가 0%로 나왔는데, 원인 분석 결과 LLM은 실제로 유효한 findings를 생성했지만 평가 알고리즘이 점수를 0으로 처리한 것으로 확인됐습니다. 이번 작업은 평가 시스템을 수정하는 것입니다. 리뷰어 프롬프트나 스킬 파일은 건드리지 않습니다.

설계 스펙: `docs/superpowers/specs/2026-05-04-eval-system-fix-design.md`

---

## Commit Strategy (중요)

**각 작업 단위마다 즉시 커밋하세요.** 롤백과 리뷰가 쉬워야 합니다.

권장 커밋 단위:

```
feat(eval): add file-level issue detection with relaxed matching threshold
feat(eval): replace token overlap with semantic similarity for claim matching
feat(eval): add partial credit for cross-category matches
feat(converter): fix category heuristics - suggestion/CHANGELOG → docs
feat(converter): add matchability field to expected issues
feat(eval): exclude low-matchability issues from RQS denominator
feat(eval): add per-category breakdown to report output
feat(eval): add --diagnostic flag for 0-finding reviewer analysis
feat(schema): add matchability field to review-quality-eval-case schema
test(eval): add tests for new matching algorithm behaviors
test(converter): add tests for updated category heuristics
```

각 커밋 후 `npm test`로 기존 110개 테스트가 통과하는지 확인하세요.

---

## Tasks

### Task 1: 파일 읽기 (시작 전 반드시)

구현 전에 다음 파일을 전부 읽으세요:

- `src/evaluation/index.js` — 현재 매칭 알고리즘 전체
- `scripts/convert-swe-prbench.mjs` — 현재 카테고리 heuristic
- `schemas/review-quality-eval-case.schema.json` — 현재 스키마
- `test/evaluation.test.js` — 기존 테스트 패턴
- `test/swe-prbench-converter.test.js` — 기존 컨버터 테스트 패턴
- `eval-data/reports/codex-smoke/summary.json` — 현재 평가 결과 (문제 확인용)

---

### Task 2: 매칭 알고리즘 개선 (`src/evaluation/index.js`)

#### 2a. File-level issue 감지

`expected_issue.line_start === 1 && expected_issue.line_end === 1`인 경우를 file-level issue로 판정합니다.

**Line-level issues (기존):** 가중치 file=0.25, line=0.25, claim=0.35, category=0.15 / 임계값 0.45

**File-level issues (신규):** 가중치 file=0.35, claim=0.45, category=0.20 (line match 제외) / 임계값 0.30

#### 2b. Claim 매칭: 토큰 오버랩 → 임베딩 유사도

`@xenova/transformers`의 `all-MiniLM-L6-v2` 모델을 사용해 claim 간 코사인 유사도를 계산합니다.

```javascript
// 구현 방향 (정확한 API는 @xenova/transformers 문서 참조)
import { pipeline } from '@xenova/transformers';

const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

async function claimSimilarity(a, b) {
  const [ea, eb] = await Promise.all([embed(a), embed(b)]);
  return cosineSimilarity(ea, eb);
}
```

- 임베딩은 문자열별로 캐싱 (Map 사용, 프로세스 수명 동안 유지)
- 임계값: **0.60**
- 폴백: 임베딩 모델 로드 실패 시 기존 토큰 오버랩 사용 + `console.warn` 출력

#### 2c. Category match: partial credit

카테고리가 다르더라도 같은 위치(file + line)의 이슈라면 0점 대신 0.5점 부여.

```javascript
// 변경 전
const categoryScore = findingCategory === expectedCategory ? 1.0 : 0.0;

// 변경 후
const locationMatch = fileScore > 0.5 && lineScore > 0.5;
const categoryScore = findingCategory === expectedCategory
  ? 1.0
  : (locationMatch ? 0.5 : 0.0);
```

---

### Task 3: SWE-PRBench 컨버터 수정 (`scripts/convert-swe-prbench.mjs`)

#### 3a. 카테고리 heuristic 수정

다음 우선순위로 카테고리를 결정합니다 (위에서 아래로 첫 번째 매칭):

```javascript
function inferCategory(commentText) {
  // 1. suggestion 블록
  if (/```suggestion/.test(commentText)) return 'docs';
  // 2. CHANGELOG / UNRELEASED
  if (/changelog|unreleased/i.test(commentText)) return 'docs';
  // 3. revert / remove
  if (/\b(remove this|revert|undo)\b/i.test(commentText)) return 'correctness';
  // 4. API contract
  if (/\b(api|interface|breaking.change|signature)\b/i.test(commentText)) return 'contract';
  // 5. test
  if (/\b(test|coverage|assert|assertion)\b/i.test(commentText)) return 'test';
  // 6. default
  return 'correctness';
}
```

#### 3b. `matchability` 필드 추가

각 expected issue에 `matchability: "high" | "low"` 필드를 추가합니다.

`low` 조건 (하나라도 해당하면):

- `` ```suggestion `` 블록이 포함된 docs 카테고리 이슈
- `CHANGELOG`, `codecov.yml`, `.metadata.json` 등 프로젝트 고유 경로 패턴 언급
- claim 토큰 수 < 15

그 외는 `high`.

---

### Task 4: 스키마 업데이트 (`schemas/review-quality-eval-case.schema.json`)

`expected_issues` 배열의 각 항목에 `matchability` 필드를 추가합니다:

```json
"matchability": {
  "type": "string",
  "enum": ["high", "low"],
  "description": "Whether a general AI reviewer can be expected to catch this issue without project-specific knowledge."
}
```

기존 required 필드는 변경하지 마세요. `matchability`는 optional입니다 (컨버터가 없는 케이스도 있을 수 있음).

---

### Task 5: RQS 계산에서 low-matchability 제외 (`src/evaluation/index.js`)

detection, precision, recall, F1 계산 시 `matchability: "low"` 이슈를 분모에서 제외합니다.

리포트에는 "Skipped issues (low matchability): N개" 섹션으로 별도 표시합니다.

---

### Task 6: Per-category 리포트 (`src/evaluation/index.js`)

평가 결과 JSON에 `category_breakdown` 필드를 추가합니다:

```json
"category_breakdown": {
  "correctness": { "expected": 0, "matched": 0, "recall": 0.0, "avg_rqs": 0.0 },
  "security":    { "expected": 0, "matched": 0, "recall": 0.0, "avg_rqs": 0.0 },
  "contract":    { "expected": 0, "matched": 0, "recall": 0.0, "avg_rqs": 0.0 },
  "test":        { "expected": 0, "matched": 0, "recall": 0.0, "avg_rqs": 0.0 },
  "docs":        { "expected": 0, "matched": 0, "recall": 0.0, "avg_rqs": 0.0 },
  "performance": { "expected": 0, "matched": 0, "recall": 0.0, "avg_rqs": 0.0 }
}
```

Markdown 리포트에는 기존 summary 테이블 아래에 category breakdown 테이블을 추가합니다.

---

### Task 7: `--diagnostic` 플래그 (`npm run eval:rqs` 스크립트)

`--diagnostic` 옵션 추가. 활성화 시 각 케이스에 대해 출력:

```
[diagnostic] case: swe-prbench:prowler__9865
  reviewer: test        → 1 finding(s)
  reviewer: security    → 0 finding(s) [in-scope: no, expected categories: contract,docs]
  reviewer: contract    → 0 finding(s) [in-scope: yes, expected categories: contract]
  ...
```

"in-scope"는 해당 케이스의 expected issue 카테고리 중 하나라도 리뷰어의 `allowed_scope`에 포함되면 yes.

---

### Task 8: 테스트 추가

다음 테스트를 추가하세요. 기존 테스트는 변경하지 마세요.

**`test/evaluation.test.js`에 추가:**

```javascript
// file-level 이슈는 낮은 임계값(0.30) 적용
it('matches file-level issue (line_start=1) with relaxed threshold', ...)

// 카테고리 달라도 위치 같으면 partial credit
it('awards partial category credit when file+line match but category differs', ...)

// claim 의미 유사도 매칭
it('matches semantically equivalent claims with cosine similarity', ...)

// low-matchability 이슈는 RQS 분모 제외
it('excludes low-matchability issues from RQS denominator', ...)

// per-category breakdown 존재 확인
it('includes category_breakdown in JSON report output', ...)
```

**`test/swe-prbench-converter.test.js`에 추가:**

```javascript
it('maps suggestion block comments to docs category', ...)
it('maps CHANGELOG comments to docs category', ...)
it('assigns matchability low to short suggestion claims', ...)
it('assigns matchability high to substantive correctness claims', ...)
```

---

## Constraints

- 리뷰어 스킬 파일 (`src/reviewer-selection/`, `*.reviewer.yml`, `src/prompt-builder/`) **건드리지 마세요**
- `src/providers/` **건드리지 마세요**
- 기존 110개 테스트가 모두 통과해야 합니다
- `@xenova/transformers` 외 새 런타임 의존성 추가 금지
- 임베딩 모델 다운로드 실패는 graceful fallback (경고 + 기존 방식 사용), 에러로 처리하지 마세요

---

## Verification

각 Task 완료 후:

```bash
npm test
```

모든 Task 완료 후 최종 확인:

```bash
# 기존 110개 + 신규 테스트 모두 통과해야 함
npm test

# prowler__9865 케이스 재평가 (test-001, documentation-001이 non-zero score 받아야 함)
npm run eval:rqs -- --cases eval-data/swe-prbench/converted/eval-cases.json --reviewers revix --out eval-data/reports/phase1-verify
```

---

## Questions for Design Reviewer (Claude)

구현 중 다음 상황에서는 Claude에게 확인하세요:

1. `@xenova/transformers` API가 예상과 다르게 동작할 때
2. 기존 테스트가 새 로직으로 인해 의도치 않게 깨질 때
3. `matchability` 판정 로직의 경계 케이스가 모호할 때
4. Task 범위를 벗어나는 변경이 필요해 보일 때
