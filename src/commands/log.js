'use strict';

const { header, section, blank, log, info, table, color } = require('../utils/print');
const { listAllResults } = require('../utils/experiments');

async function logCmd({ cwd = process.cwd(), tail = 20, phase = null, verbose = false } = {}) {
  header('oma log — Experiment Results');

  const all = listAllResults(cwd, { phase: phase || undefined });
  if (!all.length) {
    info('No experiments yet', 'results.json appears when $train starts a GM task (status: running)');
    blank();
    return;
  }

  const shown = all.slice(0, tail);

  section(`Showing ${shown.length} of ${all.length} experiments (most recent first)`);
  blank();

  const rows = [
    ['started', 'track', 'exp-id', 'phase', 'metric (mean)', '± std', 'status'],
  ];

  for (const row of shown) {
    const e = row.results;
    const summary = e.summary || {};
    const ts = (e.started_at || e.startedAt || '').slice(0, 16).replace('T', ' ');
    const mean = summary.mean != null ? summary.mean.toFixed(4) : color.gray('—');
    const std = summary.std != null ? summary.std.toFixed(4) : color.gray('—');
    rows.push([
      color.gray(ts),
      color.gray(row.trackId),
      row.expId,
      phaseColor(e.phase),
      mean,
      std,
      statusChip(e.status),
    ]);
  }

  table(rows);

  if (verbose) {
    section('Full results.json entries');
    for (const row of shown) {
      blank();
      log('  ' + JSON.stringify(row.results, null, 2).split('\n').join('\n  '));
    }
  }

  section('Summary');
  const completed = all.filter((r) => r.results.status === 'completed');
  const failed = all.filter((r) => r.results.status === 'failed');
  const running = all.filter((r) => r.results.status === 'running');
  const byPhase = {};
  for (const row of all) {
    const ph = row.results.phase || '?';
    byPhase[ph] = (byPhase[ph] || 0) + 1;
  }

  info(
    `Total: ${color.bold(String(all.length))}  (${color.yellow(String(running.length))} running, ${color.green(String(completed.length))} completed, ${color.red(String(failed.length))} failed)`,
  );
  for (const [ph, cnt] of Object.entries(byPhase)) {
    info(`  ${phaseColor(ph)}: ${cnt}`);
  }

  const bestRow = completed
    .filter((r) => (r.results.summary?.mean ?? r.results.metric_mean) != null)
    .sort((a, b) => {
      const am = a.results.summary?.mean ?? a.results.metric_mean;
      const bm = b.results.summary?.mean ?? b.results.metric_mean;
      return bm - am;
    })[0];
  if (bestRow) {
    const mean = bestRow.results.summary?.mean ?? bestRow.results.metric_mean;
    info(
      `Best (val/train): ${color.green(mean.toFixed(4))}`,
      `${bestRow.results.summary?.metric_name || ''} — ${bestRow.expId}`,
    );
  }

  blank();
}

function phaseColor(phase) {
  const map = {
    train:    color.blue('train'),
    tune:     color.magenta('tune'),
    evaluate: color.cyan('evaluate'),
  };
  return map[phase] || color.gray(phase || '?');
}

function statusChip(status) {
  if (status === 'completed') return color.green('✓');
  if (status === 'running')   return color.yellow('…');
  if (status === 'failed')    return color.red('✗');
  if (status === 'lost')      return color.red('?');
  return color.gray(status || '?');
}

module.exports = { logCmd };
