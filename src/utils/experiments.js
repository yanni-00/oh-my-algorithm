'use strict';

const fs   = require('fs');
const path = require('path');
const {
  OMA, exists, readJSON, templatePath, listAllExperimentDirs, resolveExperimentDir, listTrackIds,
} = require('./paths');
const { getDefaultTrackId } = require('./oma-index');

const INDEX_SCHEMA = '2.0';

function resultsPath(cwd, trackId, expId) {
  return path.join(resolveExperimentDir(cwd, trackId, expId), 'results.json');
}

function readResults(cwd, trackId, expId) {
  const p = resultsPath(cwd, trackId, expId);
  if (!exists(p)) return null;
  return readJSON(p);
}

function writeResults(cwd, trackId, expId, data) {
  const dir = resolveExperimentDir(cwd, trackId, expId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function readExperimentsIndex(cwd, trackId) {
  const id = trackId || getDefaultTrackId(cwd) || 'default';
  const p = OMA.trackExperimentsIndex(cwd, id);
  if (!exists(p)) {
    return {
      schema_version : INDEX_SCHEMA,
      track_id       : id,
      last_updated   : null,
      metric_name    : null,
      higher_is_better: true,
      experiments    : [],
    };
  }
  const raw = readJSON(p) || {};
  return normalizeExperimentsIndex(raw, id);
}

function normalizeExperimentsIndex(index, trackId) {
  const base = index || {};
  if (!base.experiments) base.experiments = [];
  base.schema_version = INDEX_SCHEMA;
  base.track_id = base.track_id || trackId;
  if (base.higher_is_better == null) base.higher_is_better = true;
  return base;
}

function writeExperimentsIndex(cwd, trackId, index) {
  const id = trackId || getDefaultTrackId(cwd) || 'default';
  const normalized = normalizeExperimentsIndex(index, id);
  normalized.last_updated = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(OMA.track(cwd, id), { recursive: true });
  fs.writeFileSync(OMA.trackExperimentsIndex(cwd, id), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function indexEntryFromResults(results, trackId) {
  if (!results) return null;
  const summary = results.summary || {};
  return {
    exp_id           : results.exp_id || results.expId,
    track_id         : trackId,
    lap              : results.lap ?? null,
    phase            : results.phase || null,
    status           : results.status || null,
    started_at       : results.started_at || results.startedAt || null,
    completed_at     : results.completed_at || results.completedAt || null,
    gm_task_id       : results.gm_task_id || results.gmTaskId || null,
    metric_name      : summary.metric_name || results.metric_name || null,
    metric_mean      : summary.mean ?? results.metric_mean ?? null,
    metric_std       : summary.std ?? results.metric_std ?? null,
    higher_is_better : summary.higher_is_better ?? results.higher_is_better ?? true,
    config_summary   : results.config_summary || results.configSummary || null,
    design_ref       : results.design_ref || results.designRef || null,
  };
}

function upsertExperimentsIndexFromResults(cwd, trackId, results) {
  const entry = indexEntryFromResults(results, trackId);
  if (!entry?.exp_id) return null;

  const index = readExperimentsIndex(cwd, trackId);
  if (entry.metric_name && !index.metric_name) index.metric_name = entry.metric_name;
  if (entry.higher_is_better != null) index.higher_is_better = entry.higher_is_better;

  const pos = index.experiments.findIndex((e) => e.exp_id === entry.exp_id);
  if (pos >= 0) index.experiments[pos] = { ...index.experiments[pos], ...entry };
  else index.experiments.push(entry);

  sortExperimentsIndex(index);
  return writeExperimentsIndex(cwd, trackId, index);
}

function sortExperimentsIndex(index) {
  const higher = index.higher_is_better !== false;
  index.experiments.sort((a, b) => {
    const am = a.metric_mean;
    const bm = b.metric_mean;
    if (am == null && bm == null) return 0;
    if (am == null) return 1;
    if (bm == null) return -1;
    return higher ? bm - am : am - bm;
  });
}

function listAllResults(cwd, { trackId = null, phase = null, status = null } = {}) {
  const rows = [];
  const trackIds = trackId ? [trackId] : listTrackIds(cwd);

  for (const tid of trackIds) {
    const expRoot = OMA.trackExperiments(cwd, tid);
    if (!exists(expRoot)) continue;
    for (const name of fs.readdirSync(expRoot)) {
      if (!name.startsWith('exp-')) continue;
      const p = path.join(expRoot, name, 'results.json');
      if (!exists(p)) continue;
      const r = readJSON(p);
      if (!r) continue;
      if (phase && r.phase !== phase) continue;
      if (status && r.status !== status) continue;
      rows.push({
        trackId : tid,
        expId   : name,
        path    : p,
        results : r,
        sortTs  : r.completed_at || r.started_at || r.startedAt || '',
      });
    }
  }

  rows.sort((a, b) => String(b.sortTs).localeCompare(String(a.sortTs)));
  return rows;
}

function findRunningExperiments(cwd) {
  return listAllResults(cwd, { status: 'running' });
}

function getTuneRanking(cwd, trackId) {
  const index = readExperimentsIndex(cwd, trackId);
  const entries = index.experiments.filter(
    (e) => e.status === 'completed' && e.metric_mean != null && (e.phase === 'tune' || e.phase === 'train'),
  );
  return {
    track_id         : index.track_id,
    metric_name      : index.metric_name || '?',
    higher_is_better : index.higher_is_better !== false,
    entries,
  };
}

function hasCompletedTrainOrTune(cwd, trackId) {
  const ranking = getTuneRanking(cwd, trackId);
  return ranking.entries.length > 0;
}

function hasTuneSweep(cwd, trackId) {
  const index = readExperimentsIndex(cwd, trackId);
  return index.experiments.some((e) => e.phase === 'tune' && e.status === 'completed');
}

function triedConfigKeys(cwd, trackId) {
  const index = readExperimentsIndex(cwd, trackId);
  return new Set(
    index.experiments
      .map((e) => e.config_summary)
      .filter(Boolean),
  );
}

function migrateLegacyLeaderboard(cwd) {
  const changes = [];
  const lbPath = path.join(OMA.dir(cwd), 'leaderboard.json');
  if (!exists(lbPath)) return changes;

  const lb = readJSON(lbPath) || {};
  const trackId = getDefaultTrackId(cwd) || 'default';
  const index = readExperimentsIndex(cwd, trackId);

  if (lb.metric_name) index.metric_name = lb.metric_name;
  if (lb.higher_is_better != null) index.higher_is_better = lb.higher_is_better;

  for (const e of lb.entries || []) {
    const expId = e.exp_id || e.expId;
    if (!expId) continue;
    const entry = {
      exp_id         : expId,
      track_id       : trackId,
      phase          : e.phase || 'tune',
      status         : 'completed',
      metric_name    : lb.metric_name || null,
      metric_mean    : e.metric_mean ?? null,
      metric_std     : e.metric_std ?? null,
      config_summary : e.config_summary || null,
      higher_is_better: lb.higher_is_better !== false,
    };
    const pos = index.experiments.findIndex((x) => x.exp_id === expId);
    if (pos >= 0) index.experiments[pos] = { ...index.experiments[pos], ...entry };
    else index.experiments.push(entry);
  }

  sortExperimentsIndex(index);
  writeExperimentsIndex(cwd, trackId, index);
  changes.push(`merged leaderboard.json → tracks/${trackId}/experiments-index.json`);

  try {
    fs.unlinkSync(lbPath);
    changes.push('removed legacy leaderboard.json');
  } catch { /* skip */ }

  return changes;
}

function migrateLegacyTrajectory(cwd) {
  const changes = [];
  const trajPath = path.join(OMA.dir(cwd), 'trajectory.jsonl');
  if (!exists(trajPath)) return changes;

  changes.push('deprecated trajectory.jsonl — use tracks/*/experiments/*/results.json (status: running|completed|failed)');
  try {
    fs.unlinkSync(trajPath);
    changes.push('removed legacy trajectory.jsonl');
  } catch { /* skip */ }

  return changes;
}

function initExperimentsIndexTemplate(trackId) {
  const tpl = readJSON(templatePath('experiments-index.json'));
  if (tpl) {
    tpl.track_id = trackId;
    tpl.last_updated = new Date().toISOString().slice(0, 10);
    return tpl;
  }
  return {
    schema_version  : INDEX_SCHEMA,
    track_id        : trackId,
    last_updated    : new Date().toISOString().slice(0, 10),
    metric_name     : null,
    higher_is_better: true,
    experiments     : [],
  };
}

module.exports = {
  INDEX_SCHEMA,
  readResults,
  writeResults,
  readExperimentsIndex,
  writeExperimentsIndex,
  upsertExperimentsIndexFromResults,
  indexEntryFromResults,
  listAllResults,
  findRunningExperiments,
  getTuneRanking,
  hasCompletedTrainOrTune,
  hasTuneSweep,
  triedConfigKeys,
  migrateLegacyLeaderboard,
  migrateLegacyTrajectory,
  initExperimentsIndexTemplate,
  migrateLegacyLeaderboard,
  migrateLegacyTrajectory,
};
