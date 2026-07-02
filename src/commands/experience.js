'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { OMA, exists, readJSON } = require('../utils/paths');
const { ensureIndex, writeIndex, readIndex } = require('../utils/oma-index');

// ─── Storage layout (user-provided path) ─────────────────────────────────────
//
//  {experiences_dir}/          ← configured in .oma/index.json or --dir
//    xp-index.json             ← lightweight index
//    deploy-001.md             ← individual experience files
//
//  Configure once:
//    oma xp init --dir shared/lessons/experiences
//
//  Or pass per command:
//    oma xp add --dir shared/lessons/experiences ...
//
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STAGES = ['design', 'tune', 'deploy'];
const XP_INDEX_NAME = 'xp-index.json';

function normalizeDirRef(cwd, dir) {
  const abs = path.resolve(cwd, dir);
  const rel = path.relative(cwd, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  return abs.split(path.sep).join('/');
}

function resolveExperiencesAbs(cwd, dirRef) {
  if (path.isAbsolute(dirRef)) return dirRef;
  return path.resolve(cwd, dirRef);
}

function readConfiguredDir(cwd) {
  const index = readIndex(cwd);
  return index?.experiences_dir || null;
}

function resolveXpStore({ cwd = process.cwd(), dirOverride = null } = {}) {
  const dirRef = dirOverride || readConfiguredDir(cwd);
  if (!dirRef) {
    const err = new Error(
      '经验库路径未配置。请先运行:\n' +
      '  oma xp init --dir <path>          # 写入 .oma/index.json\n' +
      '或在本命令加:\n' +
      '  oma xp <subcmd> --dir <path> ...'
    );
    err.code = 'XP_DIR_MISSING';
    throw err;
  }
  const absDir = resolveExperiencesAbs(cwd, dirRef);
  return {
    cwd,
    dirRef,
    absDir,
    indexPath: path.join(absDir, XP_INDEX_NAME),
    xpFilePath: (id) => path.join(absDir, `${id}.md`),
  };
}

function ensureXpDirs(store) {
  fs.mkdirSync(store.absDir, { recursive: true });
}

function initXpStore(cwd, dir) {
  if (!dir) {
    console.error('用法: oma xp init --dir <path>');
    process.exit(1);
  }
  const dirRef = normalizeDirRef(cwd, dir);
  const store = {
    absDir: resolveExperiencesAbs(cwd, dirRef),
    indexPath: path.join(resolveExperiencesAbs(cwd, dirRef), XP_INDEX_NAME),
  };
  ensureXpDirs(store);
  if (!exists(store.indexPath)) {
    fs.writeFileSync(store.indexPath, '[]\n', 'utf8');
  }

  if (!exists(OMA.dir(cwd))) {
    console.error('.oma/ 不存在 — 请先运行 oma setup');
    process.exit(1);
  }
  const index = ensureIndex(cwd);
  index.experiences_dir = dirRef;
  writeIndex(cwd, index);

  console.log(`\n✅ 经验库已配置`);
  console.log(`   路径 : ${dirRef}`);
  console.log(`   绝对 : ${store.absDir}`);
  console.log(`   索引 : ${store.indexPath}\n`);
}

function exitOnMissingDir(e) {
  if (e.code === 'XP_DIR_MISSING') {
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

// ─── Index helpers ────────────────────────────────────────────────────────────

function loadIndex(store) {
  if (!fs.existsSync(store.indexPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(store.indexPath, 'utf8'));
  } catch {
    return [];
  }
}

function saveIndex(store, index) {
  ensureXpDirs(store);
  fs.writeFileSync(store.indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
}

function generateId(store, stage) {
  const idx = loadIndex(store);
  const count = idx.filter(e => e.stage === stage).length;
  return `${stage}-${String(count + 1).padStart(3, '0')}`;
}

// ─── Experience file format ───────────────────────────────────────────────────
//
// Each experience is a standalone Markdown file.
// Codex can read it directly. Humans can edit it in any editor.

function renderExperienceFile(entry) {
  const tags = (entry.tags || []).map(t => `\`${t}\``).join(' ') || '—';
  return [
    `# [${entry.id}] ${entry.name}`,
    '',
    `**阶段**: ${entry.stage}  `,
    `**机器人**: ${entry.robot_type}  **任务**: ${entry.task}  `,
    `**标签**: ${tags}  `,
    `**添加时间**: ${entry.added_at?.slice(0, 10) || '—'}  `,
    entry.source_project ? `**来源项目**: ${entry.source_project}  ` : null,
    '',
    '## 描述',
    entry.description,
    '',
    '## 背景',
    entry.context || '—',
    '',
    '## 核心经验',
    entry.insight,
    '',
    '## 结果',
    entry.outcome || '—',
    '',
  ].filter(l => l !== null).join('\n');
}

// ─── Prompt helper ────────────────────────────────────────────────────────────

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// ─── Experience file parser ───────────────────────────────────────────────────
//
// Parses a Codex-generated experience draft (before it has an [id]).
// Returns partial fields; missing ones fall back to CLI flags or interactive prompts.
//
// Expected draft format (produced by Codex via `oma xp --generate`):
//
//   # {name}
//   **阶段**: deploy
//   **机器人**: biped   **任务**: locomotion
//   **标签**: ankle, kd, biped
//   **来源项目**: agibot_x1_infer  (optional)
//
//   ## 描述
//   一句话描述，用于索引
//
//   ## 背景
//   ...
//
//   ## 核心经验
//   ...
//
//   ## 结果
//   ...

function parseExperienceFile(content) {
  const result = {};

  // name: first heading, strip any [id] prefix if present
  const h1 = content.match(/^#\s+(?:\[[^\]]+\]\s+)?(.+)$/m);
  if (h1) result.name = h1[1].trim();

  // inline header fields
  const field = (key) => {
    const m = content.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*([^\\n*]+)`, 'm'));
    return m ? m[1].trim() : null;
  };

  const stageRaw = field('阶段');
  if (stageRaw && VALID_STAGES.includes(stageRaw.split(/\s/)[0])) {
    result.stage = stageRaw.split(/\s/)[0];
  }

  const robotRaw = field('机器人');
  if (robotRaw) result.robot_type = robotRaw.split(/\s/)[0];

  const taskRaw = field('任务');
  if (taskRaw) result.task = taskRaw.split(/\s/)[0];

  const tagRaw = field('标签');
  if (tagRaw) {
    // support both backtick list and comma-separated plain text
    const backticks = [...tagRaw.matchAll(/`([^`]+)`/g)].map(m => m[1]);
    result.tags = backticks.length
      ? backticks
      : tagRaw.split(',').map(t => t.trim()).filter(Boolean);
  }

  result.source_project = field('来源项目') || null;

  // section content helpers
  const section = (heading) => {
    const m = content.match(new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`));
    return m ? m[1].trim() : '';
  };

  result.description = section('描述') || '';
  result.context     = section('背景') || '';
  result.insight     = section('核心经验') || '';
  result.outcome     = section('结果') || '';

  return result;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * oma xp add [--file <path>] [--stage <s>] [--name <n>] [--description <d>] [--tag <t>]
 *
 * Two entry modes:
 *
 *   Mode A — File-first (two-step workflow with Codex generation):
 *     oma xp add --file ankle_kd_experience.md --name "ankle-kd-tuning" \
 *                --description "降低 ankle kd 消除颤振" --stage deploy
 *     → Reads content from file, CLI flags override parsed fields.
 *     → Copies file to {experiences_dir}/<id>.md with proper header.
 *     → Original file is left in place (not deleted).
 *
 *   Mode B — Interactive / flag-only (no file):
 *     oma xp add --stage deploy --name "ankle-kd-tuning" --description "..."
 *     → Fills remaining fields interactively.
 *
 * Required fields: name, description, stage (any mode, any source).
 */
async function add({ cwd, dirOverride, filePath: filePathArg, stage, nameCli, descriptionCli, tagsCli } = {}) {
  let store;
  try {
    store = resolveXpStore({ cwd, dirOverride });
  } catch (e) {
    exitOnMissingDir(e);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n📚 OMA 经验库 — 添加新经验\n');

  // ── Load file if provided ────────────────────────────────────────────────────
  let parsed = {};
  if (filePathArg) {
    const absFile = path.resolve(filePathArg);
    if (!fs.existsSync(absFile)) {
      console.error(`文件不存在: ${absFile}`);
      rl.close(); process.exit(1);
    }
    parsed = parseExperienceFile(fs.readFileSync(absFile, 'utf8'));
    console.log(`📄 读取文件: ${absFile}`);
    if (parsed.name)  console.log(`   解析到经验名: ${parsed.name}`);
    if (parsed.stage) console.log(`   解析到阶段  : ${parsed.stage}`);
    console.log('');
  }

  // ── Stage (CLI flag → file → interactive) ───────────────────────────────────
  let stage_ = (stage && VALID_STAGES.includes(stage)) ? stage : (parsed.stage || null);
  if (!stage_) {
    const raw = await ask(rl, `阶段 (${VALID_STAGES.join('/')}): `);
    stage_ = raw.trim();
    if (!VALID_STAGES.includes(stage_)) {
      console.error(`无效阶段: ${stage_}`);
      rl.close(); process.exit(1);
    }
  } else {
    console.log(`阶段: ${stage_}`);
  }

  // ── name (必填: CLI flag → file → interactive loop) ─────────────────────────
  let name = nameCli?.trim() || parsed.name || '';
  if (name) {
    console.log(`经验名: ${name}`);
  } else {
    while (!name) {
      name = (await ask(rl, '经验名 [必填] (kebab-case，如: ankle-kd-tuning): ')).trim();
      if (!name) console.log('  ⚠️  经验名不能为空，请重新输入。');
    }
  }

  // ── Dedup check: name is the primary key ────────────────────────────────────
  //
  // If an experience with the same name already exists, ask the user what to do.
  // Three options (interactive, Codex-friendly single-char answers):
  //   o / overwrite  → delete old file + index entry, proceed with same name
  //   k / keep       → keep both, assign new ID (name will be duplicated in index)
  //   n / cancel     → abort
  //
  // Codex can answer on the user's behalf — the prompt is intentionally simple.

  const existingByName = loadIndex(store).find(e => e.name === name);
  if (existingByName) {
    console.log('');
    console.log(`⚠️  已存在同名经验:`);
    console.log(`   ID    : ${existingByName.id}`);
    console.log(`   阶段  : ${existingByName.stage}`);
    console.log(`   描述  : ${existingByName.description}`);
    console.log(`   标签  : ${(existingByName.tags || []).join(', ') || '—'}`);
    console.log(`   时间  : ${existingByName.added_at?.slice(0, 10) || '—'}`);
    console.log('');

    let dupAnswer = '';
    while (!['o', 'k', 'n'].includes(dupAnswer)) {
      dupAnswer = (await ask(
        rl,
        '选择操作  o=覆盖旧经验  k=保留两者(新建ID)  n=取消: '
      )).trim().toLowerCase();
      if (!['o', 'k', 'n'].includes(dupAnswer)) {
        console.log('  请输入 o、k 或 n');
      }
    }

    if (dupAnswer === 'n') {
      console.log('已取消。');
      rl.close();
      process.exit(0);
    }

    if (dupAnswer === 'o') {
      // Remove old file and index entry
      const oldFile = store.xpFilePath(existingByName.id);
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      const newIndex = loadIndex(store).filter(e => e.id !== existingByName.id);
      saveIndex(store, newIndex);
      console.log(`   已删除旧经验: ${existingByName.id}`);
    }
    // dupAnswer === 'k': fall through, new ID will be assigned below
    console.log('');
  }

  // ── description (必填: CLI flag → file → interactive loop) ──────────────────
  let description = descriptionCli?.trim() || parsed.description || '';
  if (description) {
    console.log(`描述: ${description}`);
  } else {
    while (!description) {
      description = (await ask(rl, '一句话描述 [必填] (显示在索引里，供快速判断相关性): ')).trim();
      if (!description) console.log('  ⚠️  描述不能为空，请重新输入。');
    }
  }

  // ── 其余字段（CLI flag → file → interactive，均可跳过）──────────────────────
  // robot_type
  const robotDefault = parsed.robot_type || '';
  const robotPrompt  = robotDefault
    ? `机器人类型 (已解析: ${robotDefault}，回车确认): `
    : '机器人类型 (biped/quadruped/arm/wheel/other): ';
  const robot_type = ((await ask(rl, robotPrompt)).trim() || robotDefault || 'other');

  // task
  const taskDefault = parsed.task || '';
  const taskPrompt  = taskDefault
    ? `任务类型 (已解析: ${taskDefault}，回车确认): `
    : '任务类型 (locomotion/manipulation/navigation/other): ';
  const task = ((await ask(rl, taskPrompt)).trim() || taskDefault || 'other');

  // context / insight / outcome — use file content if available, still let user edit
  const contextDefault = parsed.context || '';
  const context = filePathArg && contextDefault
    ? contextDefault   // trust the file; don't re-ask
    : (await ask(rl, '背景/场景 (什么情况下发现的): ')).trim() || contextDefault;

  const insightDefault = parsed.insight || '';
  const insight = filePathArg && insightDefault
    ? insightDefault
    : (await ask(rl, '核心经验 (做了什么，为什么有效): ')).trim() || insightDefault;

  const outcomeDefault = parsed.outcome || '';
  const outcome = filePathArg && outcomeDefault
    ? outcomeDefault
    : (await ask(rl, '结果/收益 (量化或描述): ')).trim() || outcomeDefault;

  // tags: CLI flag takes priority, else file, else interactive
  const tagsDefault = parsed.tags?.join(',') || '';
  const effectiveTagsCli = tagsCli || (parsed.tags?.length ? tagsDefault : null);
  const tagPrompt = effectiveTagsCli
    ? `标签 (已解析/预填: ${effectiveTagsCli}，回车确认或覆盖): `
    : '标签 (逗号分隔，如: ankle,kd,biped): ';
  const tags_raw = (await ask(rl, tagPrompt)).trim() || effectiveTagsCli || '';

  const src = parsed.source_project ||
    (await ask(rl, '来源项目 (可选，回车跳过): ')).trim();

  rl.close();

  const tags = tags_raw.split(',').map(t => t.trim()).filter(Boolean);
  const id   = generateId(store, stage_);

  // ── Write experience file ───────────────────────────────────────────────────
  ensureXpDirs(store);
  const destPath = store.xpFilePath(id);
  const now = new Date().toISOString();

  let fileContent;
  if (filePathArg) {
    // Mode A: preserve original file content verbatim — only patch the title line
    // to inject the assigned ID, and add any missing metadata fields.
    let origContent = fs.readFileSync(path.resolve(filePathArg), 'utf8');

    // Update title: "# [old-id] name"  OR  "# name"  →  "# [id] name"
    origContent = origContent.replace(
      /^(#[ \t]+)(?:\[[^\]]+\][ \t]+)?(.+)$/m,
      `$1[${id}] $2`
    );

    // Inject **添加时间** after the **标签** line if not already present
    if (!/\*\*添加时间\*\*/.test(origContent)) {
      origContent = origContent.replace(
        /(\*\*标签\*\*:[^\n]*\n)/,
        `$1**添加时间**: ${now.slice(0, 10)}  \n`
      );
    }

    // Inject **来源项目** after **添加时间** if src was provided and field is missing
    if (src && !/\*\*来源项目\*\*/.test(origContent)) {
      origContent = origContent.replace(
        /(\*\*添加时间\*\*:[^\n]*\n)/,
        `$1**来源项目**: ${src}  \n`
      );
    }

    fileContent = origContent;
    console.log(`\n   原文件保留: ${path.resolve(filePathArg)}`);
    console.log(`   已归档至  : ${destPath}`);
  } else {
    // Mode B: no source file — render from collected fields
    fileContent = renderExperienceFile({
      id, name, stage: stage_, robot_type, task, description, tags,
      context, insight, outcome,
      added_at: now,
      source_project: src || null,
    });
  }

  fs.writeFileSync(destPath, fileContent, 'utf8');

  // ── Update index ─────────────────────────────────────────────────────────────
  const indexEntry = {
    id, name, stage: stage_, robot_type, task, description, tags,
    added_at: now,
    source_project: src || null,
  };
  const index = loadIndex(store);
  index.push(indexEntry);
  saveIndex(store, index);

  console.log(`\n✅ 经验已归档`);
  console.log(`   ID   : ${id}`);
  console.log(`   名称 : ${name}`);
  console.log(`   文件 : ${destPath}`);
  console.log(`   索引 : ${store.indexPath}`);
  console.log(`   库   : ${store.dirRef}\n`);
}

/**
 * oma xp tag <id> <tag1> [tag2 ...]
 * Add tags to an existing experience (updates index + rewrites file header).
 */
function tagCmd({ cwd, dirOverride, id, newTags } = {}) {
  let store;
  try {
    store = resolveXpStore({ cwd, dirOverride });
  } catch (e) {
    exitOnMissingDir(e);
  }

  if (!id || !newTags?.length) {
    console.error('用法: oma xp tag <id> <tag1> [tag2 ...]');
    process.exit(1);
  }

  const index = loadIndex(store);
  const pos = index.findIndex(e => e.id === id);
  if (pos === -1) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }

  const existing = new Set(index[pos].tags || []);
  const added = newTags.map(t => t.trim()).filter(t => t && !existing.has(t));
  if (!added.length) {
    console.log(`[${id}] 标签无变化（都已存在）: ${[...existing].join(', ')}`);
    return;
  }

  added.forEach(t => existing.add(t));
  index[pos].tags = [...existing];
  saveIndex(store, index);

  // Rewrite the experience file to reflect new tags
  const filePath = store.xpFilePath(id);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const tagLine = `**标签**: ${index[pos].tags.map(t => `\`${t}\``).join(' ')}  `;
    content = content.replace(/\*\*标签\*\*:.*/, tagLine);
    fs.writeFileSync(filePath, content, 'utf8');
  }

  console.log(`✅ [${id}] 已添加标签: ${added.join(', ')}`);
  console.log(`   当前全部标签: ${index[pos].tags.join(', ')}`);
}

/**
 * oma xp index [--stage <s>] [--tag <t>] [--format table|md|json]
 *
 * Print xp-index.json in the requested format.
 * This is the primary Codex entry point — lightweight, no file I/O beyond the index.
 *
 * Codex reads this first, then decides which IDs to `show` for full content.
 */
function indexCmd({ cwd, dirOverride, stage, tag, format = 'table' } = {}) {
  let store;
  try {
    store = resolveXpStore({ cwd, dirOverride });
  } catch (e) {
    exitOnMissingDir(e);
  }

  let entries = loadIndex(store);

  if (stage) entries = entries.filter(e => e.stage === stage);
  if (tag)   entries = entries.filter(e => (e.tags || []).includes(tag));

  if (entries.length === 0) {
    if (stage || tag) {
      console.log(`没有符合条件的经验（stage=${stage || '*'}, tag=${tag || '*'}）。`);
    } else {
      console.log('经验库为空。运行 `oma xp init --dir <path>` 配置路径，再 `oma xp add` 添加经验。');
    }
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (format === 'md') {
    const filterStr = [stage && `stage:${stage}`, tag && `tag:${tag}`].filter(Boolean).join(', ');
    console.log(`# OMA Experience Index${filterStr ? ` — ${filterStr}` : ''}`);
    console.log(`_${entries.length} 条经验。读完此表再决定是否 \`oma xp show <id>\` 查看全文。_\n`);
    console.log('| ID | 阶段 | 机器人 | 任务 | 名称 | 描述 | 标签 |');
    console.log('|---|---|---|---|---|---|---|');
    for (const e of entries) {
      const tags = (e.tags || []).join(', ') || '—';
      console.log(`| \`${e.id}\` | ${e.stage} | ${e.robot_type} | ${e.task} | **${e.name}** | ${e.description} | ${tags} |`);
    }
    console.log('');
    return;
  }

  // Terminal table
  const col = (s, n) => String(s ?? '').substring(0, n).padEnd(n);
  console.log('\n' + col('ID', 12) + col('Stage', 8) + col('Robot', 11) + col('Tags', 25) + col('Name', 28) + 'Description');
  console.log('─'.repeat(115));
  for (const e of entries) {
    console.log(
      col(e.id, 12) +
      col(e.stage, 8) +
      col(e.robot_type, 11) +
      col((e.tags || []).join(','), 25) +
      col(e.name, 28) +
      (e.description || '').substring(0, 40)
    );
  }
  console.log(`\n共 ${entries.length} 条。运行 \`oma xp show <id>\` 查看完整经验文件。\n`);
}

/**
 * oma xp show <id>
 * Print the full Markdown experience file to stdout.
 * Codex reads this after scanning the index and deciding the entry is relevant.
 */
function show({ cwd, dirOverride, id } = {}) {
  let store;
  try {
    store = resolveXpStore({ cwd, dirOverride });
  } catch (e) {
    exitOnMissingDir(e);
  }

  if (!id) {
    console.error('用法: oma xp show <id>  (例: oma xp show deploy-001)');
    process.exit(1);
  }

  // Verify it's in the index
  const idx = loadIndex(store).find(e => e.id === id);
  if (!idx) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }

  const filePath = store.xpFilePath(id);
  if (!fs.existsSync(filePath)) {
    console.error(`经验文件丢失: ${filePath}  (索引中有记录，但文件不存在 — 运行 oma xp reindex 修复)`);
    process.exit(1);
  }

  console.log(fs.readFileSync(filePath, 'utf8'));
}

/**
 * oma xp search <query> [--stage <stage>] [--format table|md]
 * Two-pass search:
 *   Pass 1: match index fields (id, name, description, tags) — cheap
 *   Pass 2: read matching files for full-text match — only for index hits
 */
function search({ cwd, dirOverride, query, stage, format = 'md' } = {}) {
  let store;
  try {
    store = resolveXpStore({ cwd, dirOverride });
  } catch (e) {
    exitOnMissingDir(e);
  }

  if (!query) {
    console.error('用法: oma xp search <关键词>');
    process.exit(1);
  }

  const terms = query.toLowerCase().split(/\s+/);

  function scoreIndex(e) {
    const text = [e.id, e.name, e.description, ...(e.tags || [])].join(' ').toLowerCase();
    return terms.reduce((s, t) => s + (text.includes(t) ? 2 : 0), 0);
  }

  function scoreFile(id) {
    const fp = store.xpFilePath(id);
    if (!fs.existsSync(fp)) return 0;
    const text = fs.readFileSync(fp, 'utf8').toLowerCase();
    return terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
  }

  let entries = loadIndex(store);
  if (stage) entries = entries.filter(e => e.stage === stage);

  // Score each entry: index score (weight 2x) + file content score (weight 1x)
  const scored = entries
    .map(e => {
      const si = scoreIndex(e);
      const sf = si > 0 ? scoreFile(e.id) : 0;   // only read file if index already matched
      return { ...e, _score: si + sf };
    })
    .filter(e => e._score > 0)
    .sort((a, b) => b._score - a._score);

  if (scored.length === 0) {
    console.log(`未找到与 "${query}" 相关的经验。`);
    return;
  }

  if (format === 'md') {
    console.log(`# 经验搜索: "${query}" — ${scored.length} 条结果\n`);
    console.log('_摘要如下。使用 `oma xp show <id>` 查看全文。_\n');
    for (const e of scored) {
      const tags = (e.tags || []).map(t => `\`${t}\``).join(' ') || '—';
      console.log(`## [${e.id}] ${e.name}  _(${e.stage} / ${e.robot_type})_`);
      console.log(`> ${e.description}`);
      console.log(`标签: ${tags}\n`);
    }
  } else {
    const col = (s, n) => String(s ?? '').substring(0, n).padEnd(n);
    console.log('\n' + col('ID', 12) + col('Stage', 8) + col('Name', 28) + 'Description');
    console.log('─'.repeat(90));
    for (const e of scored) {
      console.log(col(e.id, 12) + col(e.stage, 8) + col(e.name, 28) + (e.description || '').substring(0, 40));
    }
    console.log('');
  }
}

/**
 * oma xp list [--stage <s>] [--tag <t>] [--format table|md]
 * Alias for indexCmd — list is just the index, not the heavy content.
 */
function list(opts) {
  return indexCmd(opts);
}

/**
 * oma xp delete <id>
 * Remove experience file and update index.
 */
function del({ cwd, dirOverride, id } = {}) {
  let store;
  try {
    store = resolveXpStore({ cwd, dirOverride });
  } catch (e) {
    exitOnMissingDir(e);
  }

  if (!id) {
    console.error('用法: oma xp delete <id>');
    process.exit(1);
  }

  const index = loadIndex(store);
  const filtered = index.filter(e => e.id !== id);
  if (filtered.length === index.length) {
    console.error(`未找到经验: ${id}`);
    process.exit(1);
  }

  const filePath = store.xpFilePath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  saveIndex(store, filtered);
  console.log(`✅ 已删除经验: ${id}`);
}

/**
 * oma xp reindex
 * Rebuild xp-index.json by scanning all .md files in the configured directory.
 */
function reindex({ cwd, dirOverride } = {}) {
  let store;
  try {
    store = resolveXpStore({ cwd, dirOverride });
  } catch (e) {
    exitOnMissingDir(e);
  }

  if (!fs.existsSync(store.absDir)) {
    console.log('经验库目录不存在，索引为空。');
    saveIndex(store, []);
    return;
  }

  const files = fs.readdirSync(store.absDir).filter(f => f.endsWith('.md'));
  const entries = [];

  for (const file of files) {
    const id = file.replace(/\.md$/, '');
    const content = fs.readFileSync(path.join(store.absDir, file), 'utf8');

    const get = (key) => {
      const m = content.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*(.+?)\\s*$`, 'm'));
      return m ? m[1].replace(/\s*\*+$/, '').trim() : null;
    };

    const titleMatch = content.match(/^#\s+\[([^\]]+)\]\s+(.+)$/m);
    const name  = titleMatch?.[2]?.trim() || id;
    const stage = get('阶段') || 'deploy';

    const descMatch = content.match(/## 描述\s*\n+(.+)/);
    const description = descMatch?.[1]?.trim() || '';

    const tagMatch = content.match(/\*\*标签\*\*:\s*(.+)/);
    const tags = tagMatch
      ? [...tagMatch[1].matchAll(/`([^`]+)`/g)].map(m => m[1])
      : [];

    const robot_type = get('机器人')?.split(/\s+/)[0] || 'other';
    const task       = get('任务')?.split(/\s+/)[0] || 'other';
    const added_at   = get('添加时间') || null;
    const source_project = get('来源项目') || null;

    entries.push({ id, name, stage, robot_type, task, description, tags, added_at, source_project });
  }

  saveIndex(store, entries);
  console.log(`✅ 索引已重建：${entries.length} 条经验 → ${store.indexPath}`);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
oma xp — 项目经验库管理

存储结构（用户指定路径，写入 .oma/index.json experiences_dir）:
  {experiences_dir}/xp-index.json    轻量索引
  {experiences_dir}/<id>.md          每条经验的 Markdown 文件

首次配置:
  oma xp init --dir shared/lessons/experiences

Codex 推荐使用流程:
  1. oma xp index --format md          先看索引，判断哪些经验相关
  2. oma xp show <id>                  读取相关经验的完整内容
  3. oma xp search "<词>" --stage <s>  有明确关键词时直接全文搜索

用法:
  oma xp init --dir <path>                     配置经验库路径（写入 index.json）
  oma xp add [--dir <path>] [--file <path>] ...  归档经验
  oma xp tag <id> <tag1> [tag2 ...]            为已有经验追加标签
  oma xp index [--dir <path>] [--stage <s>]      打印轻量索引
  oma xp show <id> [--dir <path>]
  oma xp search <关键词> [--dir <path>] [--stage <s>]
  oma xp list / delete / reindex [--dir <path>]

  --dir <path>   覆盖 index.json 中的 experiences_dir（单次命令）

有效阶段: ${VALID_STAGES.join(', ')}

示例:
  oma xp init --dir lab/experiences
  oma xp add --file ankle_kd_experience.md --name "ankle-kd-tuning" \\
             --description "降低 ankle kd 消除颤振" --stage deploy
  oma xp index --stage deploy --format md
  oma xp show deploy-001
`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function xp(args = [], flags = {}) {
  const sub         = args[0];
  const cwd         = flags.cwd || process.cwd();
  const dirOverride = flags['--dir'] || null;
  const stage       = flags['--stage']       || null;
  const tag         = flags['--tag']         || null;
  const format      = flags['--format']      || undefined;
  const nameCli     = flags['--name']        || null;
  const descCli     = flags['--description'] || flags['--desc'] || null;
  const fileCli     = flags['--file']        || null;
  const id          = args[1] || null;
  const newTags     = args.slice(2);
  const tagsCli     = tag || null;
  const ctx         = { cwd, dirOverride };

  switch (sub) {
    case 'init':    return initXpStore(cwd, dirOverride);
    case 'add':     return add({ ...ctx, filePath: fileCli, stage, nameCli, descriptionCli: descCli, tagsCli });
    case 'tag':     return tagCmd({ ...ctx, id, newTags });
    case 'index':   return indexCmd({ ...ctx, stage, tag, format });
    case 'list':    return list({ ...ctx, stage, tag, format });
    case 'search':  return search({ ...ctx, query: args.slice(1).join(' ') || flags['--query'], stage, format });
    case 'show':    return show({ ...ctx, id });
    case 'delete':
    case 'del':     return del({ ...ctx, id });
    case 'reindex': return reindex(ctx);
    default:        return help();
  }
}

module.exports = { xp, resolveXpStore, VALID_STAGES };
