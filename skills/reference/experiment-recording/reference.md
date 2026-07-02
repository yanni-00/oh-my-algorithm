# 实验记录参考

## Campaign 匹配（优先级）

通过 `experiments/{robot}/index.json` → `summary` + `training_lines` 定位当前训练线；深读文档见 `guides` / `index_path`；全量 exp 卡片在 `experiments_index.json`。

1. `parent_exp` 属于某 campaign → 继承同一 campaign
2. 变更直接针对 campaign `problem` → 归入该 campaign
3. 变更由 campaign `spawned_problem` 触发 → 归入下一 campaign
4. exp 编号落在 campaign `date_range` → 归入该 campaign
5. 无法匹配 → 可能新建 campaign

## 更新 Campaign JSON

实验归入某 campaign 后，按需更新：

**timeline 条目**
```json
{
  "phase": "本阶段简短标签",
  "experiments": ["exp_XXX"],
  "what_tried": "具体改了什么",
  "result": "关键结果",
  "verdict": "success / partial / failed / pending",
  "key_finding": "一句话洞察"
}
```
- 同一尝试方向 → 合并进已有 phase 的 `experiments`
- 新方向 → 新建 phase

**其他字段**
- `date_range`：`"exp_XXX ~ exp_YYY"`
- `status`：active | resolved | partially_resolved | abandoned
- `exhausted_directions`：已证伪方向，前缀 ❌
- `surviving_directions`：已验证方向，前缀 ✅
- `spawned_problem` / `handed_off_to`：交接下一 campaign
- `key_checkpoint`：后续续训的黄金基线 exp_id

## 新建 Campaign

无现有 campaign 可归属时：
- 文件名：`C0N_brief_title.json`（**N 在本 `training_line` 内递增**，从 C01 起）
- `campaign_id` 与文件名一致；`training_line` 必填
- `status: "active"`，timeline 含首个 phase
- 更新上一 campaign 的 `spawned_problem` 与 `handed_off_to`

## F1 sim_running campaigns（参考快照）

| ID | 标题 | 范围 | 状态 |
|----|------|------|------|
| C01 | 速度突破与基线建立 | 001~004 | resolved |
| C02 | 上半身扭转修复 | 005~018 | partially_resolved |
| C03 | Reward公式改革 | 019~028 | resolved |
| C04 | 结构补丁与数据Bug发现 | 029~033 | resolved |
| C05 | 镜像对称落地 + 手臂Saga | 034~042 | active |

务必读取磁盘上的 campaign JSON — **不要只依赖本表**。

## Lesson

**流程真源**：`shared/lessons_learned/LESSONS_LIFECYCLE.md`（新增 §1 / 修订 §2 / 作废 §3）。本节只写**是否提取**；具体步骤不重复，执行时读 LIFECYCLE 对应节。

### 何时提取（新增或修订）

Campaign 闭环时，或单次实验强失败时。

对 `exhausted_directions` / `surviving_directions` 逐条判断，**满足任一**则提取或修订已有 lesson：

| 条件 | 示例 |
|------|------|
| 很可能再犯 | 半修比不修更差 |
| 排查成本高 | ≥2 个 exp 才定位根因 |
| 与直觉相反 | 增大 kp 反而加重外翻 |
| 可跨机器人迁移 | policy 固化不可逆 |

**不提取**：单一超参取值、一次性噪声、显而易见结论。

### 路径选择

| 判断 | 动作 |
|------|------|
| 尚无对应 lesson，结论值得复用 | **新增** → LIFECYCLE §1 |
| 已有 lesson，补充/改 confidence/改 summary，叙事未分裂 | **修订** → LIFECYCLE §2（勿为小幅修订另起新文件名） |
| 原 lesson 被反证 | **作废** → LIFECYCLE §3 |
| 试过即错、仅 campaign 叙事需要 | `campaign.invalidated_findings`，不必单独 lesson |

### confidence（entries 仅两种）

- `validated`：≥2 个 exp 或 align 复现
- `directional_only`：方向可信；定量或场景受限 — 填 `era` / `caveat`

示例（validated）：`shared/lessons_learned/training_dynamics/npz_isaac_dof_index_mismatch.md`

## lineage.json 要点（full 归档）

除 experiment.json 外必填：
- `what_changed_from_parent`
- `hypothesis_vs_reality`
- `key_insight`、`root_cause`
- `lessons_learned`（≥1 条）
- 可选 `result_comparison` 对比其他 exp

## X1 sim_walking · deploy_trace

**真源**：`sim_walking/shared/ARCHIVE_TIERS.md`；工序 → `ROUTER.md` §8。

| deploy_trace | experiment.json | 目录 |
|--------------|-----------------|------|
| `none` | 可选省略（默认 none） | 通常仅 experiment.json |
| `l2` | 必填 | walk_diag；无 data_index |
| `real` | 必填 + 建议 `deploy_baseline` | data_index.md（引 test_logs） |

`data_index.md` 最少：L1/L2 路径、真机 round 的 **test_logs 完整路径**、相对 exp_010 验收、I0x 链接（若开调查）。

真机 round CSV **只**进 `deploy/F1/test_logs/`；exp 目录不拷贝副本。

## notes.md 模板（full 归档）

```markdown
# exp_XXX 实验笔记

## 训练过程观察
## 关键事件
## 根因分析
## 待跟进方向
```
