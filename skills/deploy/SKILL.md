# Skill: $deploy

**Purpose**: Drive a structured, round-based sim2real validation campaign on real hardware for a deployed robot locomotion policy. This skill does NOT simply package a model — it generates a rich deployment contract (`deploy_info.json`), maintains a living checklist (`sim2real_checklist.md`), guides each hardware session through staged safety gates, records results per round, and generates per-issue identification plans when problems arise. The output is a field-tested set of adapted parameters and a `design-feedback.md` for the next iteration.

**Gate in**: `.oma/best.json` with `deployGateOpen: true`.
**Standalone entry**: Allowed via `oma go deploy`. If `best.json` is missing, ask: "Which checkpoint are you deploying? Provide: (1) policy file path, (2) robot model, (3) control_hz, (4) did it pass sim evaluation?" Then proceed with a `⚠️ STANDALONE` notice.
**Gate out**: `deploy/sim2real_checklist.md` with all mandatory stages `✓ completed`.
**Experience library**: path from `index.experiences_dir`. Lookup:
```
oma xp index --stage deploy --format md
oma xp show <id>
oma xp search "<topic>" --stage deploy
```
Check the index at Phase 0 for past sim2real experiences (ankle tuning, gait issues, latency fixes, etc.) before generating the deploy_info.json.

---

## The Real Sim2Real Loop

```
$deploy ─── Phase 0:   Read source code → understand the full deployment stack
              ↓
            Phase 0.5: Generate deploy_info.json (deployment contract)
              ↓
            Phase 0.6: Create/update sim2real_checklist.md (living state doc)
              ↓
            Phase 1:   Sim2Real gap analysis → sim2real-gap.md
              ↓
            Phase 2:   Plan next hardware session → sim2real/plans/{plan_name}.md
              ↓
            Phase 3:   Execute session (operator + Codex in real-time)
              ↓
            Phase 4:   Record results → sim2real/results/round_{NN}_{desc}.md
              ↓
            Phase 5:   Update checklist + draw conclusions
              ↓
            Phase 6:   If issues found → generate identification plan → GOTO Phase 2
                        If stage passed → advance to next stage → GOTO Phase 2
                        If all stages passed → GOTO Phase 7
              ↓
            Phase 7:   Design feedback + deployment decision
```

**Key difference from a standard workflow**: Real robot testing happens in discrete **rounds** (physical hardware sessions). Each round has a pre-session plan and a post-session result file. Codex assists both before the session (planning) and after (interpreting results, deciding next steps). Do not try to compress all stages into one session.

---

## Phase 0 — Read the Full Deployment Stack

Before generating any artifact, read the actual source files that define the deployment. The information in these files is ground truth — it overrides any assumptions from `design-{id}.md`.

**What to read**:

| File type | What to extract |
|-----------|----------------|
| Policy file (`.onnx`, `.pt`, `.jit`) | File path, existence check |
| Control config (`.yaml`, `.json`) | `control_hz`, joint names, `stiffness`, `damping`, `init_state`, `obs_scales`, `action_scale`, `lpf_conf`, `cmd_threshold`, `cycle_time`, `decimation` |
| Controller source (`.cc`, `.cpp`, `.py`) | Obs vector construction order, action-to-joint mapping, torque vs position control per joint, LPF logic, ROS topic names |
| MJCF / URDF | Joint chain order, joint limits, link masses, foot frame names |
| README / deployment notes | Any known caveats, required hardware setup, start sequence |

**How to read source files**:
- Use `oma search` or direct file reads to extract the above.
- If the user said `oma go deploy --reason "..."`, the reason tells you what stage they're entering at and what's already done.
- If running in standalone mode, ask ONE question for any missing critical field (e.g., "What is the path to the policy file and config yaml?").

---

## Phase 0.5 — Generate deploy_info.json (Deployment Contract)

Generate `deploy/deploy_info.json` from the source files read in Phase 0. This is the single source of truth for the entire deploy stage. All subsequent phases reference this file.

