/**
 * oma index --src <path> [--track <track-id>] [--list] [--force]
 *
 * Registers per-track local code paths under .oma/codebase/config.json.
 * Parallel tracks can each point at a different directory (two routes, two code trees).
 */

'use strict';

const { header, section, ok, warn, fail, info, kv, blank, table, color, log } = require('../utils/print');
const { getDefaultTrackId } = require('../utils/oma-index');
const {
  registerCodebase,
  listTrackCodebases,
  resolveTrackSrcPath,
} = require('../utils/codebase');
const { OMA } = require('../utils/paths');
const fs = require('fs');

async function index({ cwd, srcPath, trackId, force = false, list = false }) {
  if (!fs.existsSync(OMA.dir(cwd))) {
    fail('No .oma/ directory found. Run `oma setup` first.');
    process.exit(1);
  }

  if (list || !srcPath) {
    return listCodebases(cwd);
  }

  header('oma index — Register Reference Codebase');

  const defaultTrack = getDefaultTrackId(cwd);
  const resolvedTrack = trackId || defaultTrack;
  if (!resolvedTrack) {
    fail('No track target', 'Run `oma track open <track-id>` first, or pass --track <track-id>.');
    blank();
    process.exit(1);
  }

  try {
    const result = registerCodebase(cwd, { trackId: resolvedTrack, srcPath, force });
    const { entry } = result;

    if (result.unchanged) {
      warn('Already registered', entry.srcPath);
      kv('Track', resolvedTrack);
      info('Use --force to overwrite this track mapping.');
      blank();
      return;
    }

    section('Registered');
    kv('Track', resolvedTrack);
    kv('Path', entry.srcPath);
    kv('Primary language (detected)', entry.primaryLang);
    kv(
      'Top-level entries',
      entry.topLevel.slice(0, 12).join(', ') + (entry.topLevel.length > 12 ? ' …' : ''),
    );

    blank();
    ok([
      `Track "${resolvedTrack}" → ${entry.srcPath}`,
      'Saved in .oma/codebase/config.json (tracks map)',
      '$design / $implement resolve srcPath from the active track',
    ].join('\n  '));
    blank();
  } catch (e) {
    fail('Registration failed', e.message);
    blank();
    process.exit(1);
  }
}

function listCodebases(cwd) {
  header('oma index — Codebase Map');
  const defaultTrack = getDefaultTrackId(cwd);
  kv('Default track', defaultTrack || '—');

  const rows = listTrackCodebases(cwd);
  if (!rows.length) {
    blank();
    info('No codebase registered', 'Run `oma index --src <path> --track <track-id>`');
    blank();
    log(`  ${color.gray('Example:')}`);
    log(`    oma track open gait-clock --label "步态时钟"`);
    log(`    oma index --src ./legged_gym_gait --track gait-clock`);
    log(`    oma track open minimal-reward --label "极简奖励"`);
    log(`    oma index --src ./legged_gym_minimal --track minimal-reward`);
    blank();
    return;
  }

  section('Track → local srcPath');
  const tableRows = [['track', 'srcPath', 'lang', 'registered']];
  for (const row of rows) {
    const marker = row.trackId === defaultTrack ? '*' : ' ';
    tableRows.push([
      marker + (row.trackId || '—'),
      (row.srcPath || '—').slice(0, 52),
      row.primaryLang || '—',
      row.registeredAt ? row.registeredAt.slice(0, 10) : '—',
    ]);
  }
  table(tableRows);
  log(color.gray('  * = default track'));

  if (defaultTrack) {
    const activePath = resolveTrackSrcPath(cwd, defaultTrack);
    if (activePath) {
      blank();
      kv('Active srcPath', activePath);
    }
  }

  blank();
}

module.exports = { index };
