# oh-my-algorithm (OMA)

OMA 是一套**机器人算法开发工作流编排层**，请严格执行相关流程。

**核心技能（3 个）**：`requirement` | `loop` | `deploy` — 由 `oma setup` 注入 **agent 平台 skills 目录**（Codex → `.codex/skills/`，Cursor → `.cursor/skills/`），**不在 `.oma/` 下**。环内阶段由 `$loop` 路由到 `loop` + `loop-*` phase skills。可选 reference 在包内 `skills/reference/`，仅 `oma reference install` 时注入。

**核心风险**：sim-to-real gap 是每个阶段的首要风险。Reward hacking 是静默失败——高奖励若缺乏物理可信度即为死路。切勿仅凭仿真结果断言策略有效。

---

## STARTUP PROTOCOL (run before any action)

1. `.oma/standalone.json` exists? → **Standalone Mode** (gates advisory only).
2. Read **current track** `.oma/tracks/{track_id}/memory.md` (`index.default_track`) → internalize Dead Ends. Do not re-explore them.
3. Check gate condition for the requested skill. Blocked gate = stop and report (Normal Mode only).
4. **Cross-session recovery**:
   - Read `.oma/index.json` → project dashboard: `meta` (config), `active_tracks` / `closed_tracks`, `default_track`. Per-track runtime: `.oma/tracks/{track_id}/loop.json`.
   - For the **current track** (`index.default_track`): read `.oma/tracks/{track_id}/loop.json` → `lap` / `stage` / `exp_id` / `hypothesis`. This is the primary "where was I" pointer for the design↔implement↔train↔tune loop.
   - Legacy: root `.oma/loop.json` or `.oma/config.json` → run `oma doctor --migrate`.
   - `.oma/design-draft.md` exists → `$design` interrupted; resume from Phase 2, skip idea generation.
   - `.oma/tune-current.json` exists → `$tune` in progress; read `phase` field, resume accordingly.
   - Scan all `tracks/*/experiments/*/results.json` with `"status":"running"` → run `gm task info` on each orphaned task.
5. **Experience library**: read `index.experiences_dir`; then `oma xp index --format md` (or `--dir` if overriding). `oma xp show <id>` for full entries only.

---

## Gate Chain (two hard gates + a free iteration loop)

There are **only two hard gates**. Everything between them is a cyclic, data-driven
loop where `$design`, `$implement`, `$train`, `$tune` are **mutually advisory** — move
in any direction (including backward: a `$tune` analysis that motivates a `$design`
change) without tripping a gate.

```
$requirement  →  requirements.md + knowledge.md  (LOCKED)
        │
        ▼   ══ HARD GATE (enter loop): requirements.md LOCKED ══
┌──────────────── ITERATION LOOP  (one lap ≈ one exp_id) ────────────────┐
│                                                                        │
│   $design ──→ $implement ──→ $train ──→ $tune                          │
│      ▲   (delta)   │  (code)    │ (gm)    │ (sweep/analyse)            │
│      │             │            │         │                            │
│      └─────────────┴────────────┴─────────┘  data-driven change        │
│                                                                        │
│   per lap:  hypothesis + change + result + conclusion  (experiment.json)│
│   turnaround:  $train → experiment-analysis → [human confirm]          │
│                       → experiment-recording → next lap                │
│   loop state: .oma/tracks/{track_id}/loop.json  { lap, stage, exp_id } │
│   tracks: design-paradigm routes (parallel) — see index.json           │
│                                                                        │
└────────────────────────────────┬───────────────────────────────────────┘
                                 ▼  ══ HARD GATE (exit loop): best.json deployGateOpen === true ══
                      $deploy →  sim2real gap analysis → test campaign → hardware
                              →  design-feedback.md  ──(re-enters the loop)
```

**Gate semantics**

| Transition | Gate | Type |
|------------|------|------|
| → enter loop (`$design`/`$implement`/`$train`/`$tune`) | `requirement/requirements.md` + `knowledge.md` LOCKED | **HARD** |
| within loop (any ↔ any of the four) | none — advisory only | soft |
| loop → `$deploy` | `best.json` `deployGateOpen === true` | **HARD** |

