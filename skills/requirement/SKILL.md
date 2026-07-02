# Skill: $requirement

**Purpose**: Establish the complete context for robot algorithm development. Uses a benchmark paper as the primary information anchor to ground requirements in literature, then runs a minimal targeted interview to capture project-specific constraints — including the robotics-critical fields that papers rarely state explicitly.

**Gate in**: None. This is the entry point of the OMA lifecycle.
**Standalone entry**: Always allowed. If no paper is available, ask for 3 fields: task description, primary metric, hardware target.
**Gate out**: Creates two locked artifacts:
- `.oma/requirement/knowledge.md` — external literature knowledge (read-only after this skill)
- `.oma/requirement/requirements.md` — project constraints and success criteria (gate chain source)

---

## Overview

Traditional requirement gathering starts from nothing and relies entirely on the user articulating their problem space. This skill inverts that: the benchmark paper does most of the information work first. By the time the targeted interview begins, most fields in `requirements.md` are already pre-populated from the paper — the user only needs to confirm or override.

```
Paper (PDF)
    ↓
Phase 1: Extract 6 key sections from paper
    ↓
Phase 2: Synthesize → knowledge.md
    ↓
Phase 3: Pre-fill requirements.md draft from knowledge.md
    ↓
Phase 4: Targeted interview — confirm deltas only (≤6 questions)
    ↓
Phase 5: Lock both artifacts → open gate to $design
```

---

## Phase 1 — Paper Ingestion

### 1a. Check for pre-extracted content

First, check if `oma extract` was already run:
- If `.oma/requirement/paper/raw-sections.json` exists → read it and skip to Phase 2.
- If `.oma/requirement/paper/knowledge-draft.md` exists → read it and skip to Phase 3.

### 1b. Request paper if not pre-extracted

If no pre-extracted content:

```
I need a benchmark paper to anchor the requirements. Please provide one of:

  Option A: Run `oma extract --paper path/to/paper.pdf` before this session,
            then restart the $requirement workflow.

  Option B: Paste the key sections directly into this session:
            - Abstract (full text)
            - Related Work or Background (full text)
            - Experiments / Evaluation Setup (full text)
            - Limitations or Conclusion (full text)
```

Wait for the user to provide content. Do not proceed to Phase 2 without it.

### 1c. Identify and extract sections

From the paper text, extract the following sections. Use section header matching (case-insensitive, allow numbering like "2. Related Work" or "§3 Experiments"):

| Section | Purpose | Priority |
|---------|---------|----------|
| Abstract | Problem definition in one paragraph | high |
| Introduction | Gap being addressed, why existing methods fail | high |
| Related Work / Background | Algorithm family landscape | high |
| Method / Approach | Innovation claims | medium |
| Experiments / Evaluation | Dataset, metrics, baselines, reported numbers | **critical** |
| Limitations / Conclusion | Known failure modes, open problems | high |

If a section cannot be found, mark it as `[not found]` and note which information will need to come from the user interview instead.

---

## Phase 2 — Synthesize knowledge.md

Using the extracted sections, produce `.oma/requirement/knowledge.md` with the following schema. Be specific — extract actual numbers, dataset names, metric formulas from the paper text. Do not paraphrase vaguely.

```markdown
# Knowledge Base
_Source: {full paper title} — {authors} ({year})_
_Venue: {conference/journal or "preprint"}_
_Extracted: {date}_
_Status: LOCKED — do not modify after $requirement completes_

## Problem Formulation
- Task: {one-sentence task description from abstract}
- Input: {data format, modality}
- Output: {prediction format}
- Core challenge the paper addresses: {one sentence}

## Algorithm Landscape
| Family | Representative Papers | Strength | Weakness |
|--------|----------------------|---------|---------|
| {e.g. gradient boosted trees} | {paper names} | {strength} | {weakness} |

Synthesis: {1–2 sentences on which families are dominant and why}

## Innovation Claims (what this paper does differently)
- {Claim 1: specific and falsifiable}
- {Claim 2}
- {Claim 3}

Note: These become candidate directions for $design. They represent the paper's
      proposed solution — not necessarily what we will implement.

## Evaluation Protocol (from Experiments section)
- Dataset: {name, size, train/test split if stated}
- Primary metric: {name + formula if non-standard}
- Secondary metrics: {list}
- Baselines compared against: {list with their reported scores}
- Best result in paper: {metric name}: {value} (on {dataset}, {split})
- Evaluation protocol details: {e.g. 5-fold CV, single test set, specific seeds}

## Known Limitations (from paper)
| Limitation | Source location | Implication for our work |
|-----------|----------------|--------------------------|
| {limitation text} | {section} | {what this means for our constraints} |

## Reproduction Constraints
- Compute reported: {e.g. "8×A100 GPUs, 3 days" or "not stated"}
- Data availability: {public / proprietary / partial}
- Code released: {yes + URL / no / partial}
- Special infrastructure: {e.g. "requires FPGA" or "none"}

## Dead End Seeds
<!-- These will be transferred to memory.md by $consolidate after experiments begin -->
Directions the paper explicitly found not to work:
- {direction}: {why it failed per paper}
```

