'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, pkgRoot, templatePath, exists, readJSON } = require('../utils/paths');
const {
  installCoreSkills,
  rewriteAgentSkillPaths,
  removeLegacyOmaSkills,
  skillPathPrefix,
  gitignoreSentinel,
  PLATFORM_AGENT_FILE,
} = require('../utils/skills-install');
const { header, section, ok, warn, info, blank, log, color } = require('../utils/print');

const DIRS_TO_CREATE = [
  (cwd) => OMA.dir(cwd),
  (cwd) => OMA.requirement(cwd),
  (cwd) => OMA.paper(cwd),
  (cwd) => OMA.tracks(cwd),
  (cwd) => OMA.impl(cwd),
];

const TEMPLATES = [
  { src: 'requirements.md', dest: (cwd) => OMA.requirements(cwd), label: '.oma/requirement/requirements.md' },
  { src: 'knowledge.md',    dest: (cwd) => OMA.knowledge(cwd),    label: '.oma/requirement/knowledge.md'    },
];

const PLATFORM_MAP = {
  'codex'       : 'AGENTS.md',
  'meta-agent'  : 'AGENT.md',
  'cursor'      : 'AGENTS.md',
  'claude-code' : 'CLAUDE.md',
};

async function setup({ cwd = process.cwd(), force = false, platform = 'codex', overlay = null } = {}) {
  if (!PLATFORM_MAP[platform]) {
    const valid = Object.keys(PLATFORM_MAP).join(' | ');
    console.error(`  ✗ Unknown platform: "${platform}". Valid values: ${valid}`);
    process.exit(1);
  }

  header('oma setup — oh-my-algorithm');
  blank();

  section('Creating .oma/ directory structure');
  for (const mkDir of DIRS_TO_CREATE) {
    const p = mkDir(cwd);
    const rel = path.relative(cwd, p);
    if (exists(p)) warn(rel, 'already exists, skipped');
    else { fs.mkdirSync(p, { recursive: true }); ok(rel, 'created'); }
  }

  section('Initializing state templates');
  for (const { src, dest, label } of TEMPLATES) {
    const destPath = dest(cwd);
    const srcPath  = templatePath(src);
    if (exists(destPath) && !force) {
      warn(label, 'already exists, skipped  (use --force to overwrite)');
      continue;
    }
    if (!exists(srcPath)) {
      writeStub(destPath, src);
      ok(label, 'created (stub)');
    } else {
      fs.copyFileSync(srcPath, destPath);
      ok(label, 'created from template');
    }
  }

  const indexPath = OMA.index(cwd);
  const indexTpl  = templatePath('index.json');
  if (!exists(indexPath) || force) {
    if (exists(indexTpl)) {
      let raw = fs.readFileSync(indexTpl, 'utf8');
      const idx = JSON.parse(raw);
      idx.last_updated = new Date().toISOString().slice(0, 10);
      idx.meta.project_name = path.basename(cwd);
      idx.meta.created_at = new Date().toISOString();
      fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2) + '\n');
    } else {
      const { defaultIndex, writeIndex } = require('../utils/oma-index');
      writeIndex(cwd, defaultIndex(cwd));
    }
    ok('.oma/index.json', 'created');
  } else {
    warn('.oma/index.json', 'already exists, skipped');
  }

  // ── Agent constitution + platform skills (NOT copied to .oma/) ───────────
  if (platform === 'cursor') {
    installCursorConstitution(cwd, force);
  } else {
    const agentFileName = PLATFORM_MAP[platform];
    section(`Installing agent prompt (${agentFileName})`);
    const agentsSrc  = path.join(pkgRoot(), 'AGENTS.md');
    const agentsDest = path.join(cwd, agentFileName);
    if (exists(agentsDest) && !force) {
      warn(agentFileName, 'already exists, skipped  (use --force to overwrite)');
    } else if (!exists(agentsSrc)) {
      warn(agentFileName, 'source not found — skipped');
    } else {
      let body = fs.readFileSync(agentsSrc, 'utf8');
      body = rewriteAgentSkillPaths(body, platform);
      fs.writeFileSync(agentsDest, body);
      ok(agentFileName, `installed (skill paths → ${skillPathPrefix(platform)})`);
    }
  }

  section(`Installing platform skills (${skillPathPrefix(platform)}, core only)`);
  if (force) removeLegacyOmaSkills(cwd);
  const installed = installCoreSkills(cwd, platform, force);
  if (installed.length) {
    for (const rel of installed.slice(0, 8)) ok(rel, 'installed');
    if (installed.length > 8) info(`…and ${installed.length - 8} more`, '');
  } else {
    warn('skills', 'none installed (already present or source missing)');
  }
  info('Reference skills', 'NOT installed by setup — use `oma reference install <name>`');

  section('Installing .oma/templates/');
  const templatesSrc  = path.join(pkgRoot(), 'templates');
  const templatesDest = path.join(OMA.dir(cwd), 'templates');
  if (!exists(templatesSrc)) {
    warn('.oma/templates/', 'source not found — skipped');
  } else {
    copyDirRecursive(templatesSrc, templatesDest, force);
    ok('.oma/templates/', `installed at ${path.relative(cwd, templatesDest)}`);
  }

  const gitignorePath = path.join(cwd, '.gitignore');
  const runtimeBlock = '\n# oh-my-algorithm state\n.oma/tracks/*/experiments/\n.oma/best.json\n';
  const sentinel = gitignoreSentinel(platform);
  const toolingBlock = platform === 'cursor'
    ? `# oh-my-algorithm tooling (oma setup -p cursor)\n.oma/templates/\n.cursor/rules/oma-core.mdc\n.cursor/skills/\n`
    : `# oh-my-algorithm tooling (oma setup)\n.oma/templates/\n${sentinel}\n`;
  const omaIgnoreEntry = runtimeBlock + toolingBlock;

  if (exists(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (!existing.includes(sentinel)) {
      fs.appendFileSync(gitignorePath, omaIgnoreEntry);
      ok('.gitignore', 'appended oma entries');
    } else {
      warn('.gitignore', 'already has oma entries, skipped');
    }
  } else {
    fs.writeFileSync(gitignorePath, omaIgnoreEntry.trimStart());
    ok('.gitignore', 'created with oma entries');
  }

  if (overlay) {
    section('Appending user overlay');
    appendOverlay(cwd, platform, overlay);
  }

  blank();
  log(color.bold('  Setup complete. What to do next:'));
  blank();
  info('Run doctor to confirm everything is in order:', 'oma doctor');
  if (platform === 'cursor') {
    info('Constitution:', '.cursor/rules/oma-core.mdc');
    info('Skills:', '.cursor/skills/{requirement,loop,deploy,loop-*}');
  } else {
    info('Agent file:', PLATFORM_MAP[platform]);
    info('Skills:', `${skillPathPrefix(platform)}{requirement,loop,deploy,loop-*}`);
  }
  info('Optional reference skills:', 'oma reference install <name> [-p cursor]');
  blank();
}