Inside the loop, the agent must NOT block on "previous artifact missing". A `$tune`
that exposes a problem may go straight back to `$design` (delta) or `$implement`
without a fresh full design doc. **First lap** typically produces a full
`design-{id}.md`; **later laps** usually produce only a *delta* — the
`hypothesis` + `change` of the lap's `experiment.json` (archive_level `light`).
Promote to a full design doc only for major changes (reward redesign, architecture
swap) — i.e. archive_level `full`.

---

## Stage I/O Contract  (read before acting in any stage)

Each stage's inputs/outputs, kept here in the always-loaded rule so you do not need to
open the skill to know what a stage reads and must write. The full procedure is in the
named skill below; read it when you enter the stage.

| Stage | Reads (input) | Writes / records (output) | Skill / template |
|-------|---------------|---------------------------|------------------|
| `$requirement` | paper, user interview | `requirement/requirements.md`, `requirement/knowledge.md` (LOCKED) | `.codex/skills/requirement/SKILL.md` + templates |
| `$loop` → design | `requirement/knowledge.md` (or loop seed) | `tracks/{id}/design/design-{id}.md` (first lap) **or** delta | `loop/phases/design.md` |
| `$loop` → implement | current design / lap delta | code + `impl/impl-checklist.md` + `impl/github.json` | `loop/phases/implement.md` |
| `$loop` → train | pushed code / config | `tracks/{track_id}/experiments/{exp_id}/results.json` (`status: running` → `completed`), upsert `experiments-index.json` | `loop/phases/train.md` + `.oma/templates/experiment-config.json`, `results.json` |
| `$loop` → tune | ≥1 train result | `tracks/{track_id}/experiments-index.json`, `best.json` (`deployGateOpen`) | `loop/phases/tune.md` + `.oma/templates/experiment-config.json` |
| `$deploy` | `best.json` gate open | `deploy/` artifacts, `sim2real_checklist.md` | `.codex/skills/deploy/SKILL.md` + `.oma/templates/deploy-config.json`, `sim2real_checklist_template.md` |
| `$loop` → consolidate | recent experiments | `tracks/{id}/memory.md` | `loop/phases/consolidate.md` + `templates/memory.md` |
| reference: experiment-recording | a finished run | per-lap `experiment.json` (+ 三件套 for `full`) | `.codex/skills/reference-experiment-recording/SKILL.md` (if installed) |

Every stage also updates `.oma/tracks/{track_id}/loop.json` `stage` on entry (and `lap`/`exp_id` when a new lap starts). Use `index.default_track` unless the user/session specifies another active track.

## Tracks (design-paradigm parallel routes)

- **Track** = paradigm-level route (e.g. redirect-data, gait-clock, minimal-reward), not a reward-tuning lap.
- **Lap** = iteration within one track (`tracks/{id}/loop.json`); experiments live in `tracks/{track_id}/experiments/{exp_id}/`.
- **Open a new track** (user request or new paradigm): run `oma track open <track-id> --label "..."` — do **not** hand-edit `index.json`.
- **Switch context**: `oma track switch <track-id>` or set session to that track before inner-loop skills.
- **Close**: `oma track close <track-id> --deliverable "..."` when a paradigm is abandoned or delivered.

## Recording Discipline  (lap checkpoints — soft, agent-proposed)

The loop's memory is only as good as what gets recorded. As a standing rule:

1. **At each lap close** — when `$train` or `$tune` produces a result — the agent must
   **proactively propose recording** (do not wait to be asked): "本圈 (exp `{exp_id}`) 跑完了，
   是否记录？archive_level 建议 `light`/`full`。" Proceed to `experiment-recording` on the
   user's OK. If `index.reference_skills.experiment-recording` is installed, follow that
   skill after generic `experiment.json` write. This is advisory: the agent proposes, the human confirms.
2. **What a checkpoint captures**: the lap's `hypothesis`, `change`, `result`, `conclusion`
   (the `experiment.json` fields); `full` laps add lineage + notes.
3. **After recording**, update `.oma/tracks/{track_id}/loop.json` (`lap`/`stage`/`exp_id`).
4. Never let a lap close silently — an unrecorded lap is a lost lesson.

## Templates

Process templates live in `.oma/templates/` (installed by `oma setup`). Before producing a
stage's artifact, **read the matching template** from the Stage I/O table above and follow its
shape. Templates are the canonical structure; do not invent ad-hoc formats.

---

## Keyword → Skill Routing

