# IMPLEMENTATION_PLAN.md

**REMEDY — AI Compliance Remediation Memory Agent**
*"Don't just find the failure. Remember what happened after the fix."*

Status: Phase 1 complete (reconnaissance + architecture). Built for hackathon criteria:
Innovation 30% · Hindsight Memory 25% · Technical Implementation 20% · UX 15% · Real-world Impact 10%.

---

## 1. Repository Reconnaissance (Phase 1 findings)

### 1.1 Starting point

| Question | Finding |
|---|---|
| Repository | Empty. Project folder created at `C:\Users\SAI TEJA\OneDrive\Desktop\remedy`. |
| Existing framework | None. The sibling folder `ca-cma-academic-career-navigator` is an unrelated FastAPI project and is **not** reused. |
| Existing code | None. Nothing to preserve or migrate. |
| Node | v24.14.1, npm 11.11.0 |
| Python | 3.13.5 |
| Docker | **Not installed** — Docker-based Hindsight is unavailable. |
| Desktop path | OneDrive-redirected → `C:\Users\SAI TEJA\OneDrive\Desktop` |
| LLM keys in env | None found. |
| Hindsight server running | No (ports 8888/9999 checked). |

### 1.2 Hindsight identification (no fabricated APIs)

The environment contains **no** local Hindsight SDK, docs or MCP server. The package registry and
upstream documentation were interrogated directly rather than guessed:

- **Package**: `@vectorize-io/hindsight-client` **v0.10.1** (npm) / `hindsight-client` (PyPI)
  — official TypeScript client from Vectorize.io. Selected over the Python client so the
  whole application stays in one language.
- **Server**: `hindsight-api` **v0.10.1** (PyPI) — bare-metal server, Windows supported.
- **Docs**: `https://hindsight.vectorize.io` (v0.10 matches client version).

#### Verified API surface (read from the running server's own `openapi.json`, not guessed)

Base: `http://localhost:8888` · tenant segment `default` · bank `remedy`

| Operation | Method + path |
|---|---|
| **Retain** | `POST /v1/default/banks/{bank_id}/memories` |
| **Recall** | `POST /v1/default/banks/{bank_id}/memories/recall` |
| **Reflect** | `POST /v1/default/banks/{bank_id}/reflect` |
| List memories | `GET  /v1/default/banks/{bank_id}/memories/list` |
| Bank config | `GET  /v1/default/banks/{bank_id}/config` |
| Version | `GET  /version` → `{"api_version":"0.10.1", ...}` |

#### Verified recall result shape (from official API reference)

Every result carries: `id`, `text`, `type` (`world` | `experience` | `observation`),
`context`, `metadata`, `tags`, `entities`, `occurred_start`, `occurred_end`,
`mentioned_at`, `document_id`, `chunk_id`, and:

```
scores: {
  final      number|null   // ranking score, results ordered by this desc
  reranker   number|null   // cross-encoder relevance, normalized 0..1
  semantic   number|null   // vector cosine similarity 0..1
  keyword    number|null   // BM25 score, >= 0, unbounded
}
```

**Important constraint (documented upstream):** these scores are *relative to a single query*,
not calibrated cross-query probabilities. REMEDY therefore surfaces them as
**"relevance (0–1, relative)"** and never as a fabricated "91% similarity" figure.

### 1.3 Environment blockers discovered and resolved

| Blocker | Evidence | Resolution |
|---|---|---|
| Hindsight Cloud unusable | Valid `hsk_…` key authenticates, but `retain` **and** `recall` both return `402 Insufficient credits`. Bank `remedy` exists and is empty (`total: 0`). | Abandoned Cloud. Self-hosted. |
| Docker absent | `docker` not on PATH. | Bare-metal `pip install hindsight-api`. |
| `llamacpp` provider unusable on Windows | `llama-cpp-python` has **0 Windows wheels across all 208 releases** → requires MSVC source build. | Switched to **Ollama** (`winget install Ollama.Ollama`, v0.34.4 available) as the fully-local LLM. |
| No LLM API key anywhere | Env scan + `opencode.db` credential/account tables empty. | Ollama — no key required, satisfies "fully local, zero credentials". |

