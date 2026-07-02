# Skill: $design

**Purpose**: AI + Human co-creation of robot algorithm design via three parallel idea streams. Produces a concrete, implementation-ready design document covering policy architecture, reward function, observation/action space, domain randomization, and training curriculum.

**Gate in (loop entry, HARD)**: `.oma/requirement/knowledge.md` must exist and contain `Status: LOCKED`. This is the only hard gate to enter the iteration loop. Once inside, `$design` may be re-entered any time (e.g. after a `$tune` analysis motivates a change) — do not treat re-entry as starting over.
**First lap vs delta**: the **first lap** produces a full `design-{id}.md`. **Later laps** usually capture only a *delta* — the `hypothesis` + `change` of the lap (archive_level `light`); a fresh full design doc is required only for major changes (reward redesign, architecture swap → archive_level `full`).
**Loop bookkeeping**: on entry, upsert `.oma/tracks/{track_id}/loop.json` — set `stage: design`; use `index.default_track` unless session specifies another active track. If this is a new change after a closed `$train`/`$tune` round, bump `lap` and allocate the next `exp_id`. See AGENTS.md › track loop schema.
**New paradigm track**: if starting a new design-paradigm route, run `oma track open <track-id> --label "..."` first.
**Standalone entry**: Allowed via `oma go design` / `oma go loop`. If knowledge.md is missing, ask the user for the **minimal loop seed**: task description, sim environment, hardware target, and primary metric + direction — write to `.oma/index.json` `meta.metric` and `meta.robot`. If a codebase is registered (`oma index`), infer what you can first and only confirm. Do not run the full `$requirement` interview.
**Gate out**: For a full lap, creates `.oma/tracks/{track_id}/design/design-{id}.md`. For a delta lap, the change lives in the lap's `experiment.json`. `$implement` is **not** hard-gated on a fresh design doc inside the loop.
**Experience library**: path from `index.experiences_dir` (set via `oma xp init --dir <path>`). Lookup:
```
oma xp index --stage design --format md
oma xp show <id>
oma xp search "<topic>" --stage design
```
Use the index at Phase 0 to quickly check if past reward structures, DR ranges, or architecture choices are relevant. This is optional — use your judgment.

---

## Core Principle: Generation Before Evaluation

**Stream A, B, C must all complete before any idea is evaluated.**

Evaluating ideas during generation causes the model to self-censor toward safe, conservative directions. The three streams must produce their full idea pools independently first. Cross-stream comparison and scoring happens only in Phase 3.

```
Phase 0  Context loading
    ↓
Phase 1  ┌─── Stream A ───┐  ┌─── Stream B ───┐  ┌─── Stream C ───┐
         │  Literature    │  │  Limitation    │  │  Cross-domain  │
         │  Hunting       │  │  Driven        │  │  Transfer      │
         └────────────────┘  └────────────────┘  └────────────────┘
         (3–5 ideas each, generated independently, no cross-referencing)
    ↓
Phase 2  Idea evaluation  (novelty × feasibility + red-team)
    ↓
Phase 3  Human co-creation  (idea cards → select / modify / hint)
    ↓
Phase 4  Design commitment  (elaborate selected idea → design-{id}.md)
```

---

## Session Resumption Check (run FIRST)

Before regenerating anything, check for a saved idea pool from a previous design session:

- If `.oma/design-draft.md` exists → read it. It contains all three stream idea pools already generated. **Skip Phase 1 entirely**, proceed to Phase 2 (evaluation) or Phase 3 (human co-creation) based on what's already in the file.
  - If the draft ends mid-stream (e.g. only Stream A and B) → resume from the missing stream.
  - If all three streams are complete but no human selection yet → go directly to Phase 3 (present idea cards).
  - If human selected ideas but `design-{id}.md` is absent → go directly to Phase 4 (design commitment).

Announce which phase you're resuming from.

If `.oma/design-draft.md` does not exist → start fresh from Phase 0.

---

## Phase 0 — Context Loading

Read the following files before starting. Do not proceed if any required file is missing.