| Keyword(s) | Skill | Action |
|------------|-------|--------|
| requirement, define problem, clarify, success criteria | `$requirement` | Read `.codex/skills/requirement/SKILL.md`, execute |
| design, architecture, reward design, policy design, network | `$loop` (design) | Read `.codex/skills/loop/SKILL.md`, then `loop/phases/design.md` |
| implement, code it, build pipeline, write trainer | `$loop` (implement) | Read `loop/SKILL.md`, then `loop/phases/implement.md` |
| index codebase, scan repo, reference implementation | `oma index` | Run `oma index --src <path> [--track <id>]`; `oma index --list` |
| train, run training, launch experiment, start training | `$loop` (train) | Read `loop/SKILL.md`, then `loop/phases/train.md` |
| tune, sweep, ablation, hyperparameter, final eval | `$loop` (tune) | Read `loop/SKILL.md`, then `loop/phases/tune.md` |
| consolidate, update memory, record findings | `$loop` (consolidate) | Read `loop/SKILL.md`, then `loop/phases/consolidate.md` |
| analyse exp, compare exp, exp CSV, joints, leg symmetry, yaw drift, /compare | reference | If `reference_skills.experiment-analysis` installed → read `.codex/skills/reference-experiment-analysis/SKILL.md`; else generic analysis in `$loop` lap turnaround |
| record exp, archive experiment, write to lab, /update-lab | reference | If `reference_skills.experiment-recording` installed → read that skill; else generic `experiment.json` in `$loop` turnaround |
| deploy, sim2real, hardware test, real robot | `$deploy` | Read `.codex/skills/deploy/SKILL.md`, execute |
| next lap, next exp, iterate, 下一轮, 下一圈, 再改, loop | `$loop` | Open a new lap: bump `tracks/{track_id}/loop.json` `lap`, set `stage` to the entered phase, allocate the next `exp_id`. Route to the matching phase doc. |
| new track, 新路线, 并行, open track, 开 track | Track | Run `oma track open <track-id> --label "..."`, then `$loop` (design) for that paradigm. |
| track list, 活跃 track, switch track | Track | Run `oma track list` or `oma track switch <track-id>`. |
| reference install, lab skill | `oma reference` | `oma reference list` / `install <name>` / `add --name … --src …` |
| go \<stage\>, skip to, jump to, just do, standalone | Standalone | Write `.oma/standalone.json`, enter named stage |
| gm, gradmotion, training platform | `$loop` (train) | Read `loop/phases/train.md`; adapter: `.codex/skills/adapters/gradmotion/SKILL.md` |

Keywords are case-insensitive. Multiple matches → use most specific. Rest of message = task description passed to skill.

Inside the iteration loop, treat design/implement/train/tune requests as
`$loop` phase moves: keep `tracks/{track_id}/loop.json` `stage` current, do **not** block on a missing
upstream artifact (only `requirements.md` LOCKED is required to be in the loop).

---

## Standalone Mode

**Trigger**: `.oma/standalone.json` exists OR user runs `oma go <stage>`.
Gates become advisory. Show `⚠️ STANDALONE` notice listing missing artifacts, then continue.

```bash
oma go requirement | design | implement | train | tune | deploy
oma go loop [--stage design|implement|train|tune] [--track <id>] [--reason "..."]   # enter loop WITHOUT $requirement
oma track open|close|list|switch <track-id>   # paradigm-level parallel routes
oma go off   # return to gated mode (keeps track loop.json)
```

### Entering the loop without `$requirement` (`oma go loop`)

For an existing codebase or a quick iteration where no formal requirement phase
is wanted. It waives the enter-loop hard gate (`requirements.md` LOCKED), ensures a track
(`oma track open` or default track), inits `.oma/tracks/{track_id}/loop.json`, and drops you
straight into the cyclic `$design ↔ $implement ↔ $train ↔ $tune`. The deploy gate
still applies to exit.

**Minimal seed (the entered skill must capture this on entry — it is NOT blocking):**
even without a requirement doc, the loop needs the bare minimum to rank and to
define the exit gate. On the first loop skill invocation, confirm with the user:
- **primary metric** + direction (higher/lower better) → write to `.oma/index.json` `meta.metric`;
- **robot / sim target**: robot model, sim_env, control_hz → write to `meta.robot`.

Ask only for what's missing; if a registered codebase exists (`.oma/codebase/config.json`
`tracks[{track_id}].srcPath` via `oma index`), infer what you can from it first and only ask to confirm. Do not
run the full `$requirement` interview.