**Template** (`.oma/templates/deploy_info_template.json` if it exists, otherwise build from scratch):

```json
{
  "schema_version": "1.0",
  "generated_from": {
    "policy_file_repo_path": "<path to .onnx/.pt in repo>",
    "control_config_repo_path": "<path to config yaml>",
    "controller_source_repo_path": "<path to controller .cc/.py>",
    "mjcf_repo_path": "<path to .xml or .urdf>"
  },
  "deployment_target": {
    "controller_name": "<controller identifier>",
    "control_frequency_hz": <hz>,
    "subscribe_topics": { "<topic_name>": "<ros_topic>" },
    "publish_topics": { "<topic_name>": "<ros_topic>" }
  },
  "model_contract": {
    "policy_file": "<deployed path>",
    "actions_size": <n_joints>,
    "observations_size": <single_frame_obs_dim>,
    "num_hist": <history_frames>,
    "stacked_observations_size": <observations_size * num_hist>,
    "observations_clip": <clip_value>,
    "actions_clip": <clip_value>
  },
  "joint_order": {
    "description": "Action output order must match joint_list order exactly.",
    "action_joint_list": ["<joint_0>", "<joint_1>", "..."]
  },
  "rl_walk_params": {
    "init_state": [<per-joint values in action_joint_list order>],
    "stiffness": [<kp per joint>],
    "damping": [<kd per joint>],
    "walk_step_conf": {
      "action_scale": <float>,
      "decimation": <int>,
      "cycle_time": <float>,
      "cmd_threshold": <float>
    },
    "obs_scales": {
      "lin_vel": <float>, "ang_vel": <float>,
      "dof_pos": <float>, "dof_vel": <float>
    },
    "lpf_conf": {
      "wc": <cutoff_hz>,
      "ts": <1/control_hz>,
      "parallel_joints": ["<ankle_joints...>"]
    }
  },
  "observation_contract": {
    "description": "Single-frame obs layout, concatenated then stacked.",
    "single_frame_layout": [
      {"name": "<channel_name>", "size": <int>},
      "..."
    ],
    "single_frame_total": <observations_size>,
    "stack_rule": "<description of how history buffer is built>"
  },
  "action_to_command_mapping": {
    "position_target_formula": "pos_des = action[i] * action_scale + init_state[i]",
    "postprocess": ["<step 1>", "<step 2 — e.g. parallel/series joint distinction>"]
  },
  "sim2real_focus": {
    "goal": "Use staged real-robot tests to identify which deployment-side parameters need adaptation without changing the trained policy first.",
    "recommended_test_sequence": [
      {
        "stage": "sensor_and_sign_check",
        "purpose": "Verify sensor links, joint order, joint sign, zero offsets before enabling RL.",
        "watch_items": ["Joint sign matches intended positive direction", "IMU axes consistent with controller frame", "joint_offset and zeroing correct", "Command directions produce expected motion"],
        "primary_tuning_targets": ["joint_offset", "joint_limits", "topic mapping / sensor frame"]
      },
      {
        "stage": "stand_transition",
        "purpose": "Check zero → stand and hold stability before RL.",
        "watch_items": ["Overshoot during transition", "High-frequency oscillation in hips/knees/ankles", "Steady-state pose bias", "Motor heating"],
        "primary_tuning_targets": ["pd_zero stiffness/damping", "pd_stand stiffness/damping", "joint_offset"]
      },
      {
        "stage": "rl_idle_and_in_place_step",
        "purpose": "Enable RL with zero or small velocity command; observe calm behavior.",
        "watch_items": ["Stepping at zero command (cmd_threshold issue)", "Ankle chatter from torque-mode joints", "Action saturation", "LPF delay vs responsiveness"],
        "primary_tuning_targets": ["cmd_threshold", "lpf_conf.wc", "ankle stiffness/damping", "action_scale"]
      },
      {
        "stage": "low_speed_walk",
        "purpose": "Forward walking at conservative speed on flat ground.",
        "watch_items": ["Step length too large/small", "Toe scuffing", "Body pitch/roll drift", "Velocity tracking lag", "Left/right asymmetry"],
        "primary_tuning_targets": ["action_scale", "cycle_time", "obs_scales.lin_vel", "leg stiffness/damping"]
      },
      {
        "stage": "lateral_and_yaw",
        "purpose": "Test lateral and yaw commands after forward walking is stable.",
        "watch_items": ["Yaw-roll coupling", "Lateral slip", "Turning overshoot"],
        "primary_tuning_targets": ["obs_scales.lin_vel", "obs_scales.ang_vel", "action_scale", "cycle_time"]
      },
      {
        "stage": "disturbance_and_contact_robustness",
        "purpose": "Pushes and varied floor surfaces after stable baseline walk.",
        "watch_items": ["Recovery delay", "Ankle saturation", "Foot slap on landing", "Instability after impact"],
        "primary_tuning_targets": ["ankle stiffness/damping", "lpf_conf.wc", "joint_limits", "action_scale"]
      }
    ],
    "symptom_to_parameter_hints": [
      {"symptom": "Too aggressive / step amplitude too large", "check": ["action_scale too high", "stiffness too high", "cycle_time too short"]},
      {"symptom": "Sluggish / drags feet / fails to commit", "check": ["action_scale too low", "stiffness too low", "damping too high", "lpf_conf.wc too low"]},
      {"symptom": "High-frequency oscillation or chatter", "check": ["stiffness too high", "damping too low", "IMU/joint velocity noise", "lpf_conf.wc too high"]},
      {"symptom": "Ankle torque joints vibrate under load", "check": ["ankle kp/kd mismatch", "lpf_conf.wc not suitable for torque-mode path", "joint offset or sign error"]},
      {"symptom": "Zero command still causes stepping", "check": ["cmd_threshold too small", "joystick deadband mismatch", "cmd topic residual noise"]}
    ]
  }
}
```

