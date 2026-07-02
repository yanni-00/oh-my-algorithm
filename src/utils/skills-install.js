'use strict';

const fs   = require('fs');
const path = require('path');
const { pkgRoot, exists, readJSON } = require('./paths');

const CORE_SKILL_DIRS = ['requirement', 'loop', 'deploy', 'adapters'];
const LOOP_PHASES     = ['design', 'implement', 'train', 'tune', 'consolidate'];

const PLATFORM_SKILLS_ROOT = {
  cursor      : (cwd) => path.join(cwd, '.cursor', 'skills'),
  codex       : (cwd) => path.join(cwd, '.codex', 'skills'),
  'meta-agent': (cwd) => path.join(cwd, '.agents', 'skills'),
  'claude-code': (cwd) => path.join(cwd, '.claude', 'skills'),
};

const PLATFORM_AGENT_FILE = {
  cursor      : path.join('.cursor', 'rules', 'oma-core.mdc'),
  codex       : 'AGENTS.md',
  'meta-agent': 'AGENT.md',
  'claude-code': 'CLAUDE.md',
};

function skillsPackageRoot() {
  return path.join(pkgRoot(), 'skills');
}

function referencePackageRoot() {
  return path.join(skillsPackageRoot(), 'reference');
}

function platformSkillsRoot(cwd, platform) {
  const fn = PLATFORM_SKILLS_ROOT[platform] || PLATFORM_SKILLS_ROOT.codex;
  return fn(cwd);
}

function detectPlatform(cwd) {
  if (exists(path.join(cwd, '.cursor', 'rules', 'oma-core.mdc'))) return 'cursor';
  if (exists(path.join(cwd, '.claude', 'skills'))) return 'claude-code';
  if (exists(path.join(cwd, '.codex', 'skills'))) return 'codex';
  if (exists(path.join(cwd, '.agents', 'skills'))) return 'meta-agent';
  if (exists(path.join(cwd, 'AGENT.md'))) return 'meta-agent';
  if (exists(path.join(cwd, 'CLAUDE.md'))) return 'claude-code';
  return 'codex';
}

function skillPathPrefix(platform) {
  switch (platform) {
    case 'cursor':       return '.cursor/skills/';
    case 'claude-code':  return '.claude/skills/';
    case 'meta-agent':   return '.agents/skills/';
    default:             return '.codex/skills/';
  }
}

/** Rewrite AGENTS.md skill paths for the target platform. */
function rewriteAgentSkillPaths(content, platform) {
  const prefix = skillPathPrefix(platform);
  return content
    .replace(/\.oma\/skills\//g, prefix)
    .replace(/\.oma\/reference\//g, `${prefix}reference-`)
    .replace(/\.cursor\/skills\//g, prefix);
}

function loadCursorSkillMeta() {
  const data = readJSON(path.join(pkgRoot(), 'configs', 'cursor-skill-meta.json'));
  return (data && data.skills) || {};
}

function withCursorFrontmatter(content, stage, meta) {
  if (/^---\s*\r?\n/.test(content)) return content;
  const entry = meta[stage];
  if (!entry) return content;
  const fm = [
    '---',
    `name: ${entry.name}`,
    `description: ${JSON.stringify(entry.description)}`,
    '---',
    '',
    '',
  ].join('\n');
  return fm + content;
}

function writeSkillFile(destFile, content, { platform, stage, force }) {
  if (exists(destFile) && !force) return false;
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  let out = content;
  if (platform === 'cursor' && stage) {
    out = withCursorFrontmatter(content, stage, loadCursorSkillMeta());
  }
  fs.writeFileSync(destFile, out);
  return true;
}

function installCoreSkills(cwd, platform, force = false) {
  const pkg   = skillsPackageRoot();
  const dest  = platformSkillsRoot(cwd, platform);
  const installed = [];

  if (!exists(pkg)) return installed;

  for (const stage of ['requirement', 'loop', 'deploy']) {
    const src = path.join(pkg, stage, 'SKILL.md');
    const df  = path.join(dest, stage, 'SKILL.md');
    if (!exists(src)) continue;
    if (writeSkillFile(df, fs.readFileSync(src, 'utf8'), { platform, stage: platform === 'cursor' ? stage : null, force })) {
      installed.push(path.relative(cwd, df));
    }
  }

  const phasesDir = path.join(pkg, 'loop', 'phases');
  if (exists(phasesDir)) {
    for (const f of fs.readdirSync(phasesDir)) {
      if (!f.endsWith('.md')) continue;
      const phase = f.replace(/\.md$/, '');
      const key   = `loop-${phase}`;
      const df    = path.join(dest, key, 'SKILL.md');
      if (writeSkillFile(df, fs.readFileSync(path.join(phasesDir, f), 'utf8'), {
        platform, stage: platform === 'cursor' ? key : null, force,
      })) {
        installed.push(path.relative(cwd, df));
      }
    }
  }

  return installed;
}

function referenceSkillKey(name) {
  return `reference-${name}`;
}

function installReferenceSkill(cwd, platform, name, force = false) {
  const srcDir = path.join(referencePackageRoot(), name);
  if (!exists(srcDir)) {
    throw new Error(`reference skill "${name}" not found in package skills/reference/`);
  }

  const destDir  = path.join(platformSkillsRoot(cwd, platform), referenceSkillKey(name));
  const destFile = path.join(destDir, 'SKILL.md');
  const srcFile  = path.join(srcDir, 'SKILL.md');

  if (!exists(srcFile)) {
    throw new Error(`SKILL.md missing in skills/reference/${name}/`);
  }

  fs.mkdirSync(destDir, { recursive: true });

  let content = fs.readFileSync(srcFile, 'utf8');
  if (platform === 'cursor' && !/^---\s*\r?\n/.test(content)) {
    const fm = [
      '---',
      `name: ${referenceSkillKey(name)}`,
      `description: OMA reference skill (lab-specific). Installed via oma reference install ${name}.`,
      '---',
      '',
      '',
    ].join('\n');
    content = fm + content;
  }

  if (force || !exists(destFile)) {
    fs.writeFileSync(destFile, content);
  }

  for (const f of fs.readdirSync(srcDir)) {
    if (f === 'SKILL.md') continue;
    const sp = path.join(srcDir, f);
    if (fs.statSync(sp).isFile()) {
      const dp = path.join(destDir, f);
      if (force || !exists(dp)) fs.copyFileSync(sp, dp);
    }
  }

  return {
    platform,
    skill_key: referenceSkillKey(name),
    path: path.relative(cwd, destDir).split(path.sep).join('/'),
  };
}

function listPackageReferenceSkills() {
  const dir = referencePackageRoot();
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function removeLegacyOmaSkills(cwd) {
  const legacy = path.join(cwd, '.oma', 'skills');
  const legacyRef = path.join(cwd, '.oma', 'reference');
  if (exists(legacy)) fs.rmSync(legacy, { recursive: true, force: true });
  if (exists(legacyRef)) fs.rmSync(legacyRef, { recursive: true, force: true });
}

function gitignoreSentinel(platform) {
  return `${skillPathPrefix(platform).replace(/\\/g, '/')}`;
}

module.exports = {
  CORE_SKILL_DIRS,
  PLATFORM_SKILLS_ROOT,
  PLATFORM_AGENT_FILE,
  skillsPackageRoot,
  referencePackageRoot,
  platformSkillsRoot,
  detectPlatform,
  skillPathPrefix,
  rewriteAgentSkillPaths,
  installCoreSkills,
  installReferenceSkill,
  listPackageReferenceSkills,
  referenceSkillKey,
  removeLegacyOmaSkills,
  gitignoreSentinel,
};
