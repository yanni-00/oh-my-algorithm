# oh-my-algorithm (OMA)

OMA 是一套**机器人算法开发工作流编排层**，请严格执行相关流程。

**核心技能（3 个）**：`requirement` | `loop` | `deploy` — 由 `oma setup` 注入 agent 平台 skills 目录（Codex `.codex/skills/`，Cursor `.cursor/skills/`），**不在 `.oma/`**。Reference 在包内 `skills/reference/`，仅 `oma reference install` 注入。

**核心风险**：Sim2Real gap 是每个阶段的首要风险。Reward hacking 是静默失败——高奖励若缺乏物理可信度即为死路。切勿仅凭仿真结果断言策略有效。

---

## 启动协议（任何动作之前必须执行）

1. 是否存在 `.oma/standalone.json`？→ **Standalone 模式**（门控仅作建议，不阻断）。
2. 读取 `.oma/tracks/{track_id}/memory.md` → 内化 Dead Ends（已证伪方向）。**不要**重新探索它们。
3. 检查所请求 skill 的门控条件。门控未通过 = 停止并报告（仅 Normal 模式）。
4. **跨会话恢复**：
   - 读取 `.oma/index.json` → 项目仪表盘：`meta`（配置）、`active_tracks` / `closed_tracks`、`default_track`。运行时状态在 `.oma/tracks/{track_id}/loop.json`。
   - **当前 track**（`index.default_track`）：读取 `.oma/tracks/{track_id}/loop.json` → `lap` / `stage` / `exp_id` / `hypothesis`。这是 design↔implement↔train↔tune 环的 primary「我在哪」指针。
   - 遗留：根目录 `.oma/loop.json` 或 `.oma/config.json` → 执行 `oma doctor --migrate`。
   - 存在 `.oma/design-draft.md` → `$design` 中断；从 Phase 2 恢复，跳过 idea generation。
   - 存在 `.oma/tune-current.json` → `$tune` 进行中；读取 `phase` 字段并按阶段恢复。
   - 扫描所有 `tracks/*/experiments/*/results.json` 中 `"status":"running"` 的条目 → 对每个孤儿任务执行 `gm task info`。
5. **经验库**：读 `index.experiences_dir`；再 `oma xp index --format md`（或 `--dir` 覆盖）。仅对相关条目 `oma xp show <id>`。

---

## 门控链（两个硬门控 + 自由迭代环）

**只有两个硬门控**。二者之间是一个循环、数据驱动的迭代环，`$design`、`$implement`、`$train`、`$tune` **互为建议性门控**——可任意方向移动（包括回退：例如 `$tune` 分析暴露问题后直接回 `$design` 改 delta），不会触发硬门控。

```
$requirement  →  requirements.md + knowledge.md  (LOCKED)
        │
        ▼   ══ 硬门控（进环）: requirements.md LOCKED ══
┌──────────────── 迭代环（一圈 ≈ 一个 exp_id，per track）────────────────┐
│                                                                      │
│   $design ──→ $implement ──→ $train ──→ $tune                        │
│      ▲   (delta)   │  (code)    │ (gm)    │ (sweep/analyse)          │
│      │             │            │         │                          │
│      └─────────────┴────────────┴─────────┘  数据驱动变更              │
│                                                                      │
│   每圈:  hypothesis + change + result + conclusion  (experiment.json) │
│   收尾:  $train → experiment-analysis → [人工确认]                     │
│                  → experiment-recording → 下一圈                       │
│   环状态: .oma/tracks/{track_id}/loop.json                           │
│   tracks: 设计范式级并行路线 — 见 index.json                            │
│                                                                      │
└────────────────────────────────┬─────────────────────────────────────┘
                                 ▼   ══ 硬门控（出环）: best.json deployGateOpen === true ══
                      $deploy →  Sim2Real gap 分析 → 测试 campaign → 真机
                              →  design-feedback.md  ──（再进环）
```

**门控语义**

| 过渡 | 门控条件 | 类型 |
|------|----------|------|
| → 进环（`$design`/`$implement`/`$train`/`$tune`） | `requirements.md` LOCKED | **硬** |
| 环内（四阶段任意 ↔ 任意） | 无 — 仅建议 | 软 |
| 环 → `$deploy` | `best.json` `deployGateOpen === true` | **硬** |

