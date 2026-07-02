# Skill: $tune

**Purpose**: Systematic hyperparameter sweep (val set) followed by final authoritative evaluation (test set). A single `$tune` session covers the full loop: explore → converge → evaluate → gate decision → consolidate.

For robot RL, this includes sweeping: reward coefficients, DR ranges, network architecture, learning rate, and action scale. The stop condition check is especially important — reward hacking is common and must be detected before final evaluation.

This skill subsumes the former `$evaluate` skill. Final test-set evaluation is the natural terminus of a tune session and is executed here.

**Read also**: `.codex/skills/adapters/gradmotion/SKILL.md` — sweep experiments are also launched via `gm task create/run`, same as `$train`.

**Analysis / recording**: Use **`loop/SKILL.md` › Lap turnaround** for generic lap close. For lab-specific CSV archive or locomotion-lab workflows, use installed **reference skills** (`index.reference_skills` → `.codex/skills/reference-`); install via `oma reference install`.

**Gate in (loop, advisory)**: at least one `tracks/{track-id}/experiments/{exp-id}/results.json` with `phase: train` is the ideal input, but inside the iteration loop `$tune` is **not blocked** by its absence — only `requirements.md`/`knowledge.md` LOCKED is required. A `$tune` analysis that exposes a problem may go **straight back** to `$design`/`$implement` for the next lap (delta) — that is the normal loop, not a failure.
**Loop bookkeeping**: on entry, upsert `.oma/tracks/{track_id}/loop.json` → `stage: tune` (keep the lap's `exp_id`; track = `index.default_track` unless specified).
**Standalone entry**: Allowed via `oma go tune`. If no prior train results exist, ask user: "Do you have existing experiment results to sweep from? If yes, provide exp-id and metric. If no, we'll run a first baseline first."
**Gate out (loop exit, HARD)**: `.oma/best.json` written with `deployGateOpen` field set. Only `deployGateOpen === true` opens the hard gate to `$deploy`; otherwise stay in the loop. **Automatically triggers `$consolidate`.**
**Experience library**: path from `index.experiences_dir`. Lookup:
```
oma xp index --stage tune --format md
oma xp show <id>
oma xp search "<topic>" --stage tune
```
Check the index at Phase 0 for effective hyperparameter ranges or convergence tricks from past projects. This is optional — use your judgment.

---

## Session Resumption Check (run FIRST, before anything else)

**Before any new action, check for in-progress work from a previous session:**

### Step R1 — Check for active tune session

If `.oma/tune-current.json` exists, read it:

```json
{
  "tuneId": "tune-20250120-01",
  "phase": "sweep",
  "planFile": ".oma/tune-20250120-01-plan.json",
  "activeExpIds": ["exp-20250120-003", "exp-20250120-004"]
}
```

This is the active tune session pointer written at Phase 1 startup and deleted only when `$consolidate` completes.

If it exists → resume that session:
- If `phase: "sweep"` → check each `activeExpIds` task via `gm task info`
- If `phase: "final_eval"` → check the eval task, collect results
- If `phase: "consolidate"` → trigger `$consolidate` directly

### Step R2 — Check for orphaned Gradmotion tasks

Scan all `tracks/*/experiments/*/results.json` with `"status":"running"`. For each:

```bash
gm task info --task-id "{taskId}"
```

- **Running / Queued**: attach to logs (`gm task logs --follow --raw`), resume Phase 3 collect.
- **Completed**: collect results, set `status: completed` in `results.json`, upsert `experiments-index.json`.
- **Failed**: set `status: failed` in `results.json`, upsert index, note in tune analysis.
- **Not found**: set `status: lost` in `results.json`, upsert index.

If no orphaned tasks and no `tune-current.json` → start fresh, proceed to Phase 0.

---

## Two Internal Modes

`$tune` runs in one of two modes per invocation:

- **Sweep mode** (default): run a batch of hyperparameter configs on the val set, upsert `experiments-index.json`, analyse results. May loop multiple times until a stop condition is met.
- **Final eval mode**: triggered explicitly (user says "evaluate" / "final eval") or automatically when a stop condition is reached. Runs the best val-set config on the held-out test set with N seeds. Writes `best.json`.

Both modes happen within the same skill session. Do not exit between them.

---

## Phase 0 — Context Loading

| File | Required | What to extract |
|------|----------|-----------------|
| `.oma/requirement/requirements.md` | ✓ | Primary metric, thresholds, N seeds, compute budget, test split definition |
| `.oma/tracks/{track_id}/design/design-{id}.md` | ✓ | Ablation plan (the initial search space) |
| `.oma/tracks/{track_id}/memory.md` | ✓ | **Dead Ends — mandatory exclusion from sweep. No exceptions.** Working Patterns — bias search toward these. |
| `.oma/tracks/{track_id}/experiments-index.json` | ✓ | Ranked experiment rollup — tried configs, no repeats |
| `.oma/index.json` | ✓ | `meta.gradmotion.*` fields for task creation |
| `.oma/impl/github.json` | ✓ | `repoUrl`, `branch`, `commitHash` — same repo used for all sweep tasks |

**Budget check**: Estimate GPU-hours for the planned sweep. If it exceeds remaining budget, reduce scope and log before proceeding.

---

## Phase 1 — Define Sweep

Choose a sweep strategy:

| Strategy | When to use |
|----------|-------------|
| **Sequential ablation** | Variables likely independent — change one at a time |
| **Grid sweep** | ≤3 variables, interactions suspected — exhaustive combinations |
| **Directed search** | Specific hypothesis from memory.md Open Hypotheses — focused narrow sweep |

Build the plan, excluding any `config_summary` already in `experiments-index.json` or memory.md Dead Ends.

Write `.oma/tune-{YYYYMMDD}-{seq}-plan.json` before launching anything:

```json
{
  "tuneId": "tune-{YYYYMMDD}-{seq}",
  "strategy": "sequential_ablation",
  "baselineExpId": "{best exp-id from experiments-index.json}",
  "hypothesis": "{what you expect and why}",
  "sweepConfigs": [
    { "expId": "exp-{YYYYMMDD}-{seq}", "variable": "{param}", "value": "{value}", "inheritFrom": "{baseline}" }
  ],
  "estimatedGpuHours": 4.5,
  "remainingBudgetGpuHours": 18.0
}
```

**Immediately after writing the plan, write `.oma/tune-current.json`** (session pointer for cross-session recovery):

```json
{
  "tuneId": "tune-{YYYYMMDD}-{seq}",
  "phase": "sweep",
  "planFile": ".oma/tune-{YYYYMMDD}-{seq}-plan.json",
  "activeExpIds": []
}
```

Update `activeExpIds` as each task is launched. This file is deleted only after `$consolidate` completes successfully.
```

---

## Phase 2 — Execute Sweep (via Gradmotion)

For each config, follow the same `$train` pattern: write `results.json` with `status: running` when GM task starts; on completion set `status: completed` and upsert `experiments-index.json` (sorted by `metric_mean`).

1. Generate `exp-{id}` dir, write `config.json` immediately (crash-recoverable)
2. Build `create-tune.json` — same `repoUrl`/`branch` from `impl/github.json`; inject sweep values via `hparamsPath` or `startScript` args
3. `gm task create --file .oma/tracks/{track-id}/experiments/{exp-id}/create-tune.json`
4. `gm task run --task-id "{taskId}"`
5. Delete temp JSON after run starts
6. `gm task logs --task-id "{taskId}" --follow --raw --no-request-log`

**Parallel**: Up to 6 concurrent tasks. Each writes only to its own `exp-{id}/`.

**On failure**: Log to `exp-{id}/results.json` with `"status": "failed"`. Continue others.

**Val set only** at this phase — no test set access.

---

## Phase 3 — Collect and Analyse

1. Read all new `results.json`, compute `metric_mean ± metric_std` per config
2. Flag ambiguous improvements (delta < 1 std of current best)
3. Identify winner(s) and loser(s)

Write `.oma/tune-{tuneId}-analysis.md`:

```markdown
# Tune Analysis: {tuneId}

## Sweep Summary
Strategy: {strategy} | Configs tested: {N} | Successful: {N} | Failed: {N}

## Results Table
| exp-id | param=value | mean ± std | vs baseline | significant? |

## Winner
{exp-id} — {mean} ± {std} (+{delta})

## Patterns Observed
- {What worked}
- {What failed — Dead End candidates}

## Next Step
- Continue sweeping: {next variable}
- OR: final evaluation (stop condition met)
```

Upsert completed sweep experiments into `tracks/{track-id}/experiments-index.json` (sorted by `metric_mean`, append-only entries).

---

## Phase 4 — Stop Condition Check

Move to final evaluation when ANY is true:

1. **Plateau**: last-round improvement < 0.5 std of current best
2. **Budget exhausted**: remaining compute < cost of one more round
3. **Threshold satisfied**: best val metric already exceeds requirements.md target
4. **User-directed**: user says "evaluate", "final eval", "submit", or "done tuning"
5. **Ablation complete**: all design ablation plan variables swept at least once

If none are true → loop back to Phase 1 with updated `experiments-index.json`.

---

## Phase 5 — Final Evaluation (Test Set)

⚠️ **The test set is sacred. Verify no leakage before proceeding.**

Pre-flight:
- [ ] Test split from requirements.md not loaded during any prior `$train` or sweep run
- [ ] Normalisation stats fitted on training data only
- [ ] Best candidate checkpoint exists

**Candidate**: top-ranked experiment in `tracks/{track-id}/experiments-index.json` by `metric_mean`.

Run inference on test set (no retraining):
- Load each seed's best checkpoint
- Compute primary metric + all secondary metrics from requirements.md
- N seeds, report mean ± std

Write `experiments/{track-id}/{best-exp-id}/eval-results.json`:

```json
{
  "expId": "{best-exp-id}",
  "phase": "evaluate",
  "evaluatedAt": "{ISO}",
  "dataLeakageCheck": "passed",
  "perSeed": [{"seed": 42, "primaryMetric": {"name": "{name}", "value": 0.851}}],
  "summary": {"{primary_metric}": {"mean": 0.849, "std": 0.003}}
}
```

**Threshold comparison:**

| Metric | Threshold | Result (mean ± std) | Pass? |
|--------|----------|---------------------|-------|
| {name} | {target} | {mean} ± {std} | ✓/✗ |

All thresholds must pass to open deploy gate. If any fails: document gap, recommend next action.

**Write `.oma/best.json`** (only `$tune` writes this):

```json
{
  "expId": "{best-exp-id}",
  "evaluatedAt": "{ISO}",
  "primaryMetric": {"name": "{name}", "mean": 0.849, "std": 0.003},
  "allThresholdsPassed": true,
  "deployGateOpen": true,
  "checkpointPaths": {"seed_42": "tracks/{track-id}/experiments/{exp-id}/checkpoints/seed42_best.pt"},
  "configRef": "tracks/{track-id}/experiments/{exp-id}/config.json",
  "designRef": "tracks/{track-id}/design/{design-id}.md"
}
```

**Error analysis** (append to `experiments/{track-id}/{best-exp-id}/verdict.md`):

```markdown
## Error Analysis (Test Set)
### Failure Modes
- {Most common error patterns}
- {Systematically wrong input types}

### Robustness
- Seed std/mean ratio: {value}
- Outlier seeds: {none / seed N = value}

### Gap to Stretch Target
- Current: {mean}. Target: {value}. Gap: {delta}.
- Hypothesised blockers: {list}
```

---

## Phase 6 — $consolidate

**Update `tune-current.json` phase before triggering consolidate:**
```json
{ "tuneId": "...", "phase": "consolidate", ... }
```

**Immediately trigger `$consolidate`.** Pass tune analysis + error analysis as context.
Do not skip. This is mandatory regardless of whether results improved.

**After `$consolidate` completes**: delete `.oma/tune-current.json` (this tune session is fully closed).

---

## Completion Signal

```
Tune complete.
  Tune ID:     {tuneId}
  Sweep:       {N} configs — best val {metric}: {val_mean} ± {val_std}  [{exp-id}]
  Test result: {metric}: {test_mean} ± {test_std}
  Thresholds:  {all passed / N failed: {list}}
  Deploy gate: {open / blocked — {reason and recommended action}}
  Memory updated via $consolidate.
```