**Final runtime decisions (user-approved):**
*Hindsight = local bare-metal server · LLM = fully local (Ollama), no API keys.*

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Next.js 15 (App Router)                       │
│                     TypeScript · Tailwind · Zod                      │
│                                                                      │
│  ┌────────────── UI (Phase 2+) ──────────────┐                       │
│  │ Finding intake · Recommendation · Explain  │                       │
│  │ Memory panel · Approval · Outcome capture  │                       │
│  └───────────────────┬───────────────────────┘                       │
│                      │ HTTP (route handlers)                        │
│  ┌───────────────────▼───────────────────────┐                       │
│  │            Agent Pipeline (modules)        │                      │
│  │  evidence → rootCause → recall → conflict  │                      │
│  │        → recommend → verify → outcome      │                      │
│  └──────┬──────────────────────────┬─────────┘                       │
│         │                          │                                 │
│  ┌──────▼─────────┐        ┌───────▼──────────────┐                  │
│  │  LLM service   │        │   Hindsight service  │  ← SINGLE        │
│  │  (Ollama,      │        │  src/lib/memory/*    │   choke point    │
│  │  OpenAI-       │        │  retain/recall/      │                  │
│  │  compatible)   │        │  reflect wrappers    │                  │
│  └──────┬─────────┘        └───────┬──────────────┘                  │
│         │                          │                                 │
│  ┌──────▼─────────┐        ┌───────▼──────────────┐                  │
│  │  SQLite         │        │  Hindsight server    │                 │
│  │  app state:     │        │  localhost:8888      │                 │
│  │  findings, runs,│        │  bank: remedy        │                 │
│  │  approvals      │        │  embedded pg0 +      │                 │
│  │  (NOT memory)   │        │  vector/graph store  │                 │
│  └────────────────┘        └──────────────────────┘                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Separation of concerns (hard rule)

- **Hindsight = the memory layer.** Historical cases, root causes, remediations, outcomes,
  recurrences and lessons live *only* in Hindsight. Never mirrored into SQLite as "memory".
- **SQLite = application state only.** Current findings in flight, agent run audit trail,
  approval decisions. Explicitly *not* a memory store.
- **No fake memory.** No arrays, JSON files, hardcoded history, or hand-rolled vector search
  standing in for Hindsight.

### Why Next.js and not Python

The TypeScript client `@vectorize-io/hindsight-client@0.10.1` is official and matches the
server version exactly. One language, one toolchain, one test runner — no cross-service
serialization. Hindsight integration is a thin, well-typed wrapper, so "better in Python"
does not apply here.

---

## 3. Application Structure

```
remedy/
├── IMPLEMENTATION_PLAN.md          ← this file
├── PART1_STATUS.md                 ← Phase 13 status report
├── README.md
├── package.json / tsconfig.json / next.config.ts
├── vitest.config.ts
├── .env.example   .env (gitignored)   .gitignore
├── scripts/
│   ├── hindsight-start.ps1         # boots local Hindsight with Ollama provider
│   └── seed-memory.ts              # retains the 18 historical cases into Hindsight
├── src/
│   ├── app/
│   │   ├── layout.tsx  page.tsx
│   │   └── api/
│   │       ├── findings/                    GET list · POST create
│   │       ├── findings/[id]/               GET detail
│   │       ├── findings/[id]/analyze/       POST → full pipeline
│   │       ├── findings/[id]/approval/      POST approve|reject|request_evidence
│   │       ├── findings/[id]/outcome/       POST → verify + retain outcome
│   │       ├── hindsight/status/            GET → health, version, memory counts
│   │       └── seed/                        POST → run seeder
│   ├── lib/
│   │   ├── config.ts               # env parsing (Zod), fail-fast
│   │   ├── db/                     # better-sqlite3 schema + queries
│   │   ├── models/
│   │   │   ├── enums.ts            # FindingStatus, RemediationStatus, …
│   │   │   ├── types.ts            # Finding, RootCause, Remediation, …
│   │   │   └── schemas.ts          # Zod schemas + inferred types
│   │   ├── memory/                 # ★ ALL Hindsight access lives here
│   │   │   ├── hindsight.ts        # client factory, health, timeout, errors
│   │   │   ├── memory-types.ts     # MemoryReference, RecallBundle, …
│   │   │   ├── retain.ts           # retainFinding/retainOutcome/retainLesson
│   │   │   ├── recall.ts           # recallSimilarFindings/recallFailedFixes/…
│   │   │   └── index.ts            # public façade
│   │   ├── llm/
│   │   │   ├── client.ts           # OpenAI-compatible client, env-driven
│   │   │   └── json.ts             # robust JSON extraction + Zod validation
│   │   ├── agent/
│   │   │   ├── evidence.ts         # Evidence Agent
│   │   │   ├── root-cause.ts       # Root Cause Agent
│   │   │   ├── historical.ts       # Memory Retrieval / Reasoning Agent
│   │   │   ├── conflict.ts         # historical vs current conflict detection
│   │   │   ├── recommend.ts        # Remediation Agent (memory-aware)
│   │   │   ├── verify.ts           # Verification Agent
│   │   │   └── pipeline.ts         # orchestrator + AgentRun audit
│   │   └── seed/
│   │       ├── historical-cases.ts # 18 synthetic enterprise cases
│   │       └── seed.ts
│   └── components/                 # UI (Phase 2 — deliberately minimal for Part 1)
└── tests/
    ├── unit/                       # models, conflict, recommendation logic
    ├── integration/                # pipeline w/ fake Hindsight + fake LLM
    └── hindsight/                  # real Hindsight retain/recall round-trip
```

---

## 4. Hindsight Integration

### 4.1 Single choke point

`src/lib/memory/hindsight.ts` is the **only** module that imports
`@vectorize-io/hindsight-client`. Everything else calls the application-level functions in
`retain.ts` / `recall.ts`. No Hindsight call is scattered across the codebase.

### 4.2 Public memory API

```ts
// retain.ts
retainFinding(case: HistoricalCase):        Promise<MemoryWriteResult>
retainRootCause(caseId, rootCause):         Promise<MemoryWriteResult>
retainRemediationOutcome(caseId, rem, out): Promise<MemoryWriteResult>
retainLesson(caseId, lesson):               Promise<MemoryWriteResult>
retainRecurrence(caseId, days):             Promise<MemoryWriteResult>

// recall.ts
recallSimilarFindings(finding, opts):   Promise<RecallBundle>
recallHistoricalRemediations(finding):  Promise<RecallBundle>
recallFailedFixes(finding):             Promise<RecallBundle>
recallSuccessfulFixes(finding):         Promise<RecallBundle>
recallLessons(finding):                 Promise<RecallBundle>
```

`RecallBundle` is deliberately explicit about failure:

```ts
interface RecallBundle {
  historicalMemoryAvailable: boolean;  // false ⇒ UI shows "Historical memory unavailable."
  status: 'ok' | 'unavailable' | 'empty' | 'low_confidence' | 'error';
  reason?: string;                     // human-readable cause
  memories: MemoryReference[];
  cases: HistoricalCaseSummary[];      // grouped by caseId
}
```

### 4.3 Memory encoding strategy

Each historical case is retained as **several focused memories** rather than one blob, so each
lifecycle stage is independently retrievable and typed:

| Memory | `context` | `metadata` |
|---|---|---|
| Finding | `compliance finding` | `caseId`, `stage=finding`, `control`, `severity` |
| Root cause | `root cause analysis` | `caseId`, `stage=root_cause` |
| Remediation attempt | `remediation attempt` | `caseId`, `stage=remediation`, `action` |
| Verification | `verification result` | `caseId`, `stage=verification` |
| Outcome | `remediation outcome` | `caseId`, `stage=outcome`, `result`, `recurrenceDays` |
| Recurrence | `finding recurrence` | `caseId`, `stage=recurrence` |
| Lesson | `lesson learned` | `caseId`, `stage=lesson` |

`metadata.caseId` is the join key back to structured history. Content also embeds
`Case #102` verbatim so the case remains identifiable from `text` alone if metadata is
absent from a given recall path — **no inference, no fabrication**.

**Bank mission** (steers Hindsight's extraction toward this domain):

> *This bank stores longitudinal compliance-remediation experience for a security/compliance
> engineering team. Always preserve: the control, the root cause, the exact remediation
> attempted, whether it worked, time-to-recurrence, and the lesson learned. Prioritise
> recurrence and failed remediations over generic compliance advice.*

### 4.4 Failure handling (never silently fabricate)

| Condition | Behaviour |
|---|---|
| Server unreachable / timeout | caught → `historicalMemoryAvailable=false`, `status:'unavailable'` |
| HTTP 402/401/5xx | caught → `status:'error'` with sanitized reason |
| Malformed response | Zod-parse the raw payload; failure → `status:'error'` |
| Zero results | `status:'empty'` — distinct from unavailable |
| Only weak scores | `status:'low_confidence'` — recommendation proceeds but is flagged |
| LLM down | recommendation degrades to memory-only analysis, explicitly labelled |

**Rule:** when memory is unavailable, REMEDY says *"Historical memory unavailable — this
recommendation is stateless."* It never invents history to fill the gap.

Timeouts are enforced client-side (default 15s retain / 10s recall) so a hung Hindsight
cannot hang the request.

---

## 5. Data Model

Defined once in `models/` with **Zod as the source of truth**; TS types are inferred from
schemas so runtime validation and compile-time types cannot drift.

### 5.1 Enums

```ts
FindingStatus =
  OPEN | INVESTIGATING | ROOT_CAUSE_IDENTIFIED | REMEDIATION_PROPOSED
  | AWAITING_APPROVAL | REMEDIATING | VERIFYING | RESOLVED | RECURRED

RemediationStatus =
  PROPOSED | APPROVED | IMPLEMENTED | VERIFIED | FAILED
  | PARTIAL | SUCCESSFUL | RECURRED

OutcomeResult = SUCCESS | PARTIAL | FAILURE
ApprovalDecision = APPROVED | REJECTED | REQUEST_MORE_EVIDENCE
MemoryAvailability = AVAILABLE | UNAVAILABLE | EMPTY | LOW_CONFIDENCE
```

### 5.2 Entities

```ts
Finding {
  id, controlId, title, description, severity: CRITICAL|HIGH|MEDIUM|LOW,
  category: EMPLOYEE_ACCESS|PRIVILEGED_ACCESS|IAM|HR_SYNC|MFA|TERMINATED_USERS
          | CONTRACTOR_ACCOUNTS|SERVICE_ACCOUNTS|CLOUD_PERMISSIONS|VENDOR_ACCESS
          | AUDIT_CONTROLS|EVIDENCE_COLLECTION|POLICY_VIOLATION,
  affectedSystem, status: FindingStatus,
  evidence: Evidence[], createdAt, updatedAt, firstDetectedAt, recurrenceOf?: findingId
}

Evidence { id, findingId, source, observation, collectedAt, supportsHypothesis?: string }

RootCause {
  id, findingId, rootCause: string, contributingFactors: string[],
  confidence: number /*0..1*/, identifiedAt, method: 'LLM_ANALYSIS'|'HUMAN'
}