**Fill-in rules**:
- Read `stiffness`, `damping`, `init_state` directly from the control config yaml — do not infer.
- Read joint order from the config — the order must exactly match the policy's output dimension.
- Read `parallel_joints` from the controller source (the joints that use torque-mode instead of position-mode).
- Build `observation_contract` by parsing the controller source's obs construction loop.
- Save to `deploy/deploy_info.json`.

---

## Phase 0.6 — Create sim2real_checklist.md (Living State Document)

Create `deploy/sim2real_checklist.md`. This file is updated after EVERY hardware round. It is the primary state tracker for the entire deploy stage.

```markdown
# Sim2Real Checklist
_Algorithm: {design_id} | Hardware: {robot_name} | Policy: {policy_file}_

关联资料:
- 部署基线: deploy/deploy_info.json
- RL 配置: {control_config_path}
- 控制器: {controller_source_path}

## 文档结构
- 总体 checklist: 本文件
- 具体方案: deploy/sim2real/plans/
- 每轮结果: deploy/sim2real/results/

## 当前状态
| 项目 | 当前值 |
|---|---|
| 当前 sim2real 轮次 | Round 1 |
| 当前轮状态 | not started |
| 当前重点 | sensor_and_sign_check |

## 阶段总览
| 阶段 | 状态 | 目标 | 方案 | 最近结果 |
|---|---|---|---|---|
| sensor_and_sign_check | pending | 传感器/关节/符号验证 | 待创建 | 待更新 |
| stand_transition | pending | 站立稳定 | 待创建 | 待更新 |
| rl_idle_and_in_place_step | pending | RL 零速基础行为 | 待创建 | 待更新 |
| [parameter_identification] | — | 按需插入 | — | — |
| low_speed_walk | pending | 低速直行 | 待创建 | 待更新 |
| lateral_and_yaw | pending | 横移与转向 | 待创建 | 待更新 |
| disturbance_and_contact | pending | 扰动与接触鲁棒性 | 待创建 | 待更新 |

## 轮次索引
| 轮次 | 状态 | 目标 | 结果文件 |
|---|---|---|---|
| Round 1 | pending | — | 待生成 |

## 当前结论
_（每轮实验后更新）_

## 维护规则
- 本文件只维护总览，不写大段实验细节。
- 具体方案写到 deploy/sim2real/plans/
- 每轮结果写到 deploy/sim2real/results/round_NN_{desc}.md
- 每完成一轮: 更新当前轮次、状态、阶段总览、轮次索引、当前结论
```

