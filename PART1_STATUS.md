# PART1_STATUS.md

**REMEDY — AI Compliance Remediation Memory Agent**
Part 1 delivered against `IMPLEMENTATION_PLAN.md` · local run, verified 2026-09-28

One persona (security/compliance engineer). One workflow: **recurring finding → historical
memory → remediation recommendation.** Hindsight is the persistent memory layer the
recommendation is derived from — not a retrieval add-on beside it.

---

## 1. Definition of Done (plan §14)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Application builds | ✅ | `npm run build` exit 0 — `/` plus 8 API route modules (9 handlers) |
| 2 | Hindsight connection works | ✅ | `GET /api/hindsight/status` · live v0.10.1 at `http://localhost:8888` |
| 3 | Synthetic cases retained | ✅ | `npm run seed` → `18/18 cases complete` · bank `default/remedy` holds 333 facts |
| 4 | Cases recallable | ✅ | `npm run verify:memory` — retain → recall round trip, metadata survived intact |
| 5 | Findings analyzed | ✅ | `POST /api/findings/[id]/analyze` |
| 6 | Root causes generated | ✅ | same route; LLM JSON parsed then Zod-validated, memory-only fallback on failure |
| 7 | **Memory changes the recommendation** | ✅ | live: *"changes the recommendation relative to the stateless answer"* · unit twin in `memory-changes-recommendation.test.ts` |
| 8 | Outcomes stored | ✅ | SQLite `outcomes` / `verifications` / `approvals` via `POST .../outcome` |
| 9 | New outcomes written back to Hindsight | ✅ | outcome route retains lifecycle stages; proven by the `verify:memory` round trip |
| 10 | Tests pass | ✅ | `npm test` **75/75** · `npm run test:hindsight` **10/10** · server down: **4 passed / 6 skipped, exit 0** |

---

## 2. The core invariant, executed

`SAME current finding` → `A` (memory unavailable) vs `B` (recalled failure + success history).

Measured live with `npm run diagnose`:

```
stateless   Remove access for inactive employees and automate deprovisioning on termination.
            confidence 0.78 · rejected [] · "No relevant historical experience was recalled"

with memory Do not repeat the previous remediation without validation: history shows it did
            not hold (Case #102 — The finding recurred after 43 days.). First validate HR to IAM
            synchronization failure. Then consider the approach that previously succeeded
            (Case #091: Re-enable automated deprovisioning and add alerting...).
            confidence 0.63 · rejected [Case #102 / FAILURE / recurred after 43 days]

changed: true
```

The answer is not annotated — it is **re-derived**: a prior fix is *vetoed*, a validation step is
*prepended*, an alternative is *substituted*, and confidence drops. `A ≠ B` is asserted both
live (`tests/hindsight`) and offline (`tests/unit/memory-changes-recommendation.test.ts`, cases
A, B, C, plus the no-memory and empty-memory paths).

---

## 3. What is implemented

**Memory layer (`src/lib/memory/`)**
- Single choke point to Hindsight: `retain` / `recall` / status, timeout-wrapped, typed errors.
- Failure is never silent: every transport failure becomes `historicalMemoryAvailable: false`
  with a reason, and the pipeline is forced back to a stateless answer that says so.
- `isMetadataEcho` drops the extractor's `key: value` restatements of metadata before ranking.

**Reasoning agent (`src/lib/agent/`)**
- `pipeline.ts` — `evidence → root_cause → hindsight_recall → recommendation`, each stage timed
  and persisted to `agent_runs`.
- `historical.ts` — recalls, groups facts by `caseId`, extracts one representative fact per
  lifecycle stage, truncates to a bounded case set.
- `recommend.ts` — stateless baseline *always* computed and returned alongside the memory-aware
  answer; `applyMemory` may reject an action, prepend a validation step, swap in a successful
  alternative, and cite cases/lessons/risks/assumptions plus `whyMemoryChangedIt`.
- `conflict.ts` — detects when recalled history contradicts current evidence
  (`ROOT_CAUSE_DISAGREEMENT` etc.) and forces human review rather than trusting memory.
- `verify.ts` / `root-cause.ts` / `evidence.ts` — simulated verification, root-cause
  hypotheses, evidence normalisation.

**API (`src/app/api/`)** — matches plan §8 exactly:
`GET/POST /api/findings` · `GET /api/findings/[id]` · `POST .../analyze` ·
`POST .../approval` · `POST .../outcome` · `GET /api/hindsight/status` ·
`POST /api/seed` · `POST /api/reset`.

**UI (`src/app/`)** — one-page workflow: finding → analysis → side-by-side
before/after recommendation → conflict banner → approval gate → simulated remediation →
outcome capture. Memory availability is always visible; relative recall scores are never shown
as percentages.

**Data** — SQLite for *application state only*: `findings`, `evidence`, `root_causes`,
`remediations`, `approvals`, `verifications`, `outcomes`, `agent_runs`. Parameterised queries
throughout. All case history lives in Hindsight.

**Seed (`src/lib/seed/`)** — 18 synthetic cases across 7 lifecycle stages with deliberate
variation: SUCCESS / FAILURE / PARTIAL, six recurrences (22–43 days), similar findings with
different root causes and different fix outcomes. The demo cluster is **102 / 087 / 091 / 052**:
same control family, one fix recurred after 43 days, one succeeded after coverage was expanded.

---

## 4. Hindsight integration