Remediation {
  id, findingId, proposedAction, implementationDetails: string,
  owner, status: RemediationStatus, rationale,
  approval?: Approval, proposedAt, approvedAt?, implementedAt?
}

Verification {
  id, remediationId, method: 'AUTOMATED_RESCAN'|'MANUAL_REVIEW'|'CONTROL_TEST'|'EVIDENCE_RECOLLECTION',
  result: 'PASS'|'FAIL'|'PARTIAL', evidenceText: string, verifiedAt, verifier
}

Outcome {
  id, remediationId, result: OutcomeResult,
  recurrence: boolean, daysToRecurrence?: number,
  observedSideEffects: string[], lessonLearned: string,
  additionalInvestigation?: string, recordedAt
}

Approval {
  id, remediationId, decision: ApprovalDecision, decidedBy: string,
  reason?: string, requestedEvidence?: string, decidedAt
}

HistoricalCase {           // assembled view; persisted in Hindsight, not SQLite
  caseId, finding: Finding, rootCause: RootCause, remediation: Remediation,
  verification?: Verification, outcome: Outcome, lesson: string,
  control, category, affectedSystem, closedAt
}

MemoryReference {
  factId, caseId, stage, text, type: 'world'|'experience'|'observation',
  score: { final?, reranker?, semantic?, keyword? },   // as returned by Hindsight
  scoresAreRelative: true,                            // explicit, never shown as "%"
  metadata: Record<string,string>
}