---

## State Files

| Path | Owner |
|------|-------|
| `.oma/index.json` | dashboard — `meta` config, `active_tracks`, `closed_tracks`, `experiences_dir`, `reference_skills` |
| `.oma/tracks/{track_id}/loop.json` | per-track iteration loop — upserted by inner-loop skills |
| `.oma/requirement/requirements.md` | `$requirement` |
| `.oma/requirement/knowledge.md` | `$requirement` |
| `.oma/tracks/{track_id}/design/design-{id}.md` | `$design` |
| `.oma/impl/impl-checklist.md` | `$implement` |
| `.oma/impl/github.json` | `$implement` |
| `.oma/tracks/{track_id}/` | one paradigm unit — `loop.json`, `memory.md`, `experiments-index.json`, `design/`, `experiments/` |
| `.oma/tracks/{track_id}/experiments/{exp_id}/` | `$train`, `$tune` |
| `.oma/tracks/{track_id}/experiments-index.json` | `$train`, `$tune` |
| `.oma/best.json` | `$tune` Phase 5 only |
| `.oma/tracks/{track_id}/memory.md` | `$loop` (consolidate) only |
| `.codex/skills/reference-` | `oma reference install` — optional lab helpers |
| `.oma/standalone.json` | `oma go` |
| `deploy/` | `$deploy` |

### `.oma/index.json` — project dashboard

Top-level router only — no lap/exp detail. `meta` holds project config (formerly `config.json`).

```json
{
  "last_updated": "2026-07-01",
  "meta": {
    "project_name": "...",
    "metric": { "name": "tracking_error", "higher_is_better": false },
    "robot": { "model": "X1-12DOF", "sim_env": "isaac", "control_hz": 50 },
    "gradmotion": { "projectId": null, "goodsId": null, "imageId": null, "imageVersion": null },
    "seeds_per_config": 3
  },
  "active_tracks": [
    {
      "track_id": "gait-clock",
      "track_ref": "tracks/gait-clock",
      "label": "步态时钟驱动",
      "started": "2026-06-02",
      "target_ref": "requirement/requirements.md",
      "status_summary": "exp_028 closed",
      "next_milestone": "扩盆 redesign"
    }
  ],
  "closed_tracks": [],
  "default_track": "gait-clock",
  "experiences_dir": null,
  "reference_skills": {}
}
```

Maintain via `oma track open|close|list|switch` — agents must not hand-edit track registration.

**Experience library**: configure with `oma xp init --dir <path>` (writes `experiences_dir`). All `oma xp` commands use that path; pass `--dir` to override once. Do not use `~/.oma/` unless the user explicitly sets it.

### `.oma/tracks/{track_id}/loop.json` schema

The lightweight "where am I in the loop" pointer. Any inner-loop skill upserts it on
entry (same spirit as `design-draft.md` / `tune-current.json`). Read it at startup.

```json
{
  "track_id": "gait-clock",
  "lap": 3,
  "stage": "tune",
  "exp_id": "exp-20260630-002",
  "design_ref": "design/design-gait-clock-v1.md",
  "hypothesis": "raise ankle-torque DR upper bound to cut yaw drift",
  "opened_at": "2026-06-30T09:00:00Z",
  "updated_at": "2026-06-30T11:20:00Z"
}
```

Rules: a **new lap** (`lap`+1) starts when a fresh change is taken into `$design`/`$implement`
after a `$train`/`$tune` round closed (i.e. a new `exp_id`). Moving between stages of the
**same** lap only updates `stage`/`updated_at`. `$deploy` exiting the loop does not delete
track loop state; the next loop entry bumps the lap on that track.

### `.oma/tracks/{track_id}/experiments-index.json` — lap rollup

Lightweight per-track experiment directory (no folder scan). Updated on lap close / `experiment-recording`.

```json
{
  "track_id": "gait-clock",
  "last_updated": "2026-07-01",
  "experiments": [
    {
      "exp_id": "exp-20260701-003",
      "lap": 3,
      "continued_from": "exp-20260701-002",
      "change": "ankle DR upper 0.3→0.5",
      "conclusion": "yaw drift ↓",
      "design_ref": "design/design-gait-clock-v1.md",
      "status": "closed"
    }
  ]
}
```
