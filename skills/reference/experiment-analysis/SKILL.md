---
name: experiment-analysis
description: 分析 F1-29DOF 与 X1-12DOF 实验 CSV 数据（单实验或多实验对比）。输出基座位姿、腿部幅值/对称性、跟踪误差、腰与臂指标。用户要求对比实验、分析 exp CSV/joints、检查腿部对称性、偏航漂移，或提及 /compare 时使用。
---

# 实验数据分析

分析 `locomotion-lab/experiments/` 下的 CSV 数据。支持单实验画像与多实验对比。

## 模式

| 模式 | 示例 |
|------|------|
| 单实验 | 「分析 exp_043」 |
| 多实验 | 「对比 exp_034 exp_041 exp_043」 |
| 聚焦 | 「对比 exp_043，重点看腿部对称性」 |

只输出客观指标与有数据支撑的解读。机制推断、规划下一 exp 须在用户确认后进行。

## 步骤 1：解析请求

提取：
- `exp_id` 列表（1 个或多个）
- 从路径判断机器人系列（`F1-29DOF` 或 `X1-12DOF`）
- 可选聚焦维度：对称性、跟踪、偏航、上半身、手臂

若 CSV 来源不明确（X1 训练 vs 部署），先询问再跑脚本。

## 步骤 2：定位 CSV

| 系列 | 路径 | 文件模式 | 脚本 |
|------|------|----------|------|
| F1-29DOF | `locomotion-lab/experiments/F1-29DOF/sim_running/<exp_id>/` | `*_joints.csv` | `compare_csv.py` |
| X1 部署 | `locomotion-lab/experiments/X1-12DOF/sim_walking/<exp_id>/` | `walk_diag*.csv` | `compare_walk_diag.py` |
| X1 训练 | 同上 | `*_joints.csv`、`YYYYMMDD_*_joints.csv` | `compare_train_joints.py` |

- 同一 exp 多个 CSV → 询问用户或取最新
- X1 有两类 CSV、列不同 — **必须按来源选脚本**
- X1 训练 CSV 可能有 legacy `lumbar_*` 表头；脚本按列位置重映射

## 步骤 3：运行脚本

**F1-29DOF**
```bash
python locomotion-lab/experiments/F1-29DOF/analysis_scripts/compare_csv.py \
  --csv <path1> [<path2> ...] [--labels label1 label2 ...]
```

**X1 部署**
```bash
python locomotion-lab/experiments/X1-12DOF/analysis_scripts/compare_walk_diag.py \
  --csv <path1> [<path2> ...] [--labels ...] [--out-dir <dir>]
```

**X1 训练**
```bash
python locomotion-lab/experiments/X1-12DOF/analysis_scripts/compare_train_joints.py \
  --csv <path1> [<path2> ...] [--labels ...] [--dt 0.01] [--out-dir <dir>]
```

省略 `--labels` → 脚本用父目录名作标签（如 `exp_017`）。

## 步骤 4：解读输出

先完整打印表格。若用户指定聚焦维度，仅对该维度加深评述。

各系列关键指标见 [reference.md](reference.md)。

## 步骤 5：对称性（关键）

**禁止仅凭 R/L 比值或综合对称分数下结论。**

1. 先看弱侧绝对 std（多为左腿）
2. 弱侧已激活后，再看 R/L 比值
3. 「弱侧在动但不对称」>> 「弱侧冻结造成的假对称」

阈值与 exp_033 vs exp_034 示例 → [reference.md](reference.md)。

## 步骤 6：对照 visual_obs.md

若 exp 目录存在 `visual_obs.md`：
- CSV = 定量
- visual_obs = 定性
- 冲突时以视觉观察为准（如比值看似对称但左腿几乎不动）

## 关节符号约定（F1-29DOF）

解读 F1 关节角前必读：
`locomotion-lab/shared/robot_conventions/F1_29DOF_joint_sign_convention.md`

未应用 L/R 符号规则前不要比较左右幅值（如 hip_pitch：L+ = 前摆，R+ = 后蹬）。

## 经验库（可选对照）

按 `tags` / `applicable_robots` 筛选 `locomotion-lab/lessons_index.json` → **`entries`**。  
不要用 `_archive/` 或 `invalidated_index.json` 作解读依据。  
`directional_only` 条目：遵守 `era` 与 `caveat`。

## 约束