Recommendation {
  id, findingId, recommendation: string, confidence: number,
  memoryInfluenced: boolean, memoryStatus: MemoryAvailability,
  historicalCasesUsed: Array<{ caseId, relevance, outcome, lesson, whyRelevant }>,
  rejectedPriorActions: Array<{ action, caseId, reason }>,
  risks: string[], assumptions: string[],
  whyMemoryChangedIt: string,      // the before/after delta
  conflicts: MemoryConflict[],
  baselineRecommendation?: string  // the stateless answer, for demo contrast
}

MemoryConflict {
  id, kind: 'ROOT_CAUSE_DISAGREEMENT'|'EVIDENCE_DISAGREEMENT'|'OUTCOME_DISAGREEMENT',
  historicalClaim, currentEvidence, severity, requiresHumanReview: true
}

AgentRun {
  id, findingId, stage, startedAt, finishedAt, ok, error?,
  llmModel?, memoryStatus, durationMs, notes
}
```

### 5.3 SQLite schema (application state only)

Tables: `findings`, `evidence`, `root_causes`, `remediations`, `verifications`,
`outcomes`, `approvals`, `agent_runs`. WAL mode, foreign keys on, created lazily on first use.

---

## 6. Agent Workflow

```
CURRENT FINDING
      │
      ▼