环内 Agent **不得**因「上游产物缺失」而阻断流程。`$tune` 暴露问题后可直回 `$design`（delta）或 `$implement`，无需新的完整设计文档。

- **首圈（first lap）**：通常产出完整 `design-{id}.md`。
- **后续圈（later laps）**：通常只记 *delta* —— 该 lap 的 `experiment.json` 中的 `hypothesis` + `change`（`archive_level: light`）。
- **升格为 full**：仅当重大变更（奖励重设计、架构替换等）→ `archive_level: full`，并产出新的完整设计文档。

---

## Tracks（设计范式级并行路线）

- **Track** = 设计范式级路线（如 redirect-data、gait-clock、minimal-reward），不是 reward 调参级 lap。
- **Lap** = 同一 track 内的迭代；实验目录为 `tracks/{track_id}/experiments/{exp_id}/`。
- **开新 track**：`oma track open <track-id> --label "..."` — **不要**手改 `index.json`。
- **切换**：`oma track switch <track-id>`。
- **封闭**：`oma track close <track-id> --deliverable "..."`。

---

## 阶段 I/O 合约（进入任何阶段前必读）

| 阶段 | 读取（输入） | 写入 / 记录（输出） | Skill / 模板 |
|------|--------------|---------------------|--------------|
| `$requirement` | 论文、用户访谈 | `requirements.md`、`knowledge.md`（LOCKED） | `.codex/skills/requirement/SKILL.md` + 模板 |
| `$loop` → design | `knowledge.md`（或 loop seed） | 完整 `design-{id}.md`（首圈）**或** delta | `loop/SKILL.md` → `loop/phases/design.md` |
| `$loop` → implement | 当前设计 / lap delta | 代码 + `impl/*` | `loop/phases/implement.md` |
| `$loop` → train | 已 push 代码 / 配置 | `tracks/{track_id}/experiments/{exp_id}/results.json`（`running`→`completed`）、更新 `experiments-index.json` | `loop/phases/train.md` |
| `$loop` → tune | ≥1 train 结果 | `tracks/{track_id}/experiments-index.json`、`best.json` | `loop/phases/tune.md` |
| `$deploy` | `best.json` 门控已开 | `deploy/`、`sim2real_checklist.md` | `deploy/SKILL.md` |
| `$loop` → consolidate | 近期实验 | `memory.md` | `loop/phases/consolidate.md` |
| reference: experiment-recording | 已完成的 run | `experiment.json` | `.codex/skills/reference-...`（若已安装） |

每个阶段进入时还须更新 `.oma/tracks/{track_id}/loop.json` 的 `stage`（新 lap 开始时更新 `lap`/`exp_id`）。默认 track 为 `index.default_track`。

## 记录纪律（lap 检查点 — 软约束，Agent 主动提议）

1. **每圈收尾** — 当 `$train` 或 `$tune` 产出结果时 — Agent 必须**主动提议归档**。
2. **检查点捕获内容**：`hypothesis`、`change`、`result`、`conclusion`（`experiment.json` 字段）。
3. **归档后**：更新 `tracks/{track_id}/loop.json`。
4. 绝不让 lap 静默结束 — 未记录的 lap = 丢失的经验。

## 模板

流程模板位于 `.oma/templates/`（由 `oma setup` 安装）。产出某阶段产物前，**先读 Stage I/O 表中对应模板**并遵循其结构。

---

## 关键词 → Skill 路由

