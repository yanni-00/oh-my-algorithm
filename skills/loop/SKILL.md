# Skill: $loop

**Purpose**: The iteration loop between the two hard gates ? `$design` ? `$implement` ? `$train` ? `$tune`, plus lap turnaround and optional `$consolidate`. OMA is an orchestration layer; this skill routes to the correct **phase** doc and enforces loop bookkeeping.

**Gate in (HARD)**: `requirement/requirements.md` + `requirement/knowledge.md` LOCKED (unless Standalone / `oma go loop`).

**Gate out (to `$deploy`)**: `best.json` `deployGateOpen === true` ? set in `$tune` Phase 5 only.

**Skill location**: Installed by `oma setup` into the active agent's skills directory ? e.g. `.codex/skills/` (Codex), `.cursor/skills/` (Cursor), `.claude/skills/` (Claude Code). **Not** under `.oma/`.

---

## On entry (every loop invocation)

1. Read `.oma/index.json` ? `default_track`, `active_tracks`, `reference_skills`.
2. Read `.oma/tracks/{track_id}/loop.json` ? `lap`, `stage`, `exp_id`, `hypothesis`, `design_ref`.
3. Read `.oma/tracks/{track_id}/memory.md` ? Dead Ends (do not re-explore).
4. Read `.oma/tracks/{track_id}/experiments-index.json` for lap history.
5. Upsert `loop.json` ? set `stage` to the phase you are entering; bump `lap` / new `exp_id` only when starting a **new lap**.

**New design paradigm** ? `oma track open <track-id> --label "..."` before first `$design` on that track.

---

## Phase routing

| User intent / keyword | Phase doc (under `{platform}/skills/`) | Loop stage |
|----------------------|----------------------------------------|------------|
| design, architecture, reward | `loop/SKILL.md` then `loop-design/SKILL.md` | design |
| implement, code it | `loop/SKILL.md` then `loop-implement/SKILL.md` | implement |
| train, gm, gradmotion | `loop/SKILL.md` then `loop-train/SKILL.md` | train |
| tune, sweep, ablation | `loop/SKILL.md` then `loop-tune/SKILL.md` | tune |
| consolidate, memory | `loop/SKILL.md` then `loop-consolidate/SKILL.md` | ? |

**Platform adapter**: `adapters/gradmotion/SKILL.md` in package ? referenced from train/tune phase docs (not a separate Cursor skill).

---

## Lap turnaround

1. **Analyze** ? `tracks/{track_id}/experiments/{exp_id}/results.json` vs hypothesis.
2. **Optional reference** ? If `index.reference_skills.experiment-analysis` is set, read that platform skill (e.g. `.cursor/skills/reference-experiment-analysis/SKILL.md`).
3. **Propose recording** ? ??? (exp `{exp_id}`) ??????????
4. **Record** → `experiment.json` + upsert `experiments-index.json` + update `loop.json`.
5. **Optional reference recording** ? `reference_skills.experiment-recording` if installed via `oma reference install`.
6. **Next lap** ? user steers next phase.

---

## Reference skills (optional)

Shipped in package `skills/reference/`. **Not** installed by `oma setup` ? only via:

```bash
oma reference install experiment-analysis
oma reference install experiment-recording -p cursor
```

Registered in `index.json` ? `reference_skills`; files live in agent platform skills dir only.

---

## Standalone

`oma go loop` ? gates advisory; loop bookkeeping still applies.