┌─────────────┐  extract entities, control, severity, evidence claims
│  Evidence    │  → Evidence[]
│  Agent       │
└──────┬──────┘
       ▼
┌─────────────┐  hypothesise root cause + contributing factors + confidence
│ Root Cause   │  → RootCause
│ Agent        │
└──────┬──────┘
       ▼
┌─────────────┐  recallSimilarFindings / recallHistoricalRemediations
│ Hindsight    │  recallFailedFixes / recallSuccessfulFixes / recallLessons
│ Recall       │  → RecallBundle (or unavailable)
└──────┬──────┘
       ▼
┌─────────────┐  group memories by caseId, score, rank, drop low-confidence
│ Historical   │  → HistoricalCaseSummary[]
│ Analysis     │  detect conflicts vs current evidence
└──────┬──────┘
       ▼
┌─────────────┐  memory-aware synthesis → Recommendation
│ Remediation  │  includes baselineRecommendation for contrast
│ Agent        │  + whyMemoryChangedIt + rejectedPriorActions
└──────┬──────┘
       ▼
┌─────────────┐  Analyze → Recommend → Explain → HUMAN DECISION
│  Human       │  approve | reject(reason) | request more evidence
│  Approval    │  ✗ never auto-executes
└──────┬──────┘
       ▼
┌─────────────┐  simulated remediation (never touches real infra)
│ Remediation  │
└──────┬──────┘
       ▼
┌─────────────┐  re-scan / control test → Verification + Outcome
│ Verification │
└──────┬──────┘
       ▼