- 多实验对比：仅同系列、同 CSV 类型
- 行数差异大 → 注明时长偏差
- X1 部署：`heading_drift` 为 sim2real 主信号（>15° = 严重）
- X1 训练：无 `pos_des_raw`；用幅值、偏航、踝振动等代理指标

## 脚本生命周期（探索 + 晋升）

新建分析脚本的默认策略：

1. **探索优先（默认）**  
   - 首次诊断脚本视为一次性。  
   - 放在当前 exp 目录下（不进 `analysis_scripts/`）。  
   - 结论写入 `notes.md` / `lineage.json` 后删除脚本。  
   - **删脚本前**在 `notes.md` 留一行留痕（见下）。

2. **复用触发晋升（第二次使用）**  
   满足以下任一才迁入 `analysis_scripts/`：  
   - 另一 exp/campaign 需要同类分析，或  
   - 用户明确要求保留为可复用工具。

3. **晋升要求**  
   - 使用 CLI 参数（`argparse`），禁止硬编码路径。  
   - 通用命名（禁止 `tmp_*`、禁止 exp 专用文件名）。  
   - 在脚本头/docstring 写用法示例。  
   - 若成为推荐工具，更新本 skill（及/或 `reference.md`）。  
   - 晋升后删除各 exp `notes.md` 中对应「未晋升」留痕，改链到 `analysis_scripts/` 路径。

4. **防膨胀规则**  
   - 新建前先尝试扩展现有工具（`compare_csv.py`、`compare_walk_diag.py`、`compare_train_joints.py`）。  
   - 禁止在 `analysis_scripts/` 堆积一次性脚本。

### 留痕（删一次性脚本前必写）

在当次 exp 的 `notes.md` 增加固定小节：

```markdown
## 分析留痕（未晋升）
- `<分析名>`：<一句话做了什么>；一次性脚本已删
```

示例：`- hip_yaw_ankle_roll_coupling：同侧 hip_yaw↔ankle_roll 耦合；一次性脚本已删`

### 如何判定「第二次」（删脚本后无文件状态，靠请求时检索）

按序检查，**命中即晋升，不再写一次性脚本**：

| 步 | 检查 | 命中 → |
|----|------|--------|
| ① | `analysis_scripts/` 是否已有同类工具 | 直接用，不新建 |
| ② | 当前请求是否要对**另一 exp**做**同类**分析 | 晋升 |
| ③ | grep `分析留痕（未晋升）` 或相关 campaign/notes 是否写过同类结论 | 晋升 |
| ④ | 用户明确要求保留为工具 | 晋升 |
| ⑤ | 以上皆否 | exp 目录下一次性探索 |

```
新需求 → analysis_scripts 能覆盖？ → 是：直接用
                              → 否：跨 exp 再要 / 留痕命中 / 用户要保留？ → 是：晋升进 analysis_scripts/
                                                              → 否：exp 下一次性 + 留痕
```

## 脚本路径

- F1 CSV 对比：`locomotion-lab/experiments/F1-29DOF/analysis_scripts/compare_csv.py`
- F1 CSV 单文件：`locomotion-lab/experiments/F1-29DOF/analysis_scripts/describe_csv.py`
- F1 NPZ 检查：`locomotion-lab/experiments/F1-29DOF/analysis_scripts/inspect_npz.py`（`--npz`）
- F1 NPZ 对称：`locomotion-lab/experiments/F1-29DOF/analysis_scripts/check_npz_symmetry.py`（`--npz`）
- X1 部署：`locomotion-lab/experiments/X1-12DOF/analysis_scripts/compare_walk_diag.py`
- X1 训练：`locomotion-lab/experiments/X1-12DOF/analysis_scripts/compare_train_joints.py`
- X1 训练诊断：`locomotion-lab/experiments/X1-12DOF/analysis_scripts/diagnosis_train_joints.py`
- X1 sim2real T_M obs：`locomotion-lab/experiments/X1-12DOF/analysis_scripts/sim2real/compare_tm_obs_sim.py`
- X1 sim2real ONNX 回放：`locomotion-lab/experiments/X1-12DOF/analysis_scripts/sim2real/replay_onnx_tm_obs.py`
- X1 PT→ONNX 导出：`sim-train/X1-12DOF/scripts/export_pt_to_onnx.py`
- X1 真机 walk_diag 图：`locomotion-lab/experiments/X1-12DOF/real_walking_0.6/shared/tools/diagnosis.py`
