'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON, readText, resolveRequirementsPath, resolveTrackDesignDir, resolveTrackMemoryPath, listAllExperimentDirs } = require('../utils/paths');
const {
  readIndex,
  getMeta,
  readTrackLoop,
  getDefaultTrackId,
  hasLegacyFiles,
} = require('../utils/oma-index');
const { getTuneRanking, listAllResults, hasTuneSweep } = require('../utils/experiments');
const { header, section, ok, warn, info, blank, log, kv, table, color } = require('../utils/print');

async function status({ cwd = process.cwd() } = {}) {
  header('oma status');

  if (!exists(OMA.dir(cwd))) {
    log(color.red('  .oma/ not found. Run `oma setup` first.'));
    blank();
    return;
  }

  // ── 1. Current Phase ──────────────────────────────────────────────────────
  section('Current Phase');
  const phase = inferPhase(cwd);
  log(`  ${color.bold(color.cyan(phase.current))}  ${color.gray('→')}  ${color.gray(phase.next)}`);

  // ── 1b. Project index (tracks dashboard) ─────────────────────────────────
  const index = readIndex(cwd);
  if (index) {
    section('Project Index');
    const meta = index.meta || {};
    if (meta.project_name) kv('Project', meta.project_name);
    kv('Active tracks', String((index.active_tracks || []).length));
    kv('Closed tracks', String((index.closed_tracks || []).length));
    kv('Default track', index.default_track || '—');

    const active = index.active_tracks || [];
    if (active.length) {
      blank();
      const rows = [['track_id', 'label', 'status', 'next']];
      for (const t of active) {
        const mark = t.track_id === index.default_track ? color.green('*') : ' ';
        rows.push([
          mark + t.track_id,
          (t.label || '').slice(0, 20),
          (t.status_summary || '—').slice(0, 24),
          (t.next_milestone || '—').slice(0, 20),
        ]);
      }
      table(rows);
    }
  }

  // ── 1c. Iteration Loop (per default track) ─────────────────────────────
  const defaultTrack = getDefaultTrackId(cwd);
  if (defaultTrack) {
    const { trackId, loop } = readTrackLoop(cwd, defaultTrack);
    if (loop) {
      section(`Iteration Loop @ ${trackId}`);
      kv('Lap',        loop.lap != null ? `#${loop.lap}` : '—');
      kv('Stage',      color.cyan(loop.stage || '—') + color.gray('  (design ↔ implement ↔ train ↔ tune — advisory)'));
      kv('Exp',        loop.exp_id || '—');
      if (loop.hypothesis) kv('Hypothesis', loop.hypothesis);
      if (loop.updated_at) kv('Updated',    loop.updated_at.slice(0, 16).replace('T', ' '));
    }
  } else if (exists(path.join(OMA.dir(cwd), 'loop.json'))) {
    const loop = readJSON(path.join(OMA.dir(cwd), 'loop.json')) || {};
    section('Iteration Loop (legacy root loop.json)');
    warn('Migrate', 'Run `oma doctor --migrate` to move to tracks/ layout');
    kv('Lap', loop.lap != null ? `#${loop.lap}` : '—');
    kv('Stage', color.cyan(loop.stage || '—'));
    kv('Exp', loop.exp_id || '—');
  }

  // ── 2. Best Result ────────────────────────────────────────────────────────
  section('Best Result');
  const bestPath = OMA.best(cwd);
  if (exists(bestPath)) {
    const best = readJSON(bestPath);
    if (best) {
      const gateStr = best.deploy_gate_open
        ? color.green('deploy gate OPEN')
        : color.red('deploy gate closed');

      kv('Experiment',    best.exp_id);
      kv('Metric',        `${best.primary_metric?.name}: ${color.green(best.primary_metric?.mean?.toFixed(4) ?? '?')} ± ${best.primary_metric?.std?.toFixed(4) ?? '?'}`);
      kv('Status',        gateStr);
      kv('Evaluated at',  best.evaluated_at ? best.evaluated_at.slice(0, 16).replace('T', ' ') : '—');
    }
  } else {
    info('No evaluation run yet', 'run $tune (Phase 5 final eval) to populate best.json');
  }

  // ── 3. Tune ranking (per track) ───────────────────────────────────────────
  section('Tune Ranking');
  const trackForRank = defaultTrack || 'default';
  const ranking = getTuneRanking(cwd, trackForRank);
  if (ranking.entries.length) {
    const metric = ranking.metric_name || '?';
    const entries = ranking.entries.slice(0, 8);

    const rows = [
      ['#', 'exp-id', `${metric} (mean)`, '± std', 'phase', 'config'],
    ];
    entries.forEach((e, i) => {
      const rank   = String(i + 1);
      const mean   = typeof e.metric_mean === 'number' ? e.metric_mean.toFixed(4) : '?';
      const std    = typeof e.metric_std  === 'number' ? e.metric_std.toFixed(4)  : '?';
      const isBest = i === 0;
      rows.push([
        isBest ? color.green(rank) : color.gray(rank),
        isBest ? color.green(e.exp_id) : e.exp_id,
        isBest ? color.green(mean) : mean,
        std,
        color.gray(e.phase || '?'),
        color.gray((e.config_summary || '').slice(0, 30)),
      ]);
    });
    table(rows);
    kv('Track', trackForRank);
    if (ranking.entries.length > 8) {
      info(`  …and ${ranking.entries.length - 8} more entries`);
    }
  } else {
    info('No ranked experiments yet', `tracks/${trackForRank}/experiments-index.json`);
  }

  // ── 4. Memory snapshot ────────────────────────────────────────────────────
  section('Memory Snapshot');
  const trackForMem = defaultTrack || 'default';
  const memPath = resolveTrackMemoryPath(cwd, trackForMem);
  if (exists(memPath)) {
    const text = readText(memPath);
    const deadEnds      = countTableRows(text, 'Dead Ends');
    const workingPat    = countTableRows(text, 'Working Patterns');
    const openHyp       = countTableRows(text, 'Open Hypotheses');
    kv('Track', trackForMem);
    kv('Dead Ends',        String(deadEnds));
    kv('Working Patterns', String(workingPat));
    kv('Open Hypotheses',  String(openHyp));

    const budgetMatch = text.match(/Remaining\s*\|\s*([^\n|]+)/);
    if (budgetMatch) kv('Budget Remaining', budgetMatch[1].trim());
  } else {
    info(`tracks/${trackForMem}/memory.md not yet created`, 'created by oma track open or $loop (consolidate)');
  }

  // ── 5. Recent experiments ─────────────────────────────────────────────────
  section('Recent Experiments');
  const recent = listAllResults(cwd, { trackId: defaultTrack || undefined }).slice(0, 5);

  if (recent.length) {
    const rows = [['exp-id', 'phase', 'metric (mean)', 'status', 'started']];
    for (const row of recent) {
      const e = row.results;
      const summary = e.summary || {};
      rows.push([
        row.expId,
        color.gray(e.phase || '?'),
        summary.mean != null ? String(summary.mean.toFixed(4)) : '?',
        statusIcon(e.status),
        color.gray((e.started_at || e.startedAt || '').slice(0, 16).replace('T', ' ')),
      ]);
    }
    table(rows);
  } else {
    info('No experiments yet');
  }

  if (hasLegacyFiles(cwd)) {
    warn('Legacy state', 'config.json or root loop.json detected — run `oma doctor --migrate`');
  }

  blank();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferPhase(cwd) {
  if (!exists(resolveRequirementsPath(cwd)))
    return { current: 'pre-requirement', next: 'run $requirement to begin' };

  const trackId = getDefaultTrackId(cwd) || 'default';
  const designDir = resolveTrackDesignDir(cwd, trackId);
  const designs = exists(designDir)
    ? fs.readdirSync(designDir).filter((f) => f.endsWith('.md'))
    : [];
  if (!designs.length)
    return { current: 'requirement ✓', next: 'run $loop (design)' };

  if (!exists(OMA.implChecklist(cwd)))
    return { current: 'design ✓', next: 'run $loop (implement)' };

  const text      = readText(OMA.implChecklist(cwd)) || '';
  const unchecked = (text.match(/- \[ \]/g) || []).length;
  if (unchecked > 0)
    return { current: 'implement (in progress)', next: `${unchecked} checklist item(s) remaining` };

  const trainRuns = listAllResults(cwd, { phase: 'train', status: 'completed' });
  if (!trainRuns.length)
    return { current: 'implement ✓', next: 'run $train' };

  if (!hasTuneSweep(cwd, trackId))
    return { current: 'train ✓', next: 'run $tune to improve' };

  if (!exists(OMA.best(cwd)))
    return { current: 'tune ✓', next: 'run $tune Phase 5 (final eval)' };

  const best = readJSON(OMA.best(cwd));
  if (!best?.deploy_gate_open)
    return { current: 'evaluate ✓ (gate closed)', next: 'thresholds not met — continue $tune or revisit $design' };

  if (!exists(require('path').join(cwd, 'deploy', 'deploy-checklist.md')))
    return { current: 'evaluate ✓ (gate OPEN)', next: 'run $deploy' };

  return { current: 'deployed ✓', next: 'done' };
}

function countTableRows(text, sectionTitle) {
  // Find the section, count non-header, non-separator, non-empty table rows
  const re = new RegExp(`## ${sectionTitle}[\\s\\S]*?(?=## |$)`);
  const match = text.match(re);
  if (!match) return 0;
  const rows = match[0]
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.includes('---') && !l.match(/^\|\s*(Direction|Pattern|Hypothesis|Item|\#)/));
  // Subtract empty/placeholder rows
  return rows.filter((l) => !l.includes('_(empty')).length;
}

function statusIcon(status) {
  if (!status) return color.gray('?');
  if (status === 'completed') return color.green('✓ completed');
  if (status === 'running')   return color.yellow('… running');
  if (status === 'failed')    return color.red('✗ failed');
  if (status === 'lost')      return color.red('? lost');
  return color.yellow(status);
}

module.exports = { status };