1. `.oma/requirement/knowledge.md` **(required, must be LOCKED)**
   Extract and hold in working memory:
   - `problem_type`: task description from Problem Formulation
   - `input_output`: input modality + output format
   - `core_challenge`: the gap the reference paper addresses
   - `limitations`: full list from Known Limitations table
   - `algorithm_landscape`: all rows from Algorithm Landscape table
   - `innovation_claims`: list from Innovation Claims
   - `eval_protocol`: dataset, primary metric, best result from paper
   - `dead_ends`: from Dead End Seeds table (never propose these)

2. `.oma/tracks/{track_id}/memory.md` (if exists)
   Extract Dead Ends table — these are also forbidden directions.

3. `.oma/requirement/paper/search-cache/` (if exists)
   Pre-fetched search results from `oma search`. Load into Stream A context.

4. `.oma/requirement/requirements.md`
   Extract compute budget and constraint list — used in feasibility scoring.

5. `.oma/codebase/config.json` **(if exists — registered via `oma index`)**
   Resolve **`tracks[{track_id}].srcPath`** for the active track (fallback: top-level `srcPath` for legacy projects).
   Optionally load `key-files.md` / `arch-map.md` if present under `.oma/codebase/`. Extract:
   - `primary_lang`: primary implementation language and framework
   - `entry_points`: training / evaluation script paths (tag `entry:train`, `entry:eval`)
   - `model_files`: architecture module paths (tags `arch:*`)
   - `data_files`: dataset / loader paths (tags `data:*`)
   - `key_classes`: top-level classes from `arch-map.md`

   **Impact on design streams:**
   - Stream A: note which recently found ideas are implementable given the existing framework
   - Stream B: include code-level limitations (e.g. hardcoded batch size, monolithic loop)
     in addition to paper-level limitations — these are real friction points, not just theoretical
   - Phase 4 architecture spec: reference actual module names and file paths from the codebase
     rather than generic names (e.g. "modify `model.py:TransformerBlock`" not "add attention layer")

   If no `srcPath` for this track, add a note:
   > "No codebase for track `{track_id}`. Run `oma index --src <repo-path> --track {track_id}` before $implement Path A.
   > $implement will use Path B (from scratch) unless indexed before design is finalized."

---

## Phase 1 — Three-Stream Parallel Generation

Run all three streams. Label every idea with its stream origin.
**Do not evaluate, filter, or rank ideas within a stream.**

---

### Stream A — Literature Hunting

**Goal**: Find what the academic community has done after the reference paper. Ideas come from real recent work, grounded in evidence.

**Step A1 — Generate search seeds from knowledge.md**

From `algorithm_landscape` and `innovation_claims`, produce 4–6 search queries:
- `"{problem type} {primary metric} improvement {current year - 1} OR {current year}"`
- `"{reference paper title}" citations recent`
- `"{algorithm family} limitations {known limitation keyword}"`
- `"{problem type} state of the art benchmark"`

**Step A2 — Retrieve results**

Check `.oma/requirement/paper/search-cache/` first (populated by `oma search`).
If cache exists: read `search-results.json` and `semantic-scholar-*.json` files.
If cache empty: use web search with the queries from A1. For each result, extract:
- Paper title, year, venue
- The core algorithmic innovation (one paragraph)
- Reported metric gain over prior work

Collect 8–15 papers. Discard results older than 3 years unless highly cited (>200 citations).

**Step A3 — Extract ideas**

For each relevant paper, write one idea entry:

```
[Stream A — Literature] Idea A{n}
Title: {one-line description of the idea}
Source: {paper title} ({year}, {venue})
Mechanism: {how it works — specific, not vague}
Reported gain: {metric}: +{value} over {baseline}
Applicability: {why this can apply to our problem}
```

Produce 3–5 Stream A ideas. If fewer than 3 relevant papers are found, note the gap and produce what is available.

---

### Stream B — Limitation-Driven Ideation

**Goal**: Generate ideas that directly address known failure modes. These ideas do not need paper grounding — they are derived purely by reasoning from the limitations.

**Rule**: Write all Stream B ideas BEFORE checking whether they appear in Stream A. Cross-referencing happens in Phase 2, not here.