---

## Phase 1 — Sim2Real Gap Analysis

Before the first hardware session, write `deploy/sim2real-gap.md`. Focus on the gaps that are most likely to affect each stage of the test sequence.

For each gap category, assess: **what was used in sim vs what the hardware actually has**.

```markdown
# Sim2Real Gap Analysis
_Design: {design_id} | Date: {date}_

## Algorithm Profile
- Policy type: {MLP / Transformer / CNN}
- Obs space: {key channels from observation_contract}
- Action space: {position targets / joint torques — note parallel joints}
- Control frequency: {control_hz} Hz
- History buffer: {num_hist} frames × {observations_size} dims

## Gap Assessment Table
| Category | Sim Setting | Real-World Typical | Gap Risk | Priority |
|----------|------------|-------------------|----------|----------|
| Latency | {modelled delay} | {real inference + comms} | | 1 |
| Motor Kp/Kd (standard joints) | {values from config} | {hardware varies ±N%} | | 2 |
| Ankle Kp/Kd (torque-mode parallel) | {values} | {real response at load} | HIGH | 1 |
| Sensor noise (IMU, encoders) | {noise std from DR} | {real noise PSD} | | |
| LPF cutoff | {lpf_conf.wc} | {effective delay at real noise level} | | |
| Action scale | {action_scale} | {real joint range utilization} | | |
| Contact model | {sim foot contact} | {real floor, surface variability} | | |

## Predicted Failure Modes (per stage)
1. sensor_and_sign_check: {e.g. joint sign error, topic mismatch}
2. stand_transition: {e.g. ankle oscillation, hip overshoot}
3. rl_idle: {e.g. ankle chatter from torque-mode mismatch}
4. low_speed_walk: {e.g. toe scuffing from action_scale or Kd mismatch}

## Stage-Priority Order
Based on gap risk: {list stages in order of highest gap risk}
```

---

## Phase 2 — Plan Next Hardware Session

Before EACH hardware session, create a plan file:

```
deploy/sim2real/plans/{stage_name}_{optional_focus}.md
```

The plan must contain:
1. **Session goal** — what stage(s) this session targets.
2. **Pre-session checklist** — hardware, software, safety prerequisites.
3. **Test procedure** — step-by-step, with specific parameter values and commands.
4. **Watch items** — exactly what to observe (from `deploy_info.json` `sim2real_focus`).
5. **Pass / fail criteria** — when to call this stage done vs escalate.
6. **Stop conditions** — when to stop immediately (safety).
7. **Data to record** — what logs/measurements to capture for post-analysis.

**When to generate an identification plan**:

If a previous round found an issue that needs quantitative characterization before changing parameters, create an identification plan rather than immediately changing values. Identification is especially required for:
- Joint oscillation or chatter → identify Kp/Kd/bandwidth before tuning
- Velocity tracking error → identify effective velocity feedback gain
- Left/right asymmetry → identify per-joint offset or friction mismatch

**Identification plan template** (`deploy/sim2real/plans/{joint}_{type}_identification.md`):