┌─────────────┐  retainOutcome + retainLesson + retainRecurrence
│ Hindsight    │  → memory now shapes the NEXT recommendation
│ Retain       │
└──────┬──────┘
       ▼
   FUTURE DECISION
```

Modules are plain functions inside one backend — **not** separate services.

---

## 7. Memory Lifecycle

1. **Seed** — `scripts/seed-memory.ts` retains the 18 synthetic historical cases
   (each split into finding / root-cause / remediation / verification / outcome /
   recurrence / lesson memories). Idempotent: keyed on `metadata.caseId`, skipped if already
   present.
2. **Recall** — every `analyze` performs five targeted recalls and merges them into one
   `RecallBundle`, deduplicated by `factId`, ranked by `scores.final`.
3. **Reason** — memories are grouped per case and passed to the recommendation step together
   with the *current* finding and evidence.
4. **Retain** — after an outcome is recorded, the outcome + lesson (+ recurrence if any) are
   written back. The loop closes: *new outcome → updated Hindsight memory → better next
   recommendation.*
5. **Observations** — Hindsight consolidates facts into observations in the background;
   REMEDY includes `observation`-type results in recall so consolidated org lessons surface
   alongside raw facts.

---

## 8. API Design

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/findings` | list findings + latest analysis summary per finding |
| `POST` | `/api/findings` | create finding (Zod-validated) |
| `GET` | `/api/findings/:id` | full detail incl. root cause, stored analysis, remediation, approval, outcome, runs |
| `POST` | `/api/findings/:id/analyze` | run pipeline → `Recommendation` + `AgentRun[]` (analysis persisted) |
| `POST` | `/api/findings/:id/approval` | `{decision, decidedBy, reason?}` |
| `POST` | `/api/findings/:id/outcome` | record verification + outcome → retain to Hindsight |
| `GET` | `/api/hindsight/status` | health, version, memory count, availability |
| `GET` | `/api/memories` | Memory Inspector — list/filter/search bank facts, optional relevance scoring against a finding |
| `POST` | `/api/memories` | retain a lesson (dedupe-aware; used by Demo Mode step 11) |
| `GET` | `/api/dashboard` | aggregate findings, analyses, remediations and outcomes for the rollup cards |
| `POST` | `/api/seed` | seed historical cases |
| `POST` | `/api/reset` | wipe application state (analyses, runs, remediations, findings) |

**Part 2 additions.** `/api/dashboard` and `/api/memories` back the dashboard rollup and the
Memory Inspector. Both read the same rows the workflow writes — `computeDashboardStats` is a
pure function over them so no dashboard figure can be fabricated — and `/api/memories` is also
the write path Demo Mode uses to prove the retain loop is real. The eight Part 1 routes are
unchanged.

Conventions: JSON only · Zod-validated bodies · `400` validation, `404` missing,
`503` when Hindsight is required but unavailable, `200` with
`memoryStatus` when memory merely degraded. Errors return
`{error: {code, message, detail?}}`.

---

## 9. Testing Strategy

Runner: **Vitest**. Three tiers; Hindsight tests are tagged `hindsight` and self-skip with a
clear message when the server is down (so `npm test` always passes).

| Tier | Covers |
|---|---|
| **Unit** | finding creation, Zod validation, root-cause generation, conflict detection, recommendation derivation from a fixed memory set, approval transitions, outcome persistence, memory-update math, malformed-LLM-output parsing |
| **Integration** | full pipeline against a **fake** Hindsight port + **fake** LLM → deterministic, fast, no network |
| **Hindsight** | real `retain` → `recall` round-trip, similar-finding retrieval, failed-fix detection, successful-fix retrieval, outcome persistence, write-back loop, server-down → `historicalMemoryAvailable:false` |

### ★ The most important test

```
SAME current finding
  ├── run with memory unavailable      → recommendation === A  (stateless default)
  └── run with recalled FAILED + SUCCESS history → recommendation === B
  assert A !== B  AND  B cites the historical case AND B rejects the previously-failed fix
```