**Step B1 — Enumerate limitations**

List every entry from `knowledge.md` Known Limitations table. Also include limitations implied by the reference paper's experimental setup (e.g., "only tested on one dataset" → generalization is a limitation).

**Step B2 — For each limitation, generate 2–3 solution paths**

For each limitation:
```
Limitation: {text from knowledge.md}

Path 1: {mechanism} — {why it would address the limitation}
Path 2: {mechanism} — {why it would address the limitation}
Path 3: {mechanism} — {why it would address the limitation}
```

When generating paths, apply these creative heuristics in order:
- **Invert the assumption**: what if the opposite of the paper's approach is done?
- **Decompose and specialize**: break the component that causes the limitation into sub-parts; solve each independently
- **Borrow the fix**: what solved an analogous limitation in a different component of the same system?

**Step B3 — Consolidate into ideas**

Select the most promising path per limitation (do not evaluate — pick by specificity and novelty of mechanism). Format:

```
[Stream B — Limitation] Idea B{n}
Title: {one-line description}
Addresses: {specific limitation from knowledge.md}
Mechanism: {specific algorithmic mechanism}
Hypothesis: {if we apply X, limitation Y is reduced because Z}
Risk: {what could make this fail}
```

Produce 3–5 Stream B ideas.

---

### Stream C — Cross-Domain Transfer

**Goal**: Find techniques from unrelated domains that solve structurally analogous problems. This is the highest-novelty stream — ideas here are unlikely to already exist in the reference paper's literature.

**Step C1 — Characterize the problem structure**

Write a structural description of the problem using only domain-agnostic language:

```
Structure:
  Input type:       {e.g., "set of variable-length sequences with pairwise relationships"}
  Transformation:   {e.g., "identify global patterns while preserving local structure"}
  Output type:      {e.g., "discrete label over the full set"}
  Core difficulty:  {e.g., "combinatorial explosion in the relationship space"}
```

**Step C2 — Find analogous problems in 3+ other domains**

Using the structural description (not the domain name), identify problems in other fields with the same transformation challenge. Consider:
- Computational biology (protein folding, gene expression)
- Computational physics (particle systems, fluid simulation)
- Computer graphics (scene rendering, mesh processing)
- Operations research (scheduling, routing)
- Neuroscience-inspired computing
- Signal processing
- Reinforcement learning (even if the task is not RL)

For each analogy:
```
Domain: {field}
Analogous problem: {what is being solved there}
Structural match: {why the transformation is similar to our problem}
Breakthrough technique: {the method that solved it, with year}
Transfer proposal: {concretely how to adapt it to our problem}
```

**Step C3 — Format as ideas**

```
[Stream C — Cross-Domain] Idea C{n}
Title: {one-line description}
Source domain: {field}
Analogy: {structural match in one sentence}
Mechanism: {how the transferred technique works in our domain}
Why novel: {why this combination hasn't appeared in algorithm_landscape}
Transfer risk: {what structural mismatch could cause the transfer to fail}
```

Produce 3–5 Stream C ideas. **At least 2 must come from domains not mentioned anywhere in knowledge.md.**

---

## Phase 2 — Idea Evaluation

**Before starting evaluation, save all three streams to `.oma/design-draft.md`:**

```markdown
# Design Draft — {project name}
_Saved: {ISO timestamp}_
_Status: streams-complete — awaiting evaluation and human selection_

## Stream A Ideas
{full Stream A output}

## Stream B Ideas
{full Stream B output}

## Stream C Ideas
{full Stream C output}
```

This file enables cross-session recovery. If the session ends now, the next session can skip Phase 1 entirely.

---

Now that all three streams are complete, evaluate the full idea pool.

**Do not generate new ideas here.** If an idea is weak, document why — do not replace it.

### Scoring

For each idea, assign scores 1–5:

| Dimension | 1 | 3 | 5 |
|-----------|---|---|---|
| **Novelty** | Already in knowledge.md or memory.md | Variant of known method | Not seen in any reviewed source |
| **Feasibility** | Requires unavailable resources/data | Implementable with significant effort | Directly implementable given constraints |
| **Expected gain** | Unlikely to improve primary metric | +1–2% improvement expected | +5%+ improvement plausible |