| | |
|---|---|
| Hosting | Local bare metal — `pip install hindsight-api` in `C:\Users\SAI TEJA\.remedy\hindsight-venv`, v0.10.1, `localhost:8888`, started by `scripts/hindsight-start.ps1` |
| Tenant / bank | `default` / `remedy` |
| LLM | Fully local — Ollama `gemma3:4b` at `http://localhost:11434/v1`, 100% CPU, zero API keys |
| Encoding | One retain per lifecycle stage (`finding`, `root_cause`, `remediation`, `verification`, `outcome`, `lesson`, `recurrence`), each with `{caseId, stage, controlId, category, severity, outcome, recurrence}` metadata, rendered as `Case #<id> <stage>: …` prose |
| Recall | Five intents run concurrently — similar findings · prior remediations · failed fixes · successful fixes · lessons — then merged and deduplicated by fact id |
| Scores | `scoresAreRelative: true` everywhere. Used only to order cases and separate signal from tail; never rendered as a percentage |

### Three defects found against the real server

These only appear once Hindsight is actually running; each is now pinned by a unit test.

1. **Metadata echoes outranked content.** Hindsight's fact extractor emits short
   `recurrence: true` / `Outcome: FAILURE` facts alongside the prose, inheriting the stage they
   were filed under. Being one line long they out-scored the sentences they summarise, so
   "first fact per stage" reported a case's *remediation attempted* as `recurrence: true`.
   Fixed by `isMetadataEcho` (which never matches `Case #…` — that prefix is what separates
   content from echo) and by ranking canonical facts over fragments in `pickCanonicalStages`.

2. **The relevance cut dropped the only prior failure.** Hindsight scores are relative and
   neighbouring cases sit a few hundredths apart, so a pure top-6 cut could assemble an
   all-success history. The rejection gate then found nothing to reject and the answer silently
   reverted to the stateless one — *indistinguishable from honest "no memory"*, which is
   exactly where an explanation panel cannot help. `selectCases` now reserves one quotable
   failure and one success before filling the rest by rank.

3. **A timed-out recall failed silently.** `mergeBundles` correctly reports "available" when
   sibling arms answer, so a slow arm's loss showed up as a missing case rather than an error.
   Recall timeout raised 30 s → 60 s; the live suite dropped from 131 s to 91 s because arms
   stopped waiting out the deadline.

---

## 5. Tests

| Project | Command | Result |
|---|---|---|
| `unit` (hermetic, no network) | `npm test` | **75 passed / 75** across 8 files, <1 s |
| `hindsight` (live server) | `npm run test:hindsight` | **10 passed / 10**, ~91 s |
| both | `npm run test:all` | runs in sequence |

Hindsight tests are tagged `hindsight` and **self-skip with a clear message** when the server is
down — verified by pointing `HINDSIGHT_URL` at a dead port: `4 passed / 6 skipped, exit 0`,
printing `[hindsight] SKIPPED — Hindsight unreachable … Start it with \`npm run
hindsight:start\``. `npm test` only runs `unit`, so offline work never touches it.

Unit coverage includes: Zod schemas, root-cause generation, conflict detection, the A/B/C
recommendation invariant, memory-adapter mapping, recall honesty (`unavailable` vs `empty` vs
`error`), memory-quality regressions from §4, seeding idempotency, and the full pipeline against
a fake Hindsight port + fake LLM.

---

## 6. Known limitations

- **CPU-only LLM.** `gemma3:4b` on CPU gives ~12.5 tok/s; a retain runs fact extraction through
  it and takes tens of seconds. Client timeouts can abort while the write still lands
  server-side — `npm run seed` is stage-aware and idempotent, so re-running repairs it.
- **Recall is ~6 s per intent, ~33 s for the batch of five.** Bounded by `HINDSIGHT_RECALL_TIMEOUT_MS`
  (60 s); if the memory layer is slow the pipeline degrades to a labelled stateless answer
  rather than hanging the request.
- **Scores are relative**, so case ordering varies slightly between runs. `selectCases` exists
  precisely so ordering cannot change *whether* history is allowed to act.
- **Simulation only.** Remediation is never executed against real infrastructure; human approval
  is mandatory and no auto-execution path exists.
- **The Hindsight server is foreground-only** — `npm run hindsight:start` blocks in its
  terminal and has no service manager on this box, so the server dies with the shell that
  launched it. When that happens the suite does not fail: `test:hindsight` self-skips with a
  pointer back to this command.
- **The project lives in a OneDrive-redirected folder**, so `next build` occasionally fails with
  `EPERM: unlink …\.next\server\…` when the sync client holds a file. It is a file lock, not a
  code error — re-running `npm run build` succeeds.
- No auth, no multi-tenancy — hackathon prototype scope (plan §13).

---

## 7. Run and test

```powershell
# once per machine
npm install

# terminal 1 — leave this running; the server is foreground-only and dies with
# the shell that launched it. If you see "Hindsight already running", it is up.
npm run hindsight:start

# terminal 2
npm run seed                     # 18 synthetic cases -> Hindsight (idempotent)
npm run dev                      # http://localhost:3000

# verification
npm run lint                     # eslint
npm run typecheck                # tsc --noEmit
npm test                         # unit, offline, always passes
npm run test:hindsight           # live Hindsight suite (server must be up)
npm run test:all                 # both
npm run verify:memory            # real retain -> recall round trip
npm run diagnose                 # A vs B side by side, with the pool ranking
npm run diagnose:arms            # per-intent recall trace (which case came from where)
```

`.env` is gitignored and `.env.example` ships placeholders only — no credential is committed.
LLM output is parsed and Zod-validated as structured data; **nothing the model emits is ever
executed.**