**Quality check before proceeding:**
- [ ] Evaluation Protocol section contains at least one concrete metric value (a number from the paper).
- [ ] Known Limitations has at least one entry (if the paper has none, note "paper reports no limitations").
- [ ] Algorithm Landscape covers ≥2 algorithm families.

If any check fails, re-read the relevant section more carefully before continuing.

---

## Phase 3 — Pre-fill requirements.md draft

Using `knowledge.md`, produce a draft of `.oma/requirement/requirements.md` with every field that can be inferred from the paper pre-populated. Mark each field's source explicitly.

Source tags:
- `[from paper]` — directly taken from paper's Experiments section
- `[proposed]` — reasonable inference from paper context, not explicitly stated
- `[NEEDS USER INPUT]` — cannot be inferred, must be answered in Phase 4

```markdown
# Requirements — {project name}
_Created: {date}_
_Status: DRAFT — pending Phase 4 confirmation_

## Problem Definition
- Task type: {value} [from paper]
- Input: {value} [from paper]
- Output: {value} [from paper]

## Data
- Source: {paper's dataset name} [from paper] → confirm: same dataset or different?
- Size: {from paper or "unknown"} [from paper / NEEDS USER INPUT]
- Split: {from paper or proposed} [from paper / proposed]
- Known issues: [NEEDS USER INPUT]
- Data version: [NEEDS USER INPUT]

## Success Criteria
| Metric | Baseline | Threshold (deploy gate) | Stretch |
|--------|----------|------------------------|---------|
| {paper's primary metric} | {paper's best result} [from paper] | [NEEDS USER INPUT] | [NEEDS USER INPUT] |

## Constraints
- Compute budget: [NEEDS USER INPUT]
- Seeds per config: 3 [proposed]
- Inference latency: [NEEDS USER INPUT]

## Evaluation Protocol
- Held-out test set: {from paper or proposed} [from paper / proposed]
- Primary ranking metric: {paper's primary metric} [from paper]

## Non-Goals (this cycle)
- [NEEDS USER INPUT]
```

Count the `[NEEDS USER INPUT]` fields — these drive the Phase 4 interview. There should be ≤6 of them. If more, look harder at the paper to fill them.

---

## Phase 3b — Robotics Platform Fields (always required for robot projects)

After the base requirements.md is drafted, append a `## Robot Platform` section. These fields are almost never stated in papers — they must come from the user. However, keep it to ONE focused question if most can be inferred from context.

```markdown
## Robot Platform

### Hardware Target
- Robot model / platform: [NEEDS USER INPUT]  # e.g. "Unitree Go2", "custom 12-DoF biped"
- DoF count: [NEEDS USER INPUT / from paper]
- Joint type: [NEEDS USER INPUT]  # revolute / prismatic / mixed
- Actuation: [NEEDS USER INPUT]  # servo / hydraulic / SEA

### Sim Environment
- Primary sim: [NEEDS USER INPUT]  # MuJoCo / Isaac Gym / Isaac Lab / Gazebo / PyBullet
- Sim physics dt: [from paper / proposed: 0.005s]
- Control frequency (policy Hz): [NEEDS USER INPUT]  # e.g. 50 Hz
- Sim-to-real gap concern level: [NEEDS USER INPUT]  # low / medium / high

### Observation & Action
- Observation space: [from paper / NEEDS USER INPUT]
  # Standard proprioceptive: joint pos (n), joint vel (n), base orientation (4 or 3),
  #   base ang vel (3), projected gravity (3), velocity command (3), last action (n)
- Action space: [from paper / NEEDS USER INPUT]  # joint positions / torques / velocities
- Action scale: [from paper / proposed: 0.25 rad for position control]
- History length (frame stack): [from paper / proposed: none]

### Training Regime
- Algorithm family: [NEEDS USER INPUT]  # PPO / SAC / TD3 / other
- Episode length: [from paper / NEEDS USER INPUT]  # seconds
- Curriculum: [from paper / proposed: none initially]  # flat → terrain / easy → hard

### Deployment Constraints
- Max policy inference latency: [NEEDS USER INPUT]  # must fit within 1/control_hz
- Onboard compute: [NEEDS USER INPUT]  # e.g. "Jetson Orin 16GB", "NUC i7"
- Communication interface: [NEEDS USER INPUT]  # ROS2 / custom UDP / CAN

### Sim2Real Gap Risks (pre-identified)
- Actuator model accuracy: [proposed: medium — PD gains may differ ±20%]
- Ground contact model: [proposed: medium — real floor friction varies]
- Sensor noise: [proposed: medium — IMU and encoder noise to characterize]
- Payload variation: [NEEDS USER INPUT]  # expected mass range
```