| 关键词 | Skill | 动作 |
|--------|-------|------|
| requirement, define problem, clarify, success criteria | `$requirement` | 读 `requirement/SKILL.md`，执行 |
| design, architecture, reward design, policy design, network | `$loop` (design) | 读 `loop/SKILL.md`，再读 `loop/phases/design.md` |
| implement, code it, build pipeline, write trainer | `$loop` (implement) | 读 `loop/SKILL.md`，再读 `loop/phases/implement.md` |
| index codebase, scan repo, reference implementation | `oma index` | 执行 `oma index --src <path> [--track <id>]`；`oma index --list` 查看映射 |
| train, run training, launch experiment, start training | `$loop` (train) | 读 `loop/phases/train.md` |
| tune, sweep, ablation, hyperparameter, final eval | `$loop` (tune) | 读 `loop/phases/tune.md` |
| consolidate, update memory, record findings | `$loop` (consolidate) | 读 `loop/phases/consolidate.md` |
| analyse exp, compare exp, exp CSV, joints, leg symmetry, yaw drift, /compare | reference | 若已安装 `experiment-analysis` → 读 `.codex/skills/reference-...`；否则 `$loop` 通用分析 |
| record exp, archive experiment, write to lab, /update-lab | reference | 若已安装 `experiment-recording` → 读该 skill；否则通用 `experiment.json` |
| deploy, sim2real, hardware test, real robot | `$deploy` | 读 `deploy/SKILL.md`，执行 |
| next lap, next exp, iterate, 下一轮, 下一圈, 再改, loop | `$loop` | bump lap、分配 `exp_id`，进入对应 phase |
| new track, 新路线, 并行, open track, 开 track | Track | `oma track open ...`，再 `$loop` (design) |
| track list, 活跃 track, switch track | Track | `oma track list` / `switch` |
| reference install, lab skill | `oma reference` | `list` / `install` / `add` |
| go \<stage\>, skip to, jump to, just do, standalone | Standalone | 写 `.oma/standalone.json` |
| gm, gradmotion, training platform | `$loop` (train) | `train.md` + `adapters/gradmotion/SKILL.md` |

迭代环内，保持 `tracks/{track_id}/loop.json` 的 `stage` 最新，**不要**因上游产物缺失而阻断。

---

## Standalone 模式

```bash
oma go requirement | design | implement | train | tune | deploy
oma go loop [--stage design|implement|train|tune] [--track <id>] [--reason "..."]
oma track open|close|list|switch <track-id>
oma go off   # 恢复门控模式（保留 track loop.json）
```

### 免 `$requirement` 进环（`oma go loop`）

豁免进环硬门控，确保 track 存在，初始化 `.oma/tracks/{track_id}/loop.json`，直接进入迭代环。**出环硬门控仍然有效**。

**最小种子**（非阻断）：向用户确认主指标 + 方向 → 写入 `index.json` `meta.metric`；机器人/仿真目标 → `meta.robot`。

---

## 状态文件

| 路径 | 负责阶段 |
|------|----------|
| `.oma/index.json` | 仪表盘 — `meta` 配置、`active_tracks`、`closed_tracks`、`experiences_dir` |
| `.oma/tracks/{track_id}/loop.json` | 该 track 的迭代环指针 |
| `.oma/requirement/requirements.md` | `$requirement` |
| `.oma/requirement/knowledge.md` | `$requirement` |
| `.oma/tracks/{track_id}/design/design-{id}.md` | `$design` |
| `.oma/impl/impl-checklist.md` | `$implement` |
| `.oma/impl/github.json` | `$implement` |
| `.oma/experiments/{track_id}/` | 该 track 实验档案根目录（`oma track open` 创建） |
| `.oma/tracks/{track_id}/experiments/{exp_id}/` | `$train`、`$tune` |
| `.oma/tracks/{track_id}/experiments-index.json` | `$train`、`$tune` |
| `.oma/best.json` | `$tune` Phase 5 |
| `.oma/tracks/{track_id}/memory.md` | 仅 `$consolidate` |
| `.oma/standalone.json` | `oma go` |
| `deploy/` | `$deploy` |

### `.oma/index.json`

顶层路由：`meta` 含项目配置；`active_tracks` / `closed_tracks` 登记范式级路线；`experiences_dir` 为经验库路径。环状态在 `tracks/{id}/loop.json`。

**经验库**：`oma xp init --dir <path>` 配置路径（写入 `experiences_dir`）；所有 `oma xp` 命令使用该路径，可用 `--dir` 单次覆盖。

### `.oma/tracks/{track_id}/loop.json`

```json
{
  "track_id": "gait-clock",
  "lap": 3,
  "stage": "tune",
  "exp_id": "exp-20260630-002",
  "hypothesis": "提高 ankle-torque DR 上界以抑制 yaw 漂移",
  "opened_at": "2026-06-30T09:00:00Z",
  "updated_at": "2026-06-30T11:20:00Z"
}
```

- **新 lap**：`$train`/`$tune` 收尾后带着新改动进入 `$design`/`$implement` 时触发。
- **同 lap 内跳转**：仅更新 `stage` / `updated_at`。
