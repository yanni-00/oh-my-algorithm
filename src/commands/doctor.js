'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON, readText, listAllExperimentDirs, resolveRequirementsPath, resolveKnowledgePath, resolvePaperDir, resolveTrackDesignDir, resolveTrackMemoryPath } = require('../utils/paths');
const {
  getDefaultTrackId,
  readTrackLoop,
  hasLegacyFiles,
  needsLayoutMigration,
  migrateAll,
} = require('../utils/oma-index');
const {
  getTuneRanking,
  hasCompletedTrainOrTune,
  findRunningExperiments,
  listAllResults,
} = require('../utils/experiments');
const { header, section, ok, warn, fail, info, blank, log, kv, color } = require('../utils/print');

const GATES = [
  {
    skill: '$requirement',
    artifact: '.oma/requirement/requirements.md',
    check: (cwd) => {
      const p = resolveRequirementsPath(cwd);
      if (!exists(p)) return { pass: false, detail: 'File missing — run $requirement to create it' };
      const text = readText(p);
      if (text && text.includes('{PROJECT_NAME}')) {
        return { pass: false, detail: 'Template not filled in — run $requirement' };
      }
      return { pass: true, detail: 'Exists' };
    },
  },
  {
    skill: '$design',
    artifact: 'tracks/{id}/design/',
    check: (cwd) => {
      const trackId = getDefaultTrackId(cwd) || 'default';
      const dir = resolveTrackDesignDir(cwd, trackId);
      if (!exists(dir)) return { pass: false, detail: 'design/ directory missing — run $loop (design)' };
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      if (!files.length) return { pass: false, detail: 'No design document found — run $loop (design)' };
      return { pass: true, detail: `${files.length} design doc(s) in tracks/${trackId}/design/` };
    },
  },
  {
    skill: '$implement',
    artifact: '.oma/impl/impl-checklist.md + github.json',
    check: (cwd) => {
      const checklistPath = OMA.implChecklist(cwd);
      const githubPath    = path.join(OMA.impl(cwd), 'github.json');

      if (!exists(checklistPath)) return { pass: false, detail: 'impl-checklist.md missing — run $implement' };

      const text      = readText(checklistPath);
      const unchecked = (text.match(/- \[ \]/g) || []).length;
      const checked   = (text.match(/- \[x\]/gi) || []).length;
      if (unchecked > 0) {
        return { pass: false, detail: `Checklist: ${unchecked} unchecked item(s), ${checked} done` };
      }

      if (!exists(githubPath)) {
        return { pass: false, detail: 'Code not yet pushed — run GitHub push step in $implement' };
      }
      const gh = readJSON(githubPath) || {};
      if (!gh.commitHash) {
        return { pass: false, detail: 'github.json exists but commitHash is missing' };
      }
      return { pass: true, detail: `All ${checked} items ✓ | pushed ${gh.commitHash.slice(0,7)} @ ${gh.branch}` };
    },
  },
  {
    skill: '$train',
    artifact: 'tracks/{id}/experiments/ (≥1 train run)',
    check: (cwd) => {
      const trainRuns = findExperimentsByPhase(cwd, 'train');
      if (!trainRuns.length) return { pass: false, detail: 'No train experiments found — run $train' };
      return { pass: true, detail: `${trainRuns.length} train run(s) found` };
    },
  },
  {
    skill: '$tune',
    artifact: 'tracks/{track}/experiments-index.json + best.json',
    check: (cwd) => {
      const trackId = getDefaultTrackId(cwd) || 'default';
      const bestPath = OMA.best(cwd);

      if (!hasCompletedTrainOrTune(cwd, trackId)) {
        return {
          pass: false,
          detail: `tracks/${trackId}/experiments-index.json empty — run $train or $tune`,
        };
      }

      const ranking = getTuneRanking(cwd, trackId);

      if (!exists(bestPath)) {
        return {
          pass: false,
          detail: `Sweep in progress (${ranking.entries.length} completed) — final evaluation not yet run ($tune Phase 5)`,
        };
      }
      const best = readJSON(bestPath);
      if (!best) return { pass: false, detail: 'best.json malformed' };

      const metricName = best.primaryMetric?.name ?? best.primary_metric?.name ?? '?';
      const metricMean = (best.primaryMetric?.mean ?? best.primary_metric?.mean)?.toFixed(4) ?? '?';
      const gateOpen   = best.deployGateOpen ?? best.deploy_gate_open;
      const gateLabel  = gateOpen ? color.green('deploy gate open') : color.red('deploy gate closed');

      return {
        pass  : gateOpen === true,
        detail: `${ranking.entries.length} experiments ranked | test ${metricName}: ${metricMean} | ${gateLabel}`,
      };
    },
  },
  {
    skill: '$deploy',
    artifact: 'deploy/deploy-checklist.md',
    check: (cwd) => {
      const bestPath = OMA.best(cwd);
      if (exists(bestPath)) {
        const best    = readJSON(bestPath) || {};
        const gateOpen = best.deployGateOpen ?? best.deploy_gate_open;
        if (gateOpen === false) {
          return { pass: false, detail: 'Deploy gate closed — test thresholds not met (see best.json)' };
        }
      }
      const p = path.join(cwd, 'deploy', 'deploy-checklist.md');
      if (!exists(p)) return { pass: false, detail: 'Not yet deployed — run $deploy' };
      const text      = readText(p);
      const unchecked = (text.match(/- \[ \]/g) || []).length;
      if (unchecked > 0) return { pass: false, detail: `${unchecked} deployment checklist item(s) incomplete` };
      return { pass: true, detail: 'Deployment checklist complete' };
    },
  },
];

