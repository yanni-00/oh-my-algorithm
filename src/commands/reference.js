'use strict';

const path = require('path');
const { OMA, exists } = require('../utils/paths');
const { ensureIndex, writeIndex, readIndex } = require('../utils/oma-index');
const {
  installReferenceSkill,
  listPackageReferenceSkills,
  detectPlatform,
  referenceSkillKey,
  skillPathPrefix,
} = require('../utils/skills-install');
const { header, section, ok, fail, info, blank, log, kv, color } = require('../utils/print');

async function reference(args, { cwd = process.cwd(), platform = null } = {}) {
  const sub = args[0];

  if (!exists(OMA.dir(cwd))) {
    fail('.oma/ not found', 'Run `oma setup` first');
    blank();
    process.exit(1);
  }

  if (!sub || sub === 'list' || sub === 'ls') {
    return listRefs(cwd);
  }

  if (sub === 'install') {
    const name = args[1];
    if (!name) {
      fail('name required', 'Usage: oma reference install <name> [-p cursor|codex|claude-code]');
      process.exit(1);
    }
    const pFlag = args.includes('-p') ? args[args.indexOf('-p') + 1] : null;
    return installRef(cwd, name, { platform: platform || pFlag || detectPlatform(cwd) });
  }

  if (sub === 'add') {
    return addRef(cwd, args.slice(1));
  }

  fail('Unknown subcommand', `"${sub}" — use: list | install | add`);
  blank();
  process.exit(1);
}

function listRefs(cwd) {
  header('oma reference list');

  section('Package catalog (skills/reference/)');
  const pkg = listPackageReferenceSkills();
  if (pkg.length) {
    for (const n of pkg) ok(n, `skills/reference/${n}`);
  } else {
    info('No reference skills in package');
  }

  section('Installed (index.reference_skills)');
  const index = readIndex(cwd);
  const installed = index?.reference_skills || {};
  const names = Object.keys(installed);
  if (names.length) {
    for (const n of names) {
      const entry = installed[n];
      const label = typeof entry === 'string' ? entry : entry.skill_key || referenceSkillKey(n);
      kv(n, label);
    }
  } else {
    info('None installed', 'Run `oma reference install experiment-analysis`');
  }

  blank();
}

function registerReference(cwd, name, installResult) {
  const index = ensureIndex(cwd);
  index.reference_skills = index.reference_skills || {};
  index.reference_skills[name] = {
    platform  : installResult.platform,
    skill_key : installResult.skill_key,
    path      : installResult.path,
    installed_at: new Date().toISOString(),
  };
  writeIndex(cwd, index);
}

function installRef(cwd, name, { platform } = {}) {
  if (!platform) platform = detectPlatform(cwd);

  let result;
  try {
    result = installReferenceSkill(cwd, platform, name, true);
  } catch (e) {
    fail('Install failed', e.message);
    blank();
    process.exit(1);
  }

  registerReference(cwd, name, result);

  header('oma reference install');
  ok('Installed', name);
  kv('Platform', platform);
  kv('Skill', result.skill_key);
  kv('Path', result.path);

  blank();
  log(`  ${color.gray('Registered in')} index.reference_skills.${name}`);
  blank();
}

function addRef(cwd, rest) {
  fail('oma reference add', 'Not yet implemented — copy into package skills/reference/ and release, or use install from a local fork.');
  blank();
  process.exit(1);
}

module.exports = { reference, listPackageReferenceSkills };