**Priority score** = Novelty × Feasibility × Expected gain

### Red-team

For every idea scoring Priority ≥ 6, write one paragraph arguing strongly against it. Red-team should:
- Identify the most likely implementation failure mode
- Identify a dataset or scenario where this idea would underperform baseline
- Name a simpler alternative that achieves 80% of the benefit

### Clustering

Group ideas with similar mechanisms (regardless of stream). Mark duplicates — keep the higher-priority version, note the stream origin of both.

### Output

Produce a ranked idea table:

```markdown
## Idea Pool (ranked by priority)

| Rank | ID   | Title | Stream | Novelty | Feasibility | Gain | Priority | Red-team summary |
|------|------|-------|--------|---------|-------------|------|----------|-----------------|
| 1    | C2   | ...   | C      | 5       | 4           | 4    | 80       | ... |
| 2    | B1   | ...   | B      | 4       | 4           | 4    | 64       | ... |
```

---

## Phase 3 — Human Co-Creation

Present ideas to the human as **idea cards**, starting from the top 5–7 by priority.

### Idea Card Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Idea {rank}: [{ID}] {Title}                Stream: {A/B/C}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mechanism:   {2–3 sentences, specific}
Why novel:   {what makes this different from knowledge.md}
Expected:    {metric gain estimate}
Risk:        {red-team's main concern}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your call:   [ select ]  [ modify: ___ ]  [ skip ]
```

Present all cards before waiting for response. Then ask one question:

> "Which ideas do you want to move forward? You can:
> - **Select** one or more by ID (e.g. 'C2, B1')
> - **Modify** an idea by saying 'C2 but without X' or 'B1 + add Y'
> - **Add a hint**: type any direction you have in mind — I'll expand it into a full design
> - **Combine**: 'C2 core + B1's approach to the limitation'
>
> There are no wrong answers here."

### Hint Expansion

If the human provides a new hint (not selecting an existing idea):

1. **Elaborate first, evaluate later**: write a full mechanism description for the hinted direction before assessing feasibility
2. Then score it against the same rubric
3. Present the expanded version as a new idea card

### Combination Handling

If the human wants to combine ideas:
1. Write the combined mechanism explicitly — do not assume the combination is coherent
2. Identify the integration point (where the two mechanisms interact)
3. Note any conflicts or redundancies in the combined design

---

## Phase 4 — Design Commitment

Based on human selection, elaborate the chosen idea into a full design document.

**Step D1 — Architecture specification**

Write out every component needed to implement the selected idea. For robot RL policies, all sections below are required:

**Policy Network**:
- Architecture type: MLP / CNN / Transformer / RNN — with concrete layer sizes
- Input dimension: sum of obs_space elements from requirements.md
- Output dimension: DoF (for position control) or DoF (for torque control)
- Activation: ELU / ReLU / Tanh — and where applied
- Output activation: none (position) / tanh (bounded torque)
- Action scale: concrete multiplier (e.g. `0.25 rad`)

**Value Network** (if actor-critic):
- Shared backbone vs separate encoder — specify
- Output: scalar V(s)

**Reward Function** (the most critical robot-specific design decision):
For each reward component:
```
Component: {name}
Formula:   {exact formula with coefficients}
Scale:     {coefficient weight}
Purpose:   {what behavior it shapes}
Risk:      {what it could cause if over-weighted}
```
Minimum components to specify: locomotion reward, survival bonus, energy penalty, velocity tracking, orientation penalty.

**Observation Space** (must be concrete):
```
obs = [
  base_orientation (4,),        # quaternion or roll/pitch/yaw
  base_ang_velocity (3,),       # IMU gyro
  joint_positions (N,),         # encoder readings - default_pos
  joint_velocities (N,),        # encoder derivatives
  velocity_command (3,),        # vx, vy, omega
  last_action (N,),             # previous policy output
  # optional: projected_gravity (3,), foot_contacts (M,), history (T × K,)
]
```
Total dim = {sum}. Must match control_hz filtering assumptions.

**Action Space**:
- Type: joint position targets / joint torques / joint velocity
- Clipping: range per joint (from URDF limits, reduced for safety)
- PD control: specify Kp, Kd (or reference sim values from deploy-config.json)

**Domain Randomization**:
```
| Parameter | Sim default | Randomization range | Distribution |
|-----------|------------|---------------------|--------------|
| Kp        | {value}    | ±20%                | uniform      |
| Kd        | {value}    | ±20%                | uniform      |
| mass      | {value}    | ±10%                | uniform      |
| friction  | {value}    | 0.3 – 1.5           | uniform      |
| latency   | {sim_ms}ms | +0 – 10ms           | uniform      |
| noise_std | 0          | [IMU: 0.01 rad/s]   | Gaussian     |
```

**Training Curriculum** (if applicable):
- Stage 1: flat terrain, no perturbation, low speed command
- Stage 2: introduce terrain / perturbations / higher speed
- Promotion criteria: {metric threshold to advance stage}

**Algorithm**:
- RL algorithm: PPO / SAC / TD3 — specify why
- PPO: clip_range, entropy_coef, n_steps, batch_size, n_epochs, GAE λ
- SAC: tau, buffer_size, learning_starts, gradient_steps
- Learning rate schedule: linear decay / cosine / constant — with concrete values

**Loss function (for policy gradient)**:
```
L = L_policy + c1 * L_value + c2 * L_entropy
```
where c1, c2 are concrete values.

**Optimization strategy**: optimizer, schedule, concrete hyperparameters, gradient clipping.

**Sim environment setup**: physics dt, control dt, episode length, reset conditions.

**Step D2 — Ablation plan**

For each major design decision, define a corresponding ablation variable:

```markdown
| Decision | Variable | Candidates | Hypothesis | Priority |
|---------|---------|-----------|-----------|---------|
| {e.g. reward energy coefficient} | energy_coef | [0.0, 0.001, 0.01] | 0.001 balances speed and efficiency | high |
```

Minimum 5 ablation variables for robot RL. Required ablation axes:
- Reward component weights (at least 2 coefficients)
- Network architecture (width / depth / activation)
- Domain randomization range (at least 1 parameter)
- Learning rate
- Action scale

These become the search space for `$tune`.

**Step D3 — Alternative designs**

Write 1–2 lighter-weight alternatives based on the next-ranked ideas. These serve as fallbacks if the primary design fails during `$train`.

**Step D4 — Write design-{id}.md**

Use the template at `templates/design.md`. Fill every section. Include:
- `Provenance` field for each major decision (Stream A/B/C + source)
- `Design risks` table
- Pointer back to the idea pool (which ideas were considered and why others were not selected)

---

## Completion Signal

```
Design committed: {design-id}

  Primary design:   {one-line description}
  Provenance:       Stream {X} — {source}
  Ablation plan:    {N} variables, {M} total configurations
  Alternatives:     {N} fallback designs documented

  Robot specifics:
    Policy arch:    {type}, input={obs_dim}, output={act_dim}
    Reward terms:   {N} components specified with coefficients
    DR ranges:      {N} parameters randomized
    Algorithm:      {PPO/SAC/...}, lr={lr}
    Control Hz:     {hz} Hz → {1000/hz:.0f}ms inference budget

Gate to $implement is now open.
```

**After writing `design-{id}.md`**: delete `.oma/design-draft.md` (the draft is superseded by the committed design).

---

## Standalone Entry Protocol

If `.oma/standalone.json` exists when this skill is loaded:

```
⚠️ STANDALONE MODE — entering $design directly.

Missing context will be handled as follows:
  • knowledge.md missing → ask: "Describe the task, sim env, and primary metric in 2–3 sentences."
  • requirements.md missing → skip feasibility scoring; note "unconstrained budget" in design
  • memory.md missing → no Dead Ends loaded; note this in design as a risk
  • codebase/ missing → will use Path B (from scratch) in $implement
```

After collecting any critical missing context, proceed directly to Phase 1 (three-stream generation). Do not conduct a full requirements interview — that is `$requirement`'s job.