async function doctor({ cwd = process.cwd(), migrate = false } = {}) {
  header('oma doctor — Gate Chain Status');

  section('Workspace');
  if (!exists(OMA.dir(cwd))) {
    fail('.oma/ directory', 'Not found — run `oma setup` first');
    blank();
    return;
  }
  ok('.oma/', 'Found');

  if (migrate) {
    section('Migration');
    const changes = migrateAll(cwd);
    if (changes.length) {
      for (const c of changes) ok('Migrated', c);
    } else {
      info('Nothing to migrate');
    }
    blank();
  } else if (hasLegacyFiles(cwd) || needsLayoutMigration(cwd)) {
    warn('Legacy layout', 'old paths or schema — run `oma doctor --migrate`');
  }

  const index = readJSON(OMA.index(cwd));
  if (index) {
    ok('.oma/index.json', `Dashboard — ${(index.active_tracks || []).length} active track(s) (schema ${index.schema_version || '?'})`);
    if (index.default_track) kv('  Default track', index.default_track);
  } else {
    warn('.oma/index.json', 'Missing — run `oma setup` or create from template');
  }

  const standalonePath = path.join(OMA.dir(cwd), 'standalone.json');
  if (exists(standalonePath)) {
    const s = readJSON(standalonePath) || {};
    warn(
      'Standalone mode',
      `ACTIVE — entered ${s.skill || s.stage || '?'} at ${(s.enteredAt || '').slice(0, 19).replace('T', ' ')} | gates are advisory`
    );
    log(color.gray(`    Reason: ${s.reason || 'not specified'}  |  Run 'oma go off' to return to gated mode.`));
    blank();
  }

  const defaultTrack = getDefaultTrackId(cwd);
  if (defaultTrack) {
    const memPath = resolveTrackMemoryPath(cwd, defaultTrack);
    if (exists(memPath)) {
      ok(`tracks/${defaultTrack}/memory.md`, 'Found (Dead Ends database active)');
    } else {
      warn(`tracks/${defaultTrack}/memory.md`, 'Missing — created by oma track open or $loop (consolidate)');
    }

    const { trackId, loop } = readTrackLoop(cwd, defaultTrack);
    if (loop) {
      ok(`tracks/${trackId}/loop.json`, `Iteration loop — lap #${loop.lap ?? '?'} @ ${loop.stage || '?'}${loop.exp_id ? ` (${loop.exp_id})` : ''}`);
    }
  } else if (exists(path.join(OMA.dir(cwd), 'loop.json'))) {
    const loop = readJSON(path.join(OMA.dir(cwd), 'loop.json')) || {};
    warn('.oma/loop.json', `Legacy root loop — lap #${loop.lap ?? '?'} — run oma doctor --migrate`);
  }

  section('Paper Extraction (requirement/paper/)');
  const paperDir      = resolvePaperDir(cwd);
  const paperSections = path.join(paperDir, 'raw-sections.json');
  const paperMeta     = path.join(paperDir, 'meta.json');
  const knowledgePath = resolveKnowledgePath(cwd);

  if (exists(paperSections)) {
    const meta = readJSON(paperMeta) || {};
    ok('raw-sections.json', 'Paper extracted');
    if (meta.title) kv('  Paper', meta.title.slice(0, 70));
    if (meta.year)  kv('  Year',  meta.year);
    if (meta.venue) kv('  Venue', meta.venue);

    const secs = readJSON(paperSections) || {};
    const found = Object.keys(secs).filter(
      (k) => k !== '_full' && typeof secs[k] === 'string' && secs[k].length > 100
    );
    kv('  Sections', found.join(', ') || 'none');
  } else {
    warn('No paper extracted yet', 'Run `oma extract --paper path.pdf` before $requirement');
    info('  Sections will need to be provided manually during the interview');
  }

  if (exists(knowledgePath)) {
    const kText = readText(knowledgePath) || '';
    const locked = kText.includes('Status: LOCKED');
    if (locked) {
      ok('requirement/knowledge.md', 'LOCKED — literature context active');
    } else {
      warn('requirement/knowledge.md', 'Exists but not yet locked (in-progress $requirement)');
    }
  } else {
    info('requirement/knowledge.md', 'Not yet created — will be produced by $requirement');
  }

  section('Reference Codebase (.oma/codebase/)');
  const { listTrackCodebases, resolveTrackSrcPath } = require('../utils/codebase');
  const codebaseConfig = path.join(OMA.dir(cwd), 'codebase', 'config.json');

  if (exists(codebaseConfig)) {
    const rows = listTrackCodebases(cwd);
    ok('Registered', `Path A (Adapt) — ${rows.length} track mapping(s)`);
    for (const row of rows) {
      const tag = row.trackId === getDefaultTrackId(cwd) ? ' (default)' : '';
      kv(`  ${row.trackId || 'legacy'}${tag}`, row.srcPath || '?');
      if (row.primaryLang) kv('    language', row.primaryLang);
    }
    const active = resolveTrackSrcPath(cwd);
    if (active) kv('  Active srcPath', active);
  } else {
    info('No codebase registered', 'Run `oma index --src <repo-path>` to enable Path A implement');
    info('  Without this, $implement will use Path B (from scratch)');
  }

  section('Gates (2 hard) + Iteration Loop');
  blank();

  const LOOP_SKILLS = new Set(['$design', '$implement', '$train', '$tune']);
  let reqLocked = false;
  let deployGateOpen = false;
  for (const gate of GATES) {
    const { pass, detail } = gate.check(cwd);
    const tag = gate.skill === '$requirement' ? ' [HARD · enter loop]'
              : gate.skill === '$deploy'      ? ' [HARD · exit loop]'
              :                                  ' [loop · advisory]';
    if (pass) {
      ok(`${gate.skill}${tag}`, detail);
    } else if (LOOP_SKILLS.has(gate.skill)) {
      warn(`${gate.skill}${tag}`, `${detail}  — advisory; re-enter any time`);
    } else {
      fail(`${gate.skill}${tag}`, detail);
    }
    if (gate.skill === '$requirement') reqLocked = pass;
    if (gate.skill === '$tune')        deployGateOpen = pass;
  }

  section('Experiment Runs');
  const running = findRunningExperiments(cwd);
  const all = listAllResults(cwd);
  if (all.length) {
    info('Total results.json', String(all.length));
    info('Running', String(running.length));
    const phases = {};
    for (const row of all) {
      const ph = row.results.phase || '?';
      phases[ph] = (phases[ph] || 0) + 1;
    }
    for (const [phase, count] of Object.entries(phases)) {
      info(`  ${phase}`, String(count));
    }
  } else {
    info('No experiments yet', 'results.json appears when $train starts a GM task');
  }

  section('Project Meta');
  const { getMeta } = require('../utils/oma-index');
  const meta = getMeta(cwd);
  if (meta) {
    kv('Project', meta.project_name || '—');
    kv('Seeds per config', String(meta.seeds_per_config ?? '—'));
    if (meta.metric?.name) kv('Metric', meta.metric.name);
  }

  blank();
  if (exists(standalonePath)) {
    const s = readJSON(standalonePath) || {};
    log(color.yellow(`  ⚠️  Standalone mode active — targeting ${color.bold(s.skill || s.stage || '?')}. Gates advisory.`));
  } else if (!reqLocked) {
    log(color.yellow(`  Lock requirements: run ${color.bold('$requirement')} to enter the iteration loop.`));
  } else if (!deployGateOpen) {
    log(color.green('  Loop open.') + ` iterate ${color.bold('$loop (design ↔ implement ↔ train ↔ tune)')} freely — no interior gates.`);
    log(color.gray('  Exit to $deploy when best.json deployGateOpen === true (set in $tune Phase 5).'));
  } else {
    log(color.green('  Deploy gate OPEN — ready for $deploy.'));
  }
  blank();
}

function findExperimentsByPhase(cwd, phase) {
  const found = [];
  for (const { path: expPath, label } of listAllExperimentDirs(cwd)) {
    const resultsPath = path.join(expPath, 'results.json');
    if (!exists(resultsPath)) continue;
    const r = readJSON(resultsPath);
    if (r && r.phase === phase) found.push(label);
  }
  return found;
}

module.exports = { doctor };
