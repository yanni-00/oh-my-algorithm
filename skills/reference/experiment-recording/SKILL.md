---
name: experiment-recording
description: 训练后将实验结果写入 locomotion-lab（分级归档、index.json、campaign、经验库）。仅用于用户明确要求记录/归档或训练完成后；不用于仅准备训练代码。
---

# 实验记录

只写入 `locomotion-lab/`，**不要**写在 `sim-train/` 下。

## 触发

示例：
- 「记录 exp_065 的实验结果」
- 「/update-lab F1-29DOF/sim_running/exp_033」

信息不足时逐步询问（不要猜测）：
- checkpoint 范围（起点 → 终点）
- 续训还是从零
- `key_params` 变更
- 结果（速度、现象、成功/失败）
- 若失败：根因

## 步骤 1：加载上下文

1. 读 `locomotion-lab/index.json`（全局状态、`active_work.robot_index` / `training_line`）
2. 读训练线入口：`experiments/[robot]/index.json` → `summary` + `training_lines.[line]`；深读按 `guides` / `index_path`
3. 目标目录：`locomotion-lab/experiments/[robot]/[task]/[exp_id]/`

## 步骤 2：选择归档级别

| 级别 | 何时 | 文件 |
|------|------|------|
| **light** | 仅数值调参（σ、scale、penalty、迭代数） | 仅 `experiment.json` |
| **full** | 增删 reward、数据层、公式/逻辑变更、重大 bug、转折点 | `experiment.json` + `lineage.json` + `notes.md` |
| **index_only** | 仅占位：待训或尚未正式归档 | 可无 lab 文件 |

**禁止**使用其他标签。

示例：light → exp_030、exp_033；full → exp_025、exp_029、exp_032

### deploy_trace（仅 X1 `sim_walking`）

与 `archive_level` **独立**；细则 → `sim_walking/shared/ARCHIVE_TIERS.md`。

| 值 | 何时 | 磁盘追加 |
|----|------|----------|
| `none` | 仅仿真消融/对比 | 无 |
| `l2` | deploy walk_diag 验收，未上机 | `walk_diag*.csv` |
| `real` | 上真机 round 后 | **`data_index.md`**（引 `deploy/F1/test_logs/`） |

写入 `experiment.json` 可选字段 `deploy_trace`；`experiments_index.json` 卡片同步。

## 步骤 3：写入文件

### light — experiment.json

```json
{
  "exp_id": "...",
  "parent_exp": "...",
  "change": "...",
  "hypothesis": "...",
  "result": { "关键指标": "值", "video_observation": "..." },
  "conclusion": "...",
  "next_exp": "..."
}
```

### full — 三件套

格式见 `.cursor/rules/locomotion-lab.mdc` §B。参考示例：
- light：`experiments/F1-29DOF/sim_running/exp_032/experiment.json`
- full：`experiments/F1-29DOF/sim_running/exp_029/`

### X1 sim_walking · 真机 session 后追加

`deploy_trace=real` 时，在步骤 3–4 之间或同步完成：

| # | 动作 | 位置 |
|---|------|------|
| 1 | 原始 log 落盘（全量） | `deploy/F1/test_logs/YYYYMMDD/` |
| 2 | 数据地图：每条 round 的 **完整 test_logs 路径** + 部署配置 + 验收 | `exp_XXX/data_index.md` |
| 3 | `deploy_trace: "real"`；可选 `deploy_baseline` | `experiment.json` |
| 4 | round 现象、验收 verdict | `notes.md`（full 时） |
| 5 | 卡片同步 `deploy_trace` | `experiments_index.json` |
| 6 | 跨 exp 深调查 | `sim2real/investigations/I0x/`（链自 data_index） |

工序总览 → `locomotion-lab/ROUTER.md` §8。

## 步骤 4：更新索引

**robot 索引**（两文件分工）：
- `experiments/[robot]/index.json`：`summary`、`training_lines`（阶段、campaign、交付）
- `experiments/[robot]/experiments_index.json`：新增/更新 exp 卡片 → `archive_level`、`deploy_trace`（X1 sim_walking）、`parent_id`、`children`、`status`、`key_metric`、`conclusion_summary`、`tags`

**顶层** `locomotion-lab/index.json`：
- 更新 `active_work.current_status`、`next_milestone`
- 新唯一 `exp_id` 入库时：`meta.total_experiments` += 1
- `last_updated`

## 步骤 5：parent / children

**只有真正的续训（加载他人 checkpoint）才建立父子链。**

| 情况 | parent_exp | 更新父实验 children？ |
|------|------------|----------------------|
| 从 checkpoint 续训 | 父 exp_id | 是 |
| 从零训练 | null | 否 |
| 代码复制 + 从零 | null | 否（在 experiment.json 用 `key_params.base` 说明） |

口诀：是否加载了他人的 `.pth`？是 → 建 parent；否 → null。

## 步骤 6：维护 Campaign

若实验属于某 campaign，更新对应 campaign JSON。完整规则 → [reference.md](reference.md)。

Campaign 路径：
- F1：`locomotion-lab/experiments/F1-29DOF/sim_running/campaigns/`
- X1：`locomotion-lab/experiments/X1-12DOF/sim_walking/campaigns/`

## 步骤 7：Lesson（触发时）

**真源（三条路径）**：`locomotion-lab/shared/lessons_learned/LESSONS_LIFECYCLE.md` — 执行前**必读**对应章节，勿凭记忆写。

| 情形 | 路径 | 读 |
|------|------|-----|
| 新结论值得复用 | **新增** | LIFECYCLE §1 |
| 已有 lesson 需改措辞/置信度/补充证据（未作废） | **修订** | LIFECYCLE §2 |
| 结论被反证 | **作废** | LIFECYCLE §3 |
| 仅探索史、不必单独 lesson | campaign `invalidated_findings` | LIFECYCLE 开篇分支图 |

**触发**（是否提取 → [reference.md](reference.md) §Lesson 何时提取）：
- Campaign 闭环（`resolved` / `abandoned` / `partially_resolved`）
- 单次实验强负结果

**收尾（三条路径共通）**：跑 `python locomotion-lab/scripts/validate_lessons_index.py`。

`entries` 仅允许 `validated` | `directional_only`；**禁止**在 index 写 `invalidated`。

## 步骤 8：确认

列出所有新建/更新的路径，并摘要索引新增条目。

## 禁止

- 把 `experiment.json` / `lineage.json` / `notes.md` 放在 `sim-train/` 下
- 信息不足时猜测 `archive_level` 或 parent 关系 — 必须询问
- 真机 session 仅有 test_logs、未写 `data_index.md` — 视为归档未完成
