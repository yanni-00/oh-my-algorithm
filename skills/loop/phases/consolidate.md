# Skill: $consolidate

**Purpose**: Extract structured knowledge from recent experiments and update `memory.md`. This skill converts raw experimental results into durable, queryable institutional memory that prevents repeated mistakes across sessions.

**Gate in**: None (but typically triggered after `$tune` or `$evaluate`).
**Gate out**: Updates `.oma/tracks/{track_id}/memory.md`. No other artifact is written.

**Invocation**: Usually automatic (triggered by $tune and $evaluate). Can also be invoked manually at any time.

---

## Core Principle

`memory.md` is NOT a log or summary. It is a **decision support database** with three structured tables. Its job is to answer one question at the start of every session: *"What do we already know that should constrain our next decision?"*

The tables have strict schemas. Free-form text goes in verdict.md files, not memory.md.

---

## memory.md Schema

The canonical memory.md format. Always preserve this exact structure. Append to tables; never delete rows.

```markdown
# Algorithm Memory
_Project: {project name}_
_Last updated: {ISO date}_

## Dead Ends
Directions proven not to work. Do not re-propose these without a compelling new reason.

| Direction | Why Failed | Seeds Tested | Evidence Experiments | Date Added |
|-----------|-----------|-------------|---------------------|-----------|
| lr > 5e-3 with AdamW | Loss diverges on all seeds, no warmup helps | 3/3 | exp-001, exp-003 | 2025-01-15 |
| L2 λ > 0.01 | Val metric drops 2.1pp vs λ=1e-3, consistent | 3/3 | exp-007 | 2025-01-16 |

## Working Patterns
Directions with confirmed positive effect. Use these as defaults when designing future experiments.

| Pattern | Conditions | Median Gain | Evidence Experiments | Date Added |
|---------|-----------|------------|---------------------|-----------|
| Cosine warmup (5% steps) | batch_size ≥ 128 | +0.8pp f1 | exp-009, exp-011 | 2025-01-16 |
| Label smoothing ε=0.1 | Multiclass with class imbalance | +0.5pp f1 | exp-013 | 2025-01-17 |

## Open Hypotheses
Directions not yet tested but suggested by experimental evidence or design reasoning.

| Hypothesis | Source | Priority | Estimated Gain | Status |
|-----------|--------|----------|---------------|--------|
| Focal loss may help class-imbalance tail | exp-013 verdict + class error analysis | high | +1~2pp | untested |
| Larger batch (512) with scaled lr | Working pattern extrapolation | medium | +0.3pp | untested |

## Budget Tracker
| Item | Value |
|------|-------|
| Total experiment budget (GPU-hrs) | 40 |
| Consumed to date | 18 |
| Remaining | 22 |
| Experiments run | 13 |
| Current best metric (val) | f1_macro = 0.847 (exp-011) |
| Current best metric (test) | not yet evaluated |
| Deploy gate status | closed |
```

---

## Execution Protocol

### Phase 1 — Read All Sources

Read in this order:
1. Scan all `tracks/*/experiments/*/results.json` completed or failed since last `memory.md` update (use `completed_at` / `started_at` as cutoff).
2. For each new experiment: read `tracks/{track-id}/experiments/{exp-id}/results.json` and `tracks/{track-id}/experiments/{exp-id}/verdict.md` (if exists).
3. Read any `tune-{id}-analysis.md` files produced since last consolidation.
4. Read current `.oma/tracks/{track_id}/memory.md` (to know what already exists — never duplicate rows).
5. Read `.oma/requirement/requirements.md` for budget figures.

---

### Phase 2 — Classify New Evidence

For each new experiment, classify its findings into one or more of: Dead End, Working Pattern, Open Hypothesis.

**Dead End criteria** (ALL must be true):
- The metric result was worse than or indistinguishable from baseline (within ±1 std).
- The failure was consistent across ALL N seeds (not a single-seed anomaly).
- The failure has a plausible mechanistic explanation (state it — "loss diverges" not just "bad result").

**Working Pattern criteria** (ALL must be true):
- The metric improvement exceeded ±1 std above baseline (statistically meaningful).
- The improvement was consistent across ≥2 seeds.
- A condition is specified (patterns without conditions are useless — "lr=3e-4 works" is not a pattern; "lr=3e-4 works when batch_size ≥ 128" is).

**Open Hypothesis criteria**:
- An experiment's verdict.md suggests a direction not yet tested.
- OR a Dead End suggests a boundary ("failed above X, maybe X/2 works").
- OR two Working Patterns suggest a combination not yet explored.

---

### Phase 3 — Write Incremental Updates to memory.md

**Never rewrite memory.md from scratch. Only append new rows.**

For Dead Ends: append row to the Dead Ends table.
For Working Patterns: append row to the Working Patterns table.
For Open Hypotheses: append row, OR move an existing Open Hypothesis row to Dead Ends/Working Patterns if it was tested.

Update the Budget Tracker with current figures from requirements.md and completed `results.json` entries.

**Quality rules for row entries:**
- `Direction` / `Pattern` / `Hypothesis` column: must be specific enough that a different agent could reproduce the exact condition. "High dropout" is too vague. "dropout > 0.3 with batch_size < 64" is acceptable.
- `Why Failed` / `Conditions`: must name the mechanistic reason, not just the outcome.
- `Evidence Experiments`: must list actual exp-ids, not "recent experiments".

---

### Phase 4 — Promote / Retire Hypotheses

Scan the Open Hypotheses table:
- If a hypothesis was tested in a new experiment: move it to Dead Ends or Working Patterns with the evidence. Remove from Open Hypotheses.
- If a hypothesis has been open for more than 5 experiment cycles and budget allows: escalate its priority to high.
- If a hypothesis is logically contradicted by a new Dead End: add a note and mark it `invalidated`.

---

### Phase 5 — Verify Memory Integrity

After updating, verify:
- [ ] No duplicate rows in any table (same direction listed twice).
- [ ] Every Dead End row has at least one exp-id in Evidence column.
- [ ] Every Working Pattern has a Conditions column that is specific (not empty or "always").
- [ ] Budget Tracker totals are consistent with experiments-index / results.json count.

---

## Completion Signal

The skill is complete when:
1. `.oma/tracks/{track_id}/memory.md` is updated with the `_Last updated_` timestamp refreshed.
2. All new Dead Ends, Working Patterns, and Hypothesis movements are written.
3. Budget Tracker is current.

Report: "Memory updated. New Dead Ends: {N}. New Working Patterns: {N}. Hypotheses promoted/retired: {N}. Remaining budget: {GPU-hrs}."