```markdown
# {Joint Group} {Characterization Type} Identification Plan

目标: 在修改参数前，得到等效闭环响应特性，判断应优先调哪个参数。

## 辨识原则
- 一次只测一个关节，其余关节锁定在稳定姿态。
- 先空载，再轻接地；先小幅阶跃，再扫频。
- 先保持 kp 不变，用响应形态判断 kd 优先级。

## 测试前固定项
| 项目 | 建议值 | 备注 |
|---|---|---|
| 机器人状态 | 吊保护或可靠支撑 | 避免跌倒 |
| 其他关节 | 锁定在稳定站姿 | 减少耦合 |
| 记录频率 | >= {control_hz} Hz | |
| 每次改动 | 只改一个变量 | |

## 需要记录的数据
| 字段 | 必需 | 用途 |
|---|---|---|
| 时间戳 t | 是 | 对齐分析 |
| 关节名 | 是 | 区分 |
| 目标位置 q_des | 是 | 输入参考 |
| 实际位置 q | 是 | 跟踪误差 |
| 实际速度 dq | 是 | 阻尼/振荡判断 |
| 输出 effort/torque | 是 | 饱和判断 |
| 当前 kp / kd | 是 | 记录配置 |
| IMU 局部角速度 | 推荐 | 接触振动传播 |

## 实验 1: 空载小阶跃
| 项目 | 建议值 |
|---|---|
| 幅值 | 0.02 rad 起, 最多 0.05 rad |
| 保持时间 | 1 ~ 2 s |
| 重复次数 | 正反各 5 次 |
| 中止条件 | 异响 / 持续振荡 / 输出异常增大 |

## 实验 2: 空载扫频
| 频率点 | 0.5, 1, 2, 3, 5, 7 Hz |
| 幅值 | 0.01 ~ 0.02 rad |
| 每点时长 | 8 ~ 10 s |

## 实验 3: 轻接地小阶跃
_如空载无问题，验证接触条件下是否更容易抖。_

## 调参决策表
| 辨识结果 | 优先动作 |
|---|---|
| 阶跃超调大，存在衰减振荡 | 先增加 kd |
| 响应偏软、跟踪慢、无明显抖动 | 先增加 kp |
| 空载正常，接地才抖 | 先小幅增加 kd，再看是否降低 lpf_conf.wc |
| 高频小抖，扫频高频段放大 | 先增加 kd，必要时降低 lpf_conf.wc |
| 左右差异明显 | 先排查装配/摩擦/零位，不先改统一参数 |
| effort 经常接近饱和 | 不加 kp，先看命令幅值和接触工况 |

## 辨识记录表
| 轮次 | 关节 | 工况 | 输入类型 | 幅值 | kp | kd | 超调 | 稳定时间 | 是否抖动 | effort 异常 | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | |
```

---

## Phase 3 — Execute Hardware Session

This phase happens ON the hardware, with the operator running the plan.

**Codex's role during session**:
- If the user provides real-time observations (e.g., "ankle is chattering at ~5Hz"), use the `symptom_to_parameter_hints` from `deploy_info.json` to diagnose and suggest what to check.
- Do NOT suggest parameter changes without first identifying the root cause.
- If an unexpected failure occurs, ask the user to note: conditions, what happened, what the robot did, timestamp. This goes into the incident section of the results file.

**Safety gates — stop ALL testing if**:
- Any joint exceeds its configured limit for > {N} ms
- Robot falls and cannot self-recover
- Unusual audible noise or motor heating
- Operator calls e-stop

---

## Phase 4 — Record Session Results

After EACH hardware session, create:

```
deploy/sim2real/results/round_{NN}_{short_description}.md
```

Format:

```markdown
# Round {NN} 实机实验结果
_日期: {date} | 地点: {location} | 操作员: {operator}_

轮次目标: {what this session was supposed to accomplish}

## 阶段结果

| 阶段 | 结果 | 结论 | 后续动作 |
|---|---|---|---|
| {stage_name} | {通过 / 部分通过 / 未通过 — specific observation} | {root cause if failed} | {next action} |

## 参数变更记录

| 参数 | 变更前 | 变更后 | 理由 | 效果 |
|---|---|---|---|---|
| {param_name} | {old_value} | {new_value} | {why} | {observed effect} |

## 本轮结论
- {bullet 1: what was confirmed}
- {bullet 2: what was found}
- {what is currently NOT recommended to change}
- {what the next priority action is}

## 安全事件 (如有)
_（描述: 条件、发生了什么、恢复情况）_
```

---

## Phase 5 — Update Checklist and Draw Conclusions