This directly encodes *SAME CURRENT PROBLEM + DIFFERENT MEMORY = DIFFERENT RECOMMENDATION*
and is the executable proof of the hackathon's core requirement.

Additional memory-specific tests: recommendation confidence drops when memory is `empty`;
`rejectedPriorActions` contains the historically failed fix; a `ROOT_CAUSE_DISAGREEMENT`
conflict forces `requiresHumanReview`.

---

## 10. Demo Strategy

Single persona: **security/compliance engineer**. Single workflow:
**recurring finding → historical memory → remediation recommendation.**

**Beat 1 — Cold (before memory).** Run a *stateless* analysis on the new finding
"8 inactive employees again have privileged access." REMEDY returns the obvious answer:
*"Automate HR → IAM deprovisioning."* Shown as `baselineRecommendation`.

**Beat 2 — Warm (after memory).** With Hindsight seeded and available, run the *same* finding.
REMEDY retrieves Case #102 (recurred after 43 days; contractor identities excluded) and
Case #087 (succeeded once coverage was expanded), and returns:

> **Recommendation influenced by 3 historical cases.**
> Case #102 — FAILED · recurred after 43 days · *"contractor identities were excluded."*
> Case #087 — SUCCESS · *"synchronization coverage was expanded."*
> **Do not repeat the previous remediation blind. First validate synchronization coverage
> for contractor identities.** The prior fix addressed the symptom, not the recurrence.

**Beat 3 — Conflict.** A case where current evidence says the sync pipeline is healthy while
memory says sync was the root cause → `HISTORICAL MEMORY CONFLICT` panel, human review forced.

**Beat 4 — Closure.** Approve → simulated remediation → verification → outcome →
retain → *the next* recommendation demonstrably improves.

Side-by-side before/after is the required "visible memory effect".

---

## 11. Error Handling

- **Config**: Zod-validated at boot; missing critical vars fail fast with a named error.
- **Hindsight**: wrapped with timeout + typed errors; every failure surfaces as
  `memoryStatus` rather than a crash. Never invents history.
- **LLM**: retries with backoff (2 attempts) · strict JSON extraction (fenced block → raw →
  substring scan) · Zod validation of the parsed object · on failure the pipeline degrades to
  memory-only reasoning and labels it, instead of failing the request.
- **Malformed LLM output**: covered by dedicated tests.
- **Idempotency**: analyze is re-runnable; each run appends to `agent_runs`.
- **Logging**: structured, no secrets, no raw LLM prompts containing credentials.

---

## 12. Security Considerations

- Secrets **only** in `.env`, which is gitignored; `.env.example` ships placeholders.
  No credential is ever committed.
- No arbitrary shell execution of LLM output — LLM returns structured JSON, parsed and
  validated only. **Nothing the model emits is ever executed.**
- Remediation is **simulated**; REMEDY never modifies real infrastructure.
- Human approval is mandatory for every remediation — no auto-execution path exists.
- Synthetic demo data only; no real employee/contractor identities.
- Single-tenant local service; Hindsight bank isolated; no cross-bank access.
- SQLite opened read-write only from the server process; no SQL built from model output
  (parameterized queries throughout).
- Timeouts bound every external call so a hung dependency cannot hang a request.

---

## 13. Non-Goals (explicitly out of scope)

- Multiple personas or workflows.
- Real infrastructure remediation / integrations with IAM, HR or cloud providers.
- Generic compliance chatbot, document RAG, or audit summarization.
- Production auth/multi-tenancy — this is a hackathon prototype.
- Heavy UI polish during Part 1 (memory/reasoning loop first).

---

## 14. Definition of Done — Part 1

1. Application builds · 2. Hindsight connection works · 3. Synthetic cases retained ·
4. Cases recallable · 5. Findings analyzed · 6. Root causes generated ·
7. **Memory changes the recommendation** · 8. Outcomes stored ·
9. New outcomes written back to Hindsight · 10. Tests pass.

Tracked in `PART1_STATUS.md`.