**Interview strategy for robot fields**: Ask as ONE bundled question:
> "For the robot platform section, please confirm: (1) robot model + DoF, (2) sim environment (MuJoCo / Isaac?), (3) policy control frequency (Hz), (4) onboard compute for deployment."

All other robot fields can be proposed/defaulted from the paper or reasonable robotics conventions.

---

## Phase 4 — Targeted Confirmation Interview

Only ask about `[NEEDS USER INPUT]` fields plus one mandatory framing question. Ask them in order, one at a time.

**Mandatory framing question (always ask first):**

> The paper evaluated on **{dataset}** using **{metric}** and achieved **{value}**.
> Are you trying to: (A) replicate this exact setup, (B) use this as a reference but apply to your own data/domain, or (C) beat this result on the same benchmark?

This single question resolves the most common misalignment between paper protocol and project intent.

**Then ask only the remaining `[NEEDS USER INPUT]` fields**, in this order:

1. **Compute budget**: "What is your GPU budget — max hours per experiment, and total for this development cycle?"
2. **Data / Sim env**: "Which simulation environment are you using, and are you using the paper's exact setup or a custom variant?"
3. **Threshold**: "Based on the paper's {metric} = {value}, what threshold must you reach to consider this cycle successful?"
4. **Robot platform**: "Robot model, DoF, policy control frequency (Hz), and onboard compute for deployment?" (single bundled question)
5. **Non-goals**: "What is explicitly out of scope for this cycle? (This prevents scope creep during tuning.)"
6. **Latency**: "What is the maximum policy inference latency allowed on the target hardware?"

Do NOT ask questions whose answers are already derivable from the paper. Do NOT ask open-ended "tell me about your problem" questions — the paper already answered those.

---

## Phase 5 — Lock Outputs

### 5a. Finalize knowledge.md

Replace the draft header with:
```
_Status: LOCKED — do not modify after $requirement completes_
```

Transfer the "Dead End Seeds" section note to a comment — `$consolidate` will move these into `memory.md` on the first run.

### 5b. Finalize requirements.md

Replace all `[from paper]`, `[proposed]`, `[NEEDS USER INPUT]` tags with the confirmed values. Replace `DRAFT` status with `LOCKED`.

Add a provenance footer:
```markdown
---
_Provenance: knowledge.md (paper extraction) + user confirmation (Phase 4 interview)_
_Locked by: $requirement on {date}_
_Next step: run $design_
```

### 5c. Initialize memory.md Dead End Seeds

If `.oma/tracks/{track_id}/memory.md` does not yet exist, create it from the template and pre-populate the Dead Ends table with entries from `knowledge.md`'s "Dead End Seeds" section. Mark each with source `[from paper]`.

### 5d. Sanity checks before completion

- [ ] `knowledge.md` contains a concrete metric value from the paper (not just a field name).
- [ ] `requirements.md` has zero `[NEEDS USER INPUT]` tags remaining.
- [ ] The threshold in requirements.md is strictly above the paper's reported baseline (if not, ask user to clarify).
- [ ] `memory.md` has been initialized (even if Dead Ends table is empty).
- [ ] `Robot Platform` section is complete with at minimum: robot model, sim env, control_hz, onboard compute.
- [ ] Control frequency is consistent with inference latency constraint (policy network must fit in 1/control_hz seconds).
- [ ] `deploy/deploy-config.json` control_hz field matches this value — copy it now if the file exists.

---

## Completion Signal

Report:
```
Requirements locked.

  knowledge.md:    {N} algorithm families mapped, {N} limitations extracted,
                   evaluation protocol grounded in {paper title}
  requirements.md: threshold = {metric} ≥ {value}, compute budget = {GPU-hrs}
  memory.md:       {N} Dead End seeds pre-loaded from paper

  Robot Platform:
    Robot:         {model}
    Sim:           {sim environment}
    Control Hz:    {hz} Hz  (inference budget = {1000/hz:.1f} ms)
    Hardware:      {onboard compute}
    Sim2Real risk: {low/medium/high}

Gate to $design is now open.
```

---

## Standalone Entry Protocol

If `.oma/standalone.json` exists when this skill is loaded:

```
⚠️ STANDALONE MODE — entering $requirement directly (no prior gates required).
```

No context files are required for `$requirement` — it always starts from scratch. Ask the user:

> "I'll run the requirements session now. Do you have a benchmark paper to anchor the requirements? If yes, run `oma extract --paper path.pdf` first, or paste the abstract + experiments section here. If no, tell me: (1) task description, (2) primary metric, (3) robot platform."

Proceed with whatever information is provided. Do not block on a paper.
