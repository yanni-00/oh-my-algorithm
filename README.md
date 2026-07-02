# oh-my-algorithm (OMA)

> 机器人强化学习算法开发的全流程编排层 · An agent-native orchestration layer for robot RL algorithm development

[![Node.js](https://img.shields.io/badge/runtime-Node.js-green)](https://nodejs.org)
[![Codex](https://img.shields.io/badge/powered%20by-Codex%20CLI-blue)](https://github.com/openai/codex)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

---

## 什么是 OMA？

**oh-my-algorithm (OMA)** 是一套**面向 Agent 的**机器人算法开发工作流编排层。它将机器人强化学习开发拆分为独立、上下文感知的阶段 skill，用**两个硬门控**夹着一个 **`$design ↔ $implement ↔ $train ↔ $tune` 迭代环**管理流程推进，最终经 `$deploy` 完成 Sim2Real 验证。

OMA 最初在 [Codex CLI](https://github.com/openai/codex) 上打磨成型，但架构本身是**Agent 泛化的**——同一套协议可运行在 [Codex](https://github.com/openai/codex)、[Cursor](https://cursor.com)、[Claude Code](https://docs.anthropic.com/en/docs/claude-code) 乃至你自建的 Agent 上。`oma setup -p <platform>` 按各平台的提示词落点生成路由与 skill，CLI 与 `.oma/` 状态层保持不变。

OMA 不是框架，不是库。它是一套**开发工作流协议**：用结构化的阶段状态文件、技术文档模板和 skill 提示词，让 Agent 在每个阶段都能做出高质量、领域正确的决策。

### 核心特性

- **Agent 泛化架构**：同一套 `.oma/` 状态与 CLI，适配 Codex、Cursor、Claude Code 及自定义 Agent（`oma setup -p`）
- **双硬门控 + 迭代环**：`$requirement` 锁定后进入环内；环内 `$design ↔ $implement ↔ $train ↔ $tune` 可任意跳转；`best.json` 达标后退出至 `$deploy`
- **单阶段直入 / 免需求进环**：`oma go <stage>` 或 `oma go loop` 绕过门控快速迭代
- **项目经验库**：`oma xp` 路径由用户配置（`experiences_dir`）；索引与内容分离
- **机器人 RL 优先**：控制频率、自由度、Sim2Real gap、奖励函数设计是一等公民
- **Gradmotion 原生集成**：gm CLI、Isaac GYM 镜像、A10 GPU 任务创建规范内置
- **零外部依赖**：CLI 仅使用 Node.js 内置模块
- **Sim2Real 部署验证**：8 类测试模板（延迟/电机/噪声/稳定性/步态/速度/扰动/地形）

---

## 安装

```bash
# 克隆仓库
git clone https://github.com/yumxcode/oh-my-algorithm.git
cd oh-my-algorithm

# 全局安装（无需 npm install，零依赖）
npm install -g .

# 验证安装
oma --help
```

安装后 `oma` 命令全局可用。

---

## 快速开始

### 1. 初始化项目

```bash
# 在你的机器人算法项目目录下
mkdir my-robot-algo && cd my-robot-algo
oma setup
```

`oma setup` 会创建 `.oma/` 目录结构并引导你完成初始配置。

### 2. 启动 Agent 并开始需求阶段

在你选用的 Agent 环境中打开项目（Codex / Cursor / Claude Code 等），Agent 会读取平台对应的提示词文件，自动识别项目阶段并进入 requirement skill：

```bash
# Codex CLI 示例
codex
# Agent 读取 AGENTS.md，自动识别项目阶段，进入 requirement skill

# Cursor：在项目目录打开 Cursor，oma-core 规则与 skills 自动注入
# Claude Code：oma setup -p claude-code 后读取 CLAUDE.md
```

### 3. 按阶段推进（门控模式）

OMA 不是一条直线，而是 **两个硬门控** 夹着一个 **自由迭代环**：

```
$requirement  →  requirements.md + knowledge.md  (LOCKED)
        │
        ▼   ══ 硬门控（进环）: requirements.md LOCKED ══
┌─────────────── 迭代环（一圈 ≈ 一个 exp_id）────────────────────────┐
│                                                                    │
│   $design ──→ $implement ──→ $train ──→ $tune                      │
│      ▲   (delta)   │  (code)    │ (gm)    │ (sweep/analyse)        │
│      │             │            │         │                        │
│      └─────────────┴────────────┴─────────┘  数据驱动，可任意回跳     │
│                                                                    │
│   每圈记录: hypothesis + change + result + conclusion (experiment.json) │
│   环状态指针: .oma/tracks/{track_id}/loop.json                      │
│   仪表盘: .oma/index.json  (meta / active_tracks / closed_tracks)   │
└────────────────────────────────┬───────────────────────────────────┘
                                 ▼   ══ 硬门控（出环）: best.json deployGateOpen ══
                      $deploy → Sim2Real 测试 → 真机 → design-feedback（再进环）
```

- **进环硬门控**：`requirements.md` + `knowledge.md` 锁定后，才能进入 `$design`/`$implement`/`$train`/`$tune`
- **环内软门控**：四阶段互为建议，不因缺上游产物而阻断（例如 `$tune` 发现问题可直接回 `$design` 改 delta）
- **出环硬门控**：`$tune` 写出 `best.json` 且 `deployGateOpen === true` 后，才能进入 `$deploy`

### 4. 直接进入迭代环（跳过需求阶段）

已有代码库、只想快速实验时，可免 `$requirement` 直接进环：

```bash
oma go loop                                    # 从 $design 开始，lap 1
oma go loop --stage tune --track gait-clock --reason "步态时钟路线"
oma track open gait-clock --label "步态时钟驱动"   # 新开设计范式 track
oma track list                                 # 活跃/封闭 tracks
oma status                                     # 查看 index + 默认 track 的 lap
oma go off                                     # 退出 standalone（保留 track loop.json）
```

`oma go loop` 会确保 track 存在、写 `.oma/tracks/{id}/loop.json` 与 `.oma/standalone.json`，豁免进环硬门控；**出环硬门控仍然有效**。项目配置在 `index.json` 的 `meta` 中；Agent 首次进环时会确认最小种子。

### 5. 单阶段直入（绕过门控）

```bash
# 直接进入训练阶段，无需完整前置
oma go train --reason "已有参考实现，直接开始训练调试"

# 查看当前 standalone 状态
oma go status

# 退出 standalone 模式，恢复门控
oma go off
```

---

## CLI 命令参考

### `oma setup`

初始化 OMA 项目结构。

```bash
oma setup                      # 默认 codex 平台
oma setup -p cursor            # 适配 Cursor Agent
oma setup -p claude-code       # 适配 Claude Code
```

在当前目录创建：
- `.oma/` — 项目状态目录（所有平台共用）
- 平台 Agent 提示词 — `AGENTS.md` / `.cursor/rules/oma-core.mdc` / `CLAUDE.md` 等（如不存在则从模板生成）

#### 平台 `-p`

| 平台 | 行为规范层落点 | 路由方式 |
|------|----------------|----------|
| `codex`（默认） | `.codex/skills/` — 3 核心 + `loop/phases/` + `adapters/` | `AGENTS.md` 关键词路由表 |
| `meta-agent` | 同上 | `AGENT.md` 关键词路由表 |
| `cursor` | `.cursor/rules/oma-core.mdc` + `.cursor/skills/`（`requirement`/`loop`/`deploy` + `loop-*` 阶段） | `alwaysApply` 规则 + skill frontmatter |
| `claude-code` | `.claude/skills/` | `CLAUDE.md` 关键词路由表 |

**技能架构**：包内 `skills/`（核心 + `skills/reference/` 实验室技能）。**`oma setup` 只把核心技能注入 agent 平台目录，不写 `.oma/`**。Reference 仅 `oma reference install` 时注入（如 `.cursor/skills/reference-experiment-analysis/`）。

**为什么 cursor 不一样**：Cursor 不稳定加载根目录 `AGENTS.md`，也不认关键词路由表；它每轮注入 `.cursor/rules/*.mdc`（`alwaysApply`），并按 `.cursor/skills/*/SKILL.md` 的 frontmatter `description` 语义匹配自动选用 skill。因此 `oma setup -p cursor` 会：

1. 把 `AGENTS.md` 改写成 `.cursor/rules/oma-core.mdc`（`alwaysApply: true`）；
2. 安装 `requirement`、`loop`、`deploy` 及 `loop-design` … `loop-consolidate` 到 `.cursor/skills/`（`adapters/` 不单独导出；参考技能用 `oma reference install -p cursor`）；
3. 仍写一份根目录 `AGENTS.md` 作 `@AGENTS.md` 兜底；
4. `.oma/` 状态目录与 CLI 完全不变；
5. `.gitignore` 忽略 oma 注入的 agent 资产（`.cursor/skills/`、`.codex/skills/` 等），**不含** `.oma/skills/`（已不再生成）。

skill 的 `description` 文案由 `configs/cursor-skill-meta.json` 维护，可按需改触发话术。

---

### 自定义习惯：`--overlay`

OMA 只规定**大过程**（门控/迭代环）和**各阶段沉淀的 skill**；`oma setup -p` 按平台机制生成
Agent 提示词文件并放好 skill。如果你在某些子过程里有自己的习惯/自定义行为，**写成一个 markdown 文件**，
用 `--overlay` 传入即可——OMA 原样追加到平台 Agent 提示词文件末尾，让各平台 Agent 看到。

```bash
oma setup -p cursor --overlay ./my-habits.md
oma setup -p codex  --overlay ./my-habits.md
```

追加位置按平台：codex → `AGENTS.md` 末尾；cursor → `.cursor/rules/oma-core.mdc` 末尾；
claude-code → `CLAUDE.md` 末尾。内容包在受管区
`<!-- OMA:USER-OVERLAY:BEGIN…END -->` 里，重跑 `oma setup --overlay` 幂等替换，不重复。
OMA 不解析这个文件——你写什么，Agent 就看到什么。

---

### `oma go <stage>` / `oma go loop`

**单阶段直入**：不经过门控，直接进入指定阶段。Agent 会话启动后读取 `.oma/standalone.json`，自动切换为 advisory（建议性）门控模式。

**直接进入迭代环**（`oma go loop`）：豁免 `$requirement` 硬门控，初始化或恢复 `.oma/tracks/{track_id}/loop.json`，从 `$design`/`$implement`/`$train`/`$tune` 之一开始自由迭代。

```bash
oma go requirement          # 进入需求阶段
oma go design               # 进入设计阶段
oma go implement            # 进入实现阶段
oma go train                # 进入训练阶段
oma go tune                 # 进入调优阶段
oma go deploy               # 进入部署阶段
oma go consolidate          # 进入汇总阶段

oma go loop                                    # 免需求，进入迭代环（默认 $design）
oma go loop --stage implement --reason "修 reward hacking"
oma go train --reason "从已有 checkpoint 继续"  # 附加原因
oma go status               # 查看 standalone / index / track loop 状态
oma go off                  # 关闭 standalone，恢复门控（保留 track loop.json）
```

有效阶段：`requirement` `design` `implement` `train` `tune` `deploy` `consolidate` `loop`

### `oma track`

管理**设计范式级**并行路线（track ≠ reward 调参 lap）。`oma track open` 会创建 `tracks/{id}/` 完整子树（loop、memory、experiments-index、design/、experiments/）。

```bash
oma track open gait-clock --label "步态时钟驱动"
oma track open redirect-data --label "重定向数据训练"
oma track list
oma track switch gait-clock
oma track close minimal-reward --deliverable "exp_A08 deploy"
```

遗留项目若仍有根目录 `config.json` / `loop.json`：`oma doctor --migrate`。

---

### `oma xp` — 项目经验库

经验库存储路径由用户指定，写入 `.oma/index.json` 的 `experiences_dir`（不再使用固定的 `~/.oma/`）。

#### 首次配置

```bash
oma xp init --dir lab/experiences    # 创建目录 + xp-index.json，写入 index.json
```

#### 存储结构

```
{experiences_dir}/
  xp-index.json          ← 轻量索引
  deploy-001.md          ← 每条经验一个 Markdown 文件
  design-001.md
```

**索引与内容分离**：Agent 先读 `xp-index.json`，再按需读 `{id}.md`。

#### 两步工作流（推荐）

**Step 1** — Agent 对话中生成草稿 → `ankle_kd_tuning_experience.md`

**Step 2** — 归档：

```bash
oma xp add --file ankle_kd_tuning_experience.md \
           --name "ankle-kd-tuning" \
           --description "将 ankle kd 从 2.0 降至 0.8 消除 20Hz 颤振" \
           --stage deploy
```

#### 完整命令参考

```bash
oma xp init --dir lab/experiences       # 配置路径（必须，首次）
oma xp add [--dir <path>] ...           # 归档；--dir 可单次覆盖
oma xp index --format md
oma xp show deploy-001
oma xp search "reward hacking" --stage tune
oma xp delete tune-003
oma xp reindex
```

**经验条目字段**（索引中）：`id` / `name` / `stage` / `robot_type` / `task` / `description` / `tags`  
**经验文件完整字段**：以上全部 + `背景` / `核心经验` / `结果` / `来源项目`

**质量原则**：只存已验证的成功路径；`description` 一句话让 Agent 判断相关性，要具体（"将 ankle kd 从 2.0 降至 0.8"，不是"优化了参数"）；`outcome` 优先量化；`tags` 必含机器人类型和任务类型。

---

### `oma doctor`

检查项目健康状态：阶段文件完整性、门控条件、上下文可用性。

```bash
oma doctor
```

示例输出：
```
✓ .oma directory exists
✓ config.json found
⚠ Standalone mode: ACTIVE (stage=train, entered 2h ago)
✗ design.md missing — train gate requires design document
  Hint: Or run `oma go train` to enter directly (bypass gate)
```

---

### `oma status`

显示当前项目状态概览。

```bash
oma status
```

---

### `oma log`

查看阶段推进历史记录。

```bash
oma log
oma log --stage train       # 过滤特定阶段
```

---

### `oma extract`

从 Agent 对话中提取结构化输出并写入 `.oma/` 状态文件。

```bash
oma extract
```

---

### `oma index` — 按 track 登记本地代码路径

将**本地代码目录**绑定到某个 design track。并行路线可维护两套代码，共用 `.oma/codebase/`，按 track 区分 `srcPath`。

```bash
oma index --list
oma index --src ./legged_gym_gait --track gait-clock
oma index --src ./legged_gym_minimal --track minimal-reward
oma index --src ./legged_gym --track gait-clock --force   # 覆盖该 track 映射
```

- `--track` 省略时，使用 `index.json` 的 `default_track`
- `$design` / `$implement` 读取**当前 track** 的 `tracks[track_id].srcPath`
- 旧版单路径项目：顶层 `srcPath` 仍可作为 fallback

生成 `.oma/codebase/config.json`：

```json
{
  "schema_version": "2.0",
  "tracks": {
    "gait-clock": {
      "srcPath": "/abs/path/legged_gym_gait",
      "primaryLang": "Python",
      "registeredAt": "2026-07-01T..."
    },
    "minimal-reward": {
      "srcPath": "/abs/path/legged_gym_minimal",
      "primaryLang": "Python",
      "registeredAt": "2026-07-01T..."
    }
  }
}
```

典型流程：

```bash
oma track open gait-clock --label "步态时钟"
oma index --src ./legged_gym_gait --track gait-clock
oma track open minimal-reward --label "极简奖励"
oma index --src ./legged_gym_minimal --track minimal-reward
oma track list    # 查看各 track 的 codebase 列
```

---

### `oma search <query>`

在已注册的代码库中搜索相关实现。

```bash
oma search "reward function"
oma search "observation space"
```

---

## 开发生命周期详解

### 门控与迭代环总览

| 过渡 | 门控 | 类型 |
|------|------|------|
| → 进入环（`$design`/`$implement`/`$train`/`$tune`） | `requirements.md` LOCKED | **硬** |
| 环内任意跳转 | 无 | 软（建议性） |
| 环 → `$deploy` | `best.json` `deployGateOpen === true` | **硬** |

**一圈（lap）≈ 一个 `exp_id`**。首圈通常产出完整 `design-{id}.md`；后续圈多为 **delta**——只记 `experiment.json` 的 `hypothesis` + `change`（`archive_level: light`）。重大变更（奖励重设计、架构替换）才升格为完整设计文档（`archive_level: full`）。

**每圈收尾**：`$train` → `experiment-analysis` → 人工确认 → `experiment-recording` → 下一圈。Agent 应在每圈结束时主动提议归档，避免未记录的 lap 丢失经验。

#### `.oma/index.json` — 项目仪表盘

顶层路由：`meta` 含项目配置（指标、机器人、Gradmotion 等）；`active_tracks` / `closed_tracks` 登记设计范式级路线；环状态在 `tracks/{id}/loop.json`。通过 `oma track` 维护，不要手改。

#### `.oma/tracks/{track_id}/loop.json` — 环状态指针（per track）

跨会话恢复时，Agent 读 `index.default_track`，再读该 track 的 loop 定位「在第几圈、哪个阶段、当前实验 ID」：

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

- **Track** = 设计范式级路线（重定向数据 / 步态时钟 / 最小 reward 等），用 `oma track open` 创建
- **Lap** = 同一 track 内的迭代圈

- **新圈**：`$train`/`$tune` 收尾后带着新改动进入 `$design`/`$implement` 时，`lap`+1 并分配新 `exp_id`
- **同圈内跳转**：仅更新 `stage` / `updated_at`
- **`oma status`** / **`oma doctor`** 会显示当前 lap 与环内阶段

---

### 各阶段说明

```
┌──────────────┐
│  requirement │  机器人平台参数、任务/环境定义 → requirements.md + knowledge.md (LOCKED)
└──────┬───────┘
       │ 硬门控（进环）
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  迭代环:  design ↔ implement ↔ train ↔ tune  （可任意方向回跳）    │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 硬门控（出环: deployGateOpen）
                               ▼
┌──────────────┐
│    deploy    │  Sim2Real 8 类验证 → 真机 → design-feedback 再进环
└──────────────┘
```

### Requirement — 需求阶段

Skill 引导完成：
- 任务描述（locomotion / manipulation / navigation）
- 机器人平台参数（必填）：`robot_model`、`DoF`、`sim_env`、`control_hz`、`obs_dim`、`action_dim`
- Domain Randomization 风险点识别
- 约束条件与成功指标

**门控输出**：`.oma/requirement/requirements.md`、`.oma/requirement/knowledge.md`（LOCKED）

---

### Design — 设计阶段

Skill 生成完整的 RL 算法规格：

- **策略网络**：架构类型、输入维度、输出维度（= DoF）、激活函数、动作缩放
- **价值网络**：独立规格
- **奖励函数**：每个奖励项必须包含公式 + 系数 + 目的 + 奖励黑洞风险
- **观测空间**：标准本体感知模板（关节位置/速度、IMU、速度指令、上一步动作）
- **动作空间**：PD 控制 Kp/Kd 规格
- **Domain Randomization**：Kp/Kd/质量/摩擦/延迟/噪声参数范围表
- **训练课程**：阶段划分与切换条件
- **RL 算法**：PPO/SAC 具体超参（clip_range、tau 等）
- **消融实验计划**：最少 5 个变量

**门控输出**：首圈 `.oma/tracks/{track_id}/design/design-{id}.md`；后续 delta 圈写入该 lap 的 `experiment.json`

---

### Implement — 实现阶段

**Phase 0（必须执行）**：Skill 首先询问：

> "实现阶段开始。请问你是否有可以参考或复用的开源代码库？"
> - **有** → Path A：在其基础上改造（`oma index --src <path> --track <track-id>`）
> - **没有** → Path B：按设计文档从零实现

| 用户回答 | 路径 | 操作 |
|---------|------|------|
| 提供本地路径 | Path A | 若该 track 未登记，提示 `oma index --src <path> --track <track-id>` |
| 提供 Git 地址 | Path A | 先 clone 再 index |
| config.json 已存在 | Path A | 告知使用已注册路径 |
| 明确说"没有" | Path B | 即使 config.json 存在也走 Path B |

**门控输出**：`.oma/impl/impl-checklist.md`、`.oma/impl/github.json`、代码仓库

---

### Train — 训练阶段（Gradmotion 集成）

Skill 内置 Gradmotion (gm) 平台操作规范：

**训练任务配置**（`create-train.json`）：
```json
{
  "taskName": "your-task-name",
  "image": "registry.cn-hangzhou.aliyuncs.com/...:isaac-gym-preview-4",
  "goodsId": "<A10-GPU-goodsId>",
  "startScript": "gm-run your_project/scripts/train.py --task=your_task --headless --max_iterations=500",
  "codeType": 2,
  "repoUrl": "https://github.com/your-org/your-repo.git"
}
```

**关键规范**：
- 镜像：固定使用 **Isaac GYM preview-4** 官方镜像
- 算力：`goodsName == "1*A10*24G"` 的 goodsId
- 执行命令：`gm-run`（平台专用，相当于 python）**不需要** cd 到项目目录
- 创建方式：始终 `gm task create --file ./create-train.json`

**RL 失效模式分类与处置**：

| 失效模式 | 症状 | 处置方向 |
|---------|------|---------|
| `nan_explosion` | loss/reward 出现 NaN | 观测归一化 → 奖励缩放 → 动作缩放 → 梯度裁剪 → 物理 dt |
| `reward_hacking` | reward 高但行为异常 | 打印轨迹找漏洞 → 修奖励设计（不是学习率问题）|
| `exploration_collapse` | entropy 迅速降到零 | 熵系数 → 初始 std → reset 随机化 → 课程设置 |
| `no_learning` | reward 始终接近零 | 验证奖励非零 → obs 含速度指令 → episode 长度 → 动作裁剪 |

**门控输出**：`.oma/tracks/{track-id}/experiments/{exp-id}/results.json`（`phase: train`）、checkpoint 路径

---

### Tune — 调优阶段

超参数调优与消融实验：
- 基于 design.md 中的消融计划执行
- 每次实验记录超参变化 + 结果
- 识别关键敏感超参

**门控输出**：`tracks/{track-id}/experiments-index.json`、`.oma/best.json`（含 `deployGateOpen`）

---

### Deploy — 部署阶段（Sim2Real）

内置 8 类 Sim2Real 验证测试，每类包含 `measure.py` + `analyze.py`：

| # | 类别 | 核心指标 |
|---|------|---------|
| 01 | 延迟特性 | 推理延迟 p50/p95/p99，sim gap 分析 |
| 02 | 电机特性 | 阶跃响应，Kp/Kd 偏差（曲线拟合）|
| 03 | 传感器噪声 | IMU/编码器静止噪声 std vs sim 设定 |
| 04 | 稳定性 | 静态站立、扰动恢复，跌倒率 |
| 05 | 步态质量 | 步频、占空比、对称性 CV |
| 06 | 速度跟踪 | 跟踪误差、振荡频率、最大稳定速度 |
| 07 | 扰动鲁棒性 | 侧推/正推/载荷/坡道，按类型跌倒率 |
| 08 | 地形适应 | 平地/坡面/台阶/非结构地形通过率 |

测试模板位于 `templates/deploy-tests/`，配置参考 `templates/deploy-config.json`。

---

## 项目文件结构

```
your-robot-project/
├── AGENTS.md                  # Agent 主提示词（OMA 核心，oma setup 生成；Cursor 等平台有对应落点）
│
├── .oma/                      # OMA 状态目录（由 oma setup 创建，gitignore 覆盖工具文件）
│   ├── index.json             # 项目仪表盘（meta 配置 + active/closed tracks）
│   ├── requirement/           # 进环硬门控区（$requirement）
│   │   ├── requirements.md    # LOCKED 后进环
│   │   ├── knowledge.md
│   │   └── paper/             # oma extract / oma search
│   ├── codebase/              # 按 track 映射本地代码路径（oma index）
│   │   └── config.json        # tracks.{track_id}.srcPath
│   ├── tracks/                # 一个 track = 一个设计范式单元
│   │   └── {track-id}/
│   │       ├── loop.json
│   │       ├── memory.md
│   │       ├── experiments-index.json   # lap 汇总 + 调参排名
│   │       ├── design/
│   │       │   └── design-{id}.md
│   │       └── experiments/
│   │           └── exp-{id}/
│   │               ├── experiment.json
│   │               └── results.json     # running → completed/failed（含 gm_task_id）
│   ├── impl/                  # 项目级代码仓库信息（多 track 常共用）
│   ├── best.json              # 出环门控：测试集终评 + deployGateOpen
│   ├── standalone.json        # Standalone 模式状态（oma go / oma go loop 写入）
│   # index.json.experiences_dir → 经验库路径（oma xp init --dir 配置，可在项目外）
│   │
│   └── templates/             # 流程模板（oma setup 安装到 .oma/templates/）
│
├── .cursor/skills/            # Cursor：oma setup -p cursor 注入（核心 + 可选 reference）
├── .codex/skills/             # Codex：oma setup 注入（默认平台）
│
└── [你的机器人代码]            # 项目根或子目录；路径由 codebase/config.json 按 track 指向

# 两条路线、两套本地代码示例：
#   ./legged_gym_gait/      → track gait-clock
#   ./legged_gym_minimal/   → track minimal-reward

{experiences_dir}/             # 用户配置的经验库（index.json experiences_dir，可项目内/外）
  xp-index.json
  deploy-001.md
  design-001.md
```

---

## 关于 Agent 提示词（AGENTS.md 等）

`AGENTS.md` 是 OMA 在 Codex / meta-agent 等平台上的核心路由文件；Cursor 对应 `.cursor/rules/oma-core.mdc`，Claude Code 对应 `CLAUDE.md`。各平台 Agent 在会话启动时读取对应文件，内容包括：

- **启动协议**：检查 standalone / `index.json` + 默认 track 的 `loop.json`、加载 `memory.md` 与上下文
- **门控链**：两个硬门控 + 环内四阶段自由迭代；`oma go loop` 免需求进环说明
- **机器人 RL 操作原则**：
  - Sim2Real gap 是部署的首要风险
  - 奖励黑洞是行为崩塌的根因
  - 控制频率 (`control_hz`) 决定推理延迟预算
  - 所有设计决策必须有 Sim2Real 理由
- **关键词检测**：识别 PPO/SAC/sim2real/reward/gm/gradmotion 相关上下文
- **平台规范**：Gradmotion gm CLI 操作规范

---

## Gradmotion 快速参考

```bash
# 查询可用算力（找 A10）
gm goods list

# 查询可用镜像（找 isaac-gym-preview-4）
gm image official list
gm image versions --image <image-id>

# 创建训练任务
gm task create --file ./create-train.json

# 查看任务状态
gm task list
gm task log --task <task-id>

# 删除任务
gm task delete --task <task-id>
```

---

## 设计哲学

**为什么不用 Python？**
OMA CLI 使用纯 Node.js 内置模块（fs、path、readline），零 npm 依赖，`npm install -g .` 即可全局使用，无需虚拟环境、无版本冲突。

**为什么是 Agent 编排层，而不是自建 Agent？**
现代 Agent（Codex、Cursor、Claude Code 等）已经解决了工具调用、代码执行、文件编辑的基础设施问题。OMA 不重复造轮子，只提供高质量的领域知识（路由提示词 + 阶段 skill），让任意 Agent 在正确的上下文中做出正确决策。工作流在 Codex 上首发验证，但协议与 CLI 与具体 Agent 实现解耦。

**为什么每个阶段要写文件？**
`.oma/*.md` 文件是跨 Agent 会话的状态记忆。Agent 无法可靠记住上次对话，但可以读取文件。OMA 把"记忆"外化为结构化文档，让每次新会话都有完整上下文。

**为什么经验库路径由用户指定？**
不同团队/项目可把经验放在共享目录、monorepo 子路径或独立 lab 仓库。路径写入 `index.json` 的 `experiences_dir`，Agent 与 CLI 统一 follow；需要时可 `--dir` 单次覆盖。

**为什么经验库索引与内容分离？**
`xp-index.json` 只存 name + description + tags，让 Agent 能用极低成本扫描"有哪些经验"，再决定是否读具体 `.md` 文件的完整内容。随着经验库增长，这个设计让查阅成本保持稳定，不随条目数量线性增长。

---

## 贡献

欢迎 PR 和 Issue。主要贡献方向：

- 新的 deploy 测试类别
- 更多机器人平台的 skill 适配（手臂/无人机/轮式）
- oma CLI 新命令
- AGENTS.md / skill 提示词优化

---

## License

MIT © 2025 oh-my-algorithm contributors