After writing the results file, update `deploy/sim2real_checklist.md`:

1. Increment the round number.
2. Update the stage status in the 阶段总览 table.
3. Add a new row to the 轮次索引 table.
4. Replace the 当前结论 section with new conclusions.
5. If a new plan is needed, create it and add it to the 阶段总览 table.

**Decision logic**:

```
Did the current stage PASS?
  YES → Advance to next stage. Create a plan for it. Update checklist.
  NO  →
    Is the failure due to a quantifiable parameter issue?
      YES → Create an identification plan → GOTO Phase 2
      NO (setup/hardware issue) → Fix it, re-run same stage
    Was there a safety incident?
      YES → Stop. Document. Do not continue until root cause is resolved.

Have ALL stages in the 阶段总览 passed?
  YES → GOTO Phase 6 (Design Feedback)
  NO  → GOTO Phase 2 (Plan next session)
```

---

## Phase 6 — Design Feedback

After all mandatory stages pass (or after deciding to stop due to persistent failure), write `deploy/design-feedback.md`.

Convert every round's parameter changes and failures into concrete hypotheses for the next `$design` iteration:

```markdown
# Design Feedback for Next Iteration
_Source: deploy rounds 1–{N} | Algorithm: {design_id} | Date: {date}_

## Critical (must fix before next deployment attempt)

### FB-01: {Title}
- **Evidence**: {specific observation + round number}
- **Root cause hypothesis**: {mechanical, sim DR, reward, obs design, etc.}
- **Recommended $design change**:
  - Option A: {change}
  - Option B: {alternative}
- **Expected gain**: {what would improve}
- **Priority**: HIGH / MEDIUM / LOW

## Parameter Adaptations Made (not design changes — record for next deploy baseline)

| Parameter | Sim value | Deployed value | Adaptation reason |
|---|---|---|---|
| {e.g. ankle_kd} | {sim} | {real} | {why it needed changing} |
```

---

## Phase 7 — Deployment Decision

Based on stage completions and outstanding issues:

**DEPLOY**: All mandatory stages passed. Acceptable gaps documented. Parameter adaptations recorded.
- Lock the adapted parameter set in `deploy/deploy_info.json` (update `rl_walk_params`).
- Write final `deploy/sim2real_checklist.md` with all stages `✓ completed`.

**HOLD — fix hardware/config**: Failure was due to setup issue (wrong topic, firmware, calibration). Fix and re-run affected stage only.

**RETURN TO $design**: Sim2real gap is fundamental — cannot be closed by parameter adaptation alone.
- Write the decision in `deploy/sim2real_checklist.md`.
- Hand `deploy/design-feedback.md` to the next `$design` session.
- Announce: "Returning to $design with {N} critical findings. See deploy/design-feedback.md."

---

## Completion Signal

```
Deploy complete.
  Algorithm:    {design_id}
  Hardware:     {robot_name}
  Rounds run:   {N}
  Stages:       {N passed} / {total} — {N pending}
  Decision:     {DEPLOY / HOLD / RETURN TO $design}
  Adapted params: {list key changes from sim baseline}
  Design feedback: {N} recommendations → deploy/design-feedback.md
  {If DEPLOY: Final params locked in deploy/deploy_info.json}
  {If RETURN: Top priority for $design: {FB-01 title}}
```

---

## File Map

```
deploy/
├── deploy_info.json          ← Phase 0.5: deployment contract (generated from source)
├── sim2real_checklist.md     ← Phase 0.6: living state doc (updated every round)
├── sim2real-gap.md           ← Phase 1: gap analysis
├── design-feedback.md        ← Phase 6: feedback for next $design
├── sim2real/
│   ├── plans/
│   │   ├── round_01_sensor_and_sign.md
│   │   ├── ankle_kp_kd_identification.md
│   │   └── ...
│   └── results/
│       ├── round_01_field_test.md
│       ├── round_02_ankle_identification.md
│       └── ...
└── tests/                    ← Optional: automated measure/analyze scripts (see templates)
    └── ...
```
