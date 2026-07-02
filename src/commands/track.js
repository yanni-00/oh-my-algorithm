'use strict';

const { OMA, exists } = require('../utils/paths');
const {
  readIndex,
  openTrack,
  closeTrack,
  switchTrack,
  readTrackLoop,
  getDefaultTrackId,
  validateTrackId,
} = require('../utils/oma-index');
const { resolveTrackSrcPath } = require('../utils/codebase');
const { header, section, ok, fail, info, blank, log, kv, table, color } = require('../utils/print');

async function track(args, { cwd = process.cwd() } = {}) {
  const sub = args[0];

  if (!exists(OMA.dir(cwd))) {
    fail('.oma/ not found', 'Run `oma setup` first');
    blank();
    process.exit(1);
  }

  if (!sub || sub === 'list' || sub === 'ls') {
    return listTracks(cwd);
  }

  if (sub === 'open') {
    const trackId = args[1];
    if (!trackId) {
      fail('track_id required', 'Usage: oma track open <track-id> [--label "..."] [--owner name] [--paradigm "..."]');
      blank();
      process.exit(1);
    }
    return openTrackCmd(cwd, trackId, parseFlags(args.slice(2)));
  }

  if (sub === 'close') {
    const trackId = args[1];
    if (!trackId) {
      fail('track_id required', 'Usage: oma track close <track-id> [--deliverable "..."]');
      blank();
      process.exit(1);
    }
    return closeTrackCmd(cwd, trackId, parseFlags(args.slice(2)));
  }

  if (sub === 'switch' || sub === 'use') {
    const trackId = args[1];
    if (!trackId) {
      fail('track_id required', 'Usage: oma track switch <track-id>');
      blank();
      process.exit(1);
    }
    return switchTrackCmd(cwd, trackId);
  }

  fail('Unknown subcommand', `"${sub}" — use: open | close | list | switch`);
  blank();
  process.exit(1);
}

function parseFlags(rest) {
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--label' && rest[i + 1]) { flags.label = rest[++i]; continue; }
    if (rest[i] === '--owner' && rest[i + 1]) { flags.owner = rest[++i]; continue; }
    if (rest[i] === '--paradigm' && rest[i + 1]) { flags.paradigm = rest[++i]; continue; }
    if (rest[i] === '--target' && rest[i + 1]) { flags.targetRef = rest[++i]; continue; }
    if (rest[i] === '--deliverable' && rest[i + 1]) { flags.deliverable = rest[++i]; continue; }
  }
  return flags;
}

function openTrackCmd(cwd, trackId, flags) {
  try {
    validateTrackId(trackId);
    const entry = openTrack(cwd, { trackId, ...flags });
    header('oma track open');
    ok('Track opened', entry.track_id);
    kv('Label', entry.label);
    kv('Path', entry.track_ref || `tracks/${entry.track_id}`);
    kv('Target', entry.target_ref);
    blank();
    log(`  ${color.gray('Created:')} tracks/${entry.track_id}/{loop.json, memory.md, experiments-index.json, design/, experiments/}`);
    blank();
    log(`  ${color.gray('Code:')}   oma index --src <local-path> --track ${trackId}`);
    blank();
    log(`  ${color.gray('Next:')} run ${color.cyan('$loop (design)')} on this track, or ${color.cyan('oma track switch ' + trackId)}`);
    blank();
  } catch (e) {
    fail('Could not open track', e.message);
    blank();
    process.exit(1);
  }
}

function closeTrackCmd(cwd, trackId, flags) {
  try {
    const entry = closeTrack(cwd, trackId, flags);
    header('oma track close');
    ok('Track closed', entry.track_id);
    if (flags.deliverable) kv('Deliverable', flags.deliverable);
    blank();
  } catch (e) {
    fail('Could not close track', e.message);
    blank();
    process.exit(1);
  }
}

function switchTrackCmd(cwd, trackId) {
  try {
    switchTrack(cwd, trackId);
    const { loop } = readTrackLoop(cwd, trackId);
    header('oma track switch');
    ok('Default track', trackId);
    if (loop) {
      kv('Lap', loop.lap != null ? `#${loop.lap}` : '—');
      kv('Stage', loop.stage || '—');
      kv('Exp', loop.exp_id || '—');
    }
    blank();
  } catch (e) {
    fail('Could not switch track', e.message);
    blank();
    process.exit(1);
  }
}

function listTracks(cwd) {
  const index = readIndex(cwd);
  header('oma track list');

  if (!index) {
    info('No index.json', 'Run `oma setup`');
    blank();
    return;
  }

  section('Project');
  kv('Default track', index.default_track || '—');
  kv('Active', String((index.active_tracks || []).length));
  kv('Closed', String((index.closed_tracks || []).length));

  const active = index.active_tracks || [];
  if (active.length) {
    section('Active Tracks');
    const rows = [['track_id', 'label', 'codebase', 'started', 'status']];
    for (const t of active) {
      const def = t.track_id === index.default_track ? color.green('*') : ' ';
      const src = resolveTrackSrcPath(cwd, t.track_id);
      rows.push([
        def + t.track_id,
        (t.label || '').slice(0, 20),
        src ? src.slice(0, 28) : color.gray('—'),
        t.started || '—',
        (t.status_summary || '—').slice(0, 20),
      ]);
    }
    table(rows);
    log(color.gray('  * = default track · register code: oma index --src <path> --track <id>'));
  } else {
    info('No active tracks', 'Run `oma track open <track-id> --label "..."`');
  }

  const closed = index.closed_tracks || [];
  if (closed.length) {
    section('Closed Tracks');
    const rows = [['track_id', 'label', 'closed', 'deliverable']];
    for (const t of closed) {
      rows.push([
        t.track_id,
        (t.label || '').slice(0, 24),
        t.closed || '—',
        (t.deliverable || '—').slice(0, 36),
      ]);
    }
    table(rows);
  }

  const defaultId = getDefaultTrackId(cwd);
  if (defaultId) {
    const { loop } = readTrackLoop(cwd, defaultId);
    if (loop) {
      section(`Loop @ ${defaultId}`);
      kv('Lap', loop.lap != null ? `#${loop.lap}` : '—');
      kv('Stage', loop.stage || '—');
      kv('Exp', loop.exp_id || '—');
      if (loop.hypothesis) kv('Hypothesis', loop.hypothesis);
    }
  }

  blank();
}

module.exports = { track };