function installCursorConstitution(cwd, force) {
  section('Installing .cursor/rules/oma-core.mdc');
  const rulesDir = path.join(cwd, '.cursor', 'rules');
  const coreDest = path.join(rulesDir, 'oma-core.mdc');
  if (exists(coreDest) && !force) {
    warn('.cursor/rules/oma-core.mdc', 'exists, skipped');
  } else {
    const agentsSrc = path.join(pkgRoot(), 'AGENTS.md');
    let body = exists(agentsSrc) ? fs.readFileSync(agentsSrc, 'utf8') : '# oh-my-algorithm (OMA)\n';
    body = rewriteAgentSkillPaths(body, 'cursor');
    const fm = [
      '---',
      'description: OMA robot-RL workflow constitution — startup protocol, gate chain, state files, and stage routing. Always active in this repo.',
      'alwaysApply: true',
      '---',
      '',
    ].join('\n');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(coreDest, fm + body);
    ok('.cursor/rules/oma-core.mdc', 'installed');
  }

  const agentsDest = path.join(cwd, 'AGENTS.md');
  if (!exists(agentsDest) || force) {
    const agentsSrc = path.join(pkgRoot(), 'AGENTS.md');
    if (exists(agentsSrc)) {
      let body = fs.readFileSync(agentsSrc, 'utf8');
      body = rewriteAgentSkillPaths(body, 'cursor');
      fs.writeFileSync(agentsDest, body);
      ok('AGENTS.md', '@-fallback with .cursor/skills paths');
    }
  }
}

const COPY_SKIP = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep', 'reference']);

function shouldSkip(name) {
  return COPY_SKIP.has(name) || name === '__pycache__' || name.endsWith('.pyc');
}

function copyDirRecursive(src, dest, force) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, destPath, force);
    else if (!exists(destPath) || force) fs.copyFileSync(srcPath, destPath);
  }
}

function writeStub(destPath, templateName) {
  const stubs = {
    'requirements.md': `# Requirements\n_Created: ${new Date().toISOString().slice(0, 10)}_\n\n<!-- Fill this in via $requirement -->\n`,
    'knowledge.md':    `# Knowledge Base\n_Status: DRAFT — run \`oma extract --paper path.pdf\` then \$requirement to populate_\n`,
  };
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, stubs[templateName] ?? `# ${templateName}\n`);
}

const OVERLAY_AGENT_FILE = {
  'codex'      : 'AGENTS.md',
  'meta-agent' : 'AGENT.md',
  'cursor'     : path.join('.cursor', 'rules', 'oma-core.mdc'),
  'claude-code': 'CLAUDE.md',
};
const OVERLAY_RE = /<!--\s*OMA:USER-OVERLAY:BEGIN[\s\S]*?OMA:USER-OVERLAY:END\s*-->\n?/;

function appendOverlay(cwd, platform, overlayPath) {
  if (!exists(overlayPath)) {
    warn('overlay', `not found: ${overlayPath} — skipped`);
    return;
  }
  const rel    = OVERLAY_AGENT_FILE[platform] || 'AGENTS.md';
  const target = path.join(cwd, rel);
  const md     = fs.readFileSync(overlayPath, 'utf8').trimEnd();
  const region =
    `<!-- OMA:USER-OVERLAY:BEGIN (from ${path.basename(overlayPath)}; appended verbatim by oma setup --overlay) -->\n` +
    md + '\n' +
    `<!-- OMA:USER-OVERLAY:END -->\n`;

  let existing = exists(target) ? fs.readFileSync(target, 'utf8') : `# ${path.basename(rel)}\n`;
  existing = OVERLAY_RE.test(existing)
    ? existing.replace(OVERLAY_RE, region)
    : existing.trimEnd() + '\n\n---\n\n' + region;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, existing);
  ok('overlay', `appended to ${rel}`);
}

module.exports = { setup };
