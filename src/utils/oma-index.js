'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON, nextExpId, templatePath } = require('./paths');
const { removeLegacyOmaSkills } = require('./skills-install');

const TRACK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SCHEMA_VERSION = '2.1';

function indexPath(cwd) {
  return OMA.index(cwd);
}

function tracksDir(cwd) {
  return OMA.tracks(cwd);
}

function trackDir(cwd, trackId) {
  return OMA.track(cwd, trackId);
}

function trackLoopPath(cwd, trackId) {
  return OMA.trackLoop(cwd, trackId);
}

function trackRef(trackId) {
  return `tracks/${trackId}`;
}

function legacyConfigPath(cwd) {
  return path.join(OMA.dir(cwd), 'config.json');
}

function legacyLoopPath(cwd) {
  return path.join(OMA.dir(cwd), 'loop.json');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function defaultIndex(cwd) {
  return {
    schema_version : SCHEMA_VERSION,
    last_updated   : todayISO(),
    meta           : {
      project_name      : path.basename(cwd),
      created_at        : nowISO(),
      robots            : [],
      platforms         : ['gradmotion'],
      owners            : [],
      paradigms         : [],
      total_experiments : 0,
      metric            : { name: null, higher_is_better: true },
      robot             : { model: null, sim_env: null, control_hz: null },
      gradmotion        : {
        projectId    : null,
        goodsId      : null,
        imageId      : null,
        imageVersion : null,
      },
      seeds_per_config: 3,
    },
    active_tracks  : [],
    closed_tracks  : [],
    default_track  : null,
    experiences_dir: null,
    reference_skills: {},
    lessons_index  : 'lessons_index.json',
    router         : 'ROUTER.md',
  };
}

function normalizeTrackEntry(entry) {
  if (!entry || !entry.track_id) return entry;
  if (!entry.track_ref) entry.track_ref = trackRef(entry.track_id);
  if (!entry.target_ref || entry.target_ref === 'requirements.md') {
    entry.target_ref = 'requirement/requirements.md';
  }
  return entry;
}

function normalizeIndex(index) {
  if (!index) return index;
  index.active_tracks = (index.active_tracks || []).map(normalizeTrackEntry);
  index.closed_tracks = (index.closed_tracks || []).map(normalizeTrackEntry);
  return index;
}

function readIndex(cwd) {
  const p = indexPath(cwd);
  if (!exists(p)) return null;
  return normalizeIndex(readJSON(p));
}

function writeIndex(cwd, index) {
  index.schema_version = SCHEMA_VERSION;
  index.last_updated = todayISO();
  index.active_tracks = (index.active_tracks || []).map(normalizeTrackEntry);
  index.closed_tracks = (index.closed_tracks || []).map(normalizeTrackEntry);
  fs.mkdirSync(OMA.dir(cwd), { recursive: true });
  fs.writeFileSync(indexPath(cwd), JSON.stringify(index, null, 2) + '\n');
}

function ensureIndex(cwd) {
  let index = readIndex(cwd);
  if (!index) {
    index = defaultIndex(cwd);
    writeIndex(cwd, index);
  }
  return index;
}

function validateTrackId(trackId) {
  if (!trackId || !TRACK_ID_RE.test(trackId)) {
    throw new Error(
      `Invalid track_id "${trackId}". Use lowercase letters, digits, and hyphens (e.g. gait-clock).`
    );
  }
}

function trackLoopRel(trackId) {
  return `${trackRef(trackId)}/loop.json`;
}

function findActiveTrack(index, trackId) {
  return (index.active_tracks || []).find((t) => t.track_id === trackId) || null;
}

function getDefaultTrackId(cwd) {
  const index = readIndex(cwd);
  if (!index) return null;
  if (index.default_track) return index.default_track;
  const active = index.active_tracks || [];
  return active.length ? active[0].track_id : null;
}

function resolveTrackId(cwd, trackId) {
  const id = trackId || getDefaultTrackId(cwd);
  if (!id) {
    throw new Error('No active track. Run `oma track open <track-id>` first.');
  }
  return id;
}

function getMeta(cwd) {
  const index = readIndex(cwd);
  if (index && index.meta) return index.meta;

  const legacy = readJSON(legacyConfigPath(cwd));
  if (legacy) {
    return {
      project_name      : legacy.project_name,
      created_at        : legacy.created_at,
      robots            : [],
      platforms         : ['gradmotion'],
      owners            : [],
      paradigms         : [],
      total_experiments : 0,
      metric            : {
        name             : legacy.metric_name || null,
        higher_is_better : legacy.metric_higher_is_better !== false,
      },
      robot: legacy.robot || { model: null, sim_env: null, control_hz: null },
      gradmotion        : legacy.gradmotion || {},
      seeds_per_config  : legacy.seeds_per_config ?? 3,
    };
  }
  return defaultIndex(cwd).meta;
}

function updateMeta(cwd, partial) {
  const index = ensureIndex(cwd);
  index.meta = { ...index.meta, ...partial };
  writeIndex(cwd, index);
  return index.meta;
}

function initTrackLayout(cwd, trackId) {
  fs.mkdirSync(OMA.track(cwd, trackId), { recursive: true });
  fs.mkdirSync(OMA.trackDesignDir(cwd, trackId), { recursive: true });
  fs.mkdirSync(OMA.trackExperiments(cwd, trackId), { recursive: true });

  const memoryPath = OMA.trackMemory(cwd, trackId);
  if (!exists(memoryPath)) {
    const tpl = templatePath('memory.md');
    if (exists(tpl)) {
      fs.copyFileSync(tpl, memoryPath);
    } else {
      fs.writeFileSync(memoryPath, `# Track Memory — ${trackId}\n_Last updated: ${todayISO()}_\n\n## Dead Ends\n| Direction | Why Failed | Seeds Tested | Evidence Experiments | Date Added |\n|-----------|-----------|-------------|---------------------|-----------|\n\n## Working Patterns\n| Pattern | Conditions | Median Gain | Evidence Experiments | Date Added |\n|---------|-----------|------------|---------------------|-----------|\n\n## Open Hypotheses\n| Hypothesis | Source | Priority | Estimated Gain | Status |\n|-----------|--------|----------|---------------|--------|\n`);
    }
  }

  const expIdxPath = OMA.trackExperimentsIndex(cwd, trackId);
  if (!exists(expIdxPath)) {
    const tpl = readJSON(templatePath('experiments-index.json')) || {
      schema_version   : '2.0',
      track_id         : trackId,
      last_updated     : todayISO(),
      metric_name      : null,
      higher_is_better : true,
      experiments      : [],
    };
    tpl.track_id = trackId;
    tpl.last_updated = todayISO();
    fs.writeFileSync(expIdxPath, JSON.stringify(tpl, null, 2) + '\n');
  }
}

function readTrackLoop(cwd, trackId) {
  const id = resolveTrackId(cwd, trackId);
  const loopPath = trackLoopPath(cwd, id);
  if (exists(loopPath)) {
    const loop = readJSON(loopPath);
    if (loop) return { trackId: id, loop };
  }

  const legacy = readJSON(legacyLoopPath(cwd));
  if (legacy && !trackId) {
    return { trackId: id, loop: legacy };
  }
  return { trackId: id, loop: null };
}

function writeTrackLoop(cwd, loop, trackId) {
  const id = resolveTrackId(cwd, trackId);
  loop.track_id = id;
  loop.updated_at = nowISO();
  initTrackLayout(cwd, id);
  fs.writeFileSync(trackLoopPath(cwd, id), JSON.stringify(loop, null, 2) + '\n');
  return loop;
}

function openTrack(cwd, { trackId, label, owner, paradigm, targetRef }) {
  validateTrackId(trackId);
  const index = ensureIndex(cwd);

  if (findActiveTrack(index, trackId)) {
    throw new Error(`Track "${trackId}" is already active.`);
  }
  const closed = (index.closed_tracks || []).find((t) => t.track_id === trackId);
  if (closed) {
    throw new Error(`Track "${trackId}" is closed. Re-open requires a new track_id or manual archive edit.`);
  }

  initTrackLayout(cwd, trackId);

  const entry = {
    track_id       : trackId,
    track_ref      : trackRef(trackId),
    label          : label || trackId,
    owner          : owner || null,
    started        : todayISO(),
    target_ref     : targetRef || 'requirement/requirements.md',
    status_summary : null,
    next_milestone : null,
  };

  index.active_tracks = index.active_tracks || [];
  index.active_tracks.push(entry);

  const paradigms = new Set(index.meta.paradigms || []);
  paradigms.add(paradigm || label || trackId);
  index.meta.paradigms = [...paradigms];

  if (!index.default_track) index.default_track = trackId;

  writeIndex(cwd, index);
  return entry;
}

function closeTrack(cwd, trackId, { deliverable } = {}) {
  const index = ensureIndex(cwd);
  const active = index.active_tracks || [];
  const idx = active.findIndex((t) => t.track_id === trackId);
  if (idx === -1) throw new Error(`Active track "${trackId}" not found.`);

  const [entry] = active.splice(idx, 1);
  index.active_tracks = active;

  index.closed_tracks = index.closed_tracks || [];
  index.closed_tracks.push({
    track_id    : entry.track_id,
    track_ref   : entry.track_ref || trackRef(entry.track_id),
    label       : entry.label,
    closed      : todayISO(),
    deliverable : deliverable || null,
  });

  if (index.default_track === trackId) {
    index.default_track = active.length ? active[0].track_id : null;
  }

  writeIndex(cwd, index);
  return entry;
}

function switchTrack(cwd, trackId) {
  const index = ensureIndex(cwd);
  if (!findActiveTrack(index, trackId)) {
    throw new Error(`Track "${trackId}" is not active. Run \`oma track open ${trackId}\` first.`);
  }
  index.default_track = trackId;
  writeIndex(cwd, index);
  return trackId;
}

function ensureDefaultTrack(cwd, { trackId = 'default', label = 'default', reason = '' } = {}) {
  const index = ensureIndex(cwd);
  if ((index.active_tracks || []).length === 0) {
    openTrack(cwd, { trackId, label, paradigm: label });
  }
  const id = getDefaultTrackId(cwd);
  initTrackLayout(cwd, id);
  let { loop } = readTrackLoop(cwd, id);
  if (!loop) {
    loop = {
      lap         : 1,
      stage       : 'design',
      exp_id      : nextExpId(cwd),
      hypothesis  : reason || null,
      design_ref  : null,
      opened_at   : nowISO(),
      updated_at  : nowISO(),
    };
    writeTrackLoop(cwd, loop, id);
  }
  return { trackId: id, loop, index: readIndex(cwd) };
}

function initLoopForTrack(cwd, { trackId, startStage = 'design', reason = '', resume = true } = {}) {
  const { trackId: id } = ensureDefaultTrack(cwd, { trackId: trackId || getDefaultTrackId(cwd), reason });
  const loopPath = trackLoopPath(cwd, id);
  const now = nowISO();
  let loop;
  let resumed = false;

  if (resume && exists(loopPath)) {
    loop = readJSON(loopPath) || {};
    loop.stage = startStage;
    loop.updated_at = now;
    resumed = true;
  } else {
    loop = {
      lap        : 1,
      stage      : startStage,
      exp_id     : nextExpId(cwd),
      hypothesis : reason || null,
      design_ref : null,
      opened_at  : now,
      updated_at : now,
    };
  }
  writeTrackLoop(cwd, loop, id);
  return { trackId: id, loop, resumed };
}

function moveDirContents(srcDir, destDir) {
  if (!exists(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let moved = 0;
  for (const name of fs.readdirSync(srcDir)) {
    const sp = path.join(srcDir, name);
    const dp = path.join(destDir, name);
    if (exists(dp)) continue;
    fs.renameSync(sp, dp);
    moved++;
  }
  return moved;
}

function migrateLegacy(cwd) {
  const changes = [];
  const index = ensureIndex(cwd);

  const legacyCfg = readJSON(legacyConfigPath(cwd));
  if (legacyCfg) {
    const m = index.meta;
    if (!m.project_name && legacyCfg.project_name) m.project_name = legacyCfg.project_name;
    if (!m.created_at && legacyCfg.created_at) m.created_at = legacyCfg.created_at;
    if (legacyCfg.metric_higher_is_better != null) {
      m.metric = m.metric || {};
      m.metric.higher_is_better = legacyCfg.metric_higher_is_better !== false;
    }
    if (legacyCfg.gradmotion) m.gradmotion = { ...m.gradmotion, ...legacyCfg.gradmotion };
    if (legacyCfg.seeds_per_config != null) m.seeds_per_config = legacyCfg.seeds_per_config;
    if (legacyCfg.robot) m.robot = { ...m.robot, ...legacyCfg.robot };
    writeIndex(cwd, index);
    changes.push('merged config.json → index.meta');
  }

  const legacyLoop = readJSON(legacyLoopPath(cwd));
  if (legacyLoop && (index.active_tracks || []).length === 0) {
    openTrack(cwd, { trackId: 'default', label: 'default (migrated)', paradigm: 'migrated' });
    writeTrackLoop(cwd, legacyLoop, 'default');
    changes.push('moved loop.json → tracks/default/loop.json');
  } else if (legacyLoop && !exists(trackLoopPath(cwd, 'default'))) {
    initTrackLayout(cwd, 'default');
    writeTrackLoop(cwd, legacyLoop, 'default');
    changes.push('copied loop.json → tracks/default/loop.json');
  }

  return changes;
}

function collectTrackIdsForMigration(cwd, index) {
  const ids = new Set();
  for (const t of [...(index.active_tracks || []), ...(index.closed_tracks || [])]) {
    if (t.track_id) ids.add(t.track_id);
  }
  if (exists(OMA.tracks(cwd))) {
    for (const name of fs.readdirSync(OMA.tracks(cwd))) {
      const p = path.join(OMA.tracks(cwd), name);
      try {
        if (fs.statSync(p).isDirectory()) ids.add(name);
      } catch { /* skip */ }
    }
  }
  if (exists(OMA.legacyExperimentsRoot(cwd))) {
    for (const name of fs.readdirSync(OMA.legacyExperimentsRoot(cwd))) {
      const p = path.join(OMA.legacyExperimentsRoot(cwd), name);
      try {
        if (fs.statSync(p).isDirectory() && !name.startsWith('exp-')) ids.add(name);
      } catch { /* skip */ }
    }
  }
  if (!ids.size) ids.add('default');
  return [...ids];
}

function migrateLayout(cwd) {
  const changes = [];
  let index = ensureIndex(cwd);

  fs.mkdirSync(OMA.requirement(cwd), { recursive: true });

  if (exists(OMA.legacyRequirements(cwd)) && !exists(OMA.requirements(cwd))) {
    fs.renameSync(OMA.legacyRequirements(cwd), OMA.requirements(cwd));
    changes.push('requirements.md → requirement/requirements.md');
  }
  if (exists(OMA.legacyKnowledge(cwd)) && !exists(OMA.knowledge(cwd))) {
    fs.renameSync(OMA.legacyKnowledge(cwd), OMA.knowledge(cwd));
    changes.push('knowledge.md → requirement/knowledge.md');
  }
  if (exists(OMA.legacyPaper(cwd)) && !exists(OMA.paper(cwd))) {
    fs.renameSync(OMA.legacyPaper(cwd), OMA.paper(cwd));
    changes.push('paper/ → requirement/paper/');
  }

  if (exists(OMA.legacyReference(cwd)) || exists(OMA.legacyOmaReference(cwd))) {
    const legacyDir = exists(OMA.legacyOmaReference(cwd)) ? OMA.legacyOmaReference(cwd) : OMA.legacyReference(cwd);
    changes.push(`removed legacy ${path.relative(OMA.dir(cwd), legacyDir)} (skills now in agent platform dir)`);
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }

  if (exists(OMA.legacyOmaSkills(cwd))) {
    fs.rmSync(OMA.legacyOmaSkills(cwd), { recursive: true, force: true });
    changes.push('removed legacy .oma/skills/ (skills now in agent platform dir)');
  }

  removeLegacyOmaSkills(cwd);

  const defaultTrack = getDefaultTrackId(cwd) || 'default';
  const trackIds = collectTrackIdsForMigration(cwd, index);

  for (const trackId of trackIds) {
    initTrackLayout(cwd, trackId);

    const n = moveDirContents(
      OMA.legacyTrackExperiments(cwd, trackId),
      OMA.trackExperiments(cwd, trackId)
    );
    if (n) changes.push(`experiments/${trackId}/ → tracks/${trackId}/experiments/ (${n} dirs)`);
  }

  if (exists(OMA.legacyExperimentsRoot(cwd))) {
    const dest = OMA.trackExperiments(cwd, defaultTrack);
    for (const name of fs.readdirSync(OMA.legacyExperimentsRoot(cwd))) {
      if (!name.startsWith('exp-')) continue;
      const sp = path.join(OMA.legacyExperimentsRoot(cwd), name);
      const dp = path.join(dest, name);
      if (!exists(dp)) {
        fs.renameSync(sp, dp);
        changes.push(`experiments/${name} → tracks/${defaultTrack}/experiments/${name}`);
      }
    }
  }

  if (exists(OMA.legacyDesigns(cwd))) {
    const designDest = OMA.trackDesignDir(cwd, defaultTrack);
    fs.mkdirSync(designDest, { recursive: true });
    let copied = 0;
    for (const f of fs.readdirSync(OMA.legacyDesigns(cwd))) {
      if (!f.endsWith('.md')) continue;
      const dp = path.join(designDest, f);
      if (!exists(dp)) {
        fs.copyFileSync(path.join(OMA.legacyDesigns(cwd), f), dp);
        copied++;
      }
    }
    if (copied) changes.push(`designs/* → tracks/${defaultTrack}/design/ (${copied} files)`);
  }

  if (exists(OMA.legacyMemory(cwd)) && !exists(OMA.trackMemory(cwd, defaultTrack))) {
    fs.renameSync(OMA.legacyMemory(cwd), OMA.trackMemory(cwd, defaultTrack));
    changes.push(`memory.md → tracks/${defaultTrack}/memory.md`);
  }

  for (const entry of index.active_tracks || []) {
    normalizeTrackEntry(entry);
    delete entry.loop_ref;
    delete entry.experiments_ref;
  }
  for (const entry of index.closed_tracks || []) {
    normalizeTrackEntry(entry);
    delete entry.loop_ref;
    delete entry.experiments_ref;
  }

  // Re-register tracks found on disk if index lost them (e.g. after setup --force).
  if ((index.active_tracks || []).length === 0 && exists(OMA.tracks(cwd))) {
    for (const trackId of collectTrackIdsForMigration(cwd, index)) {
      if (!exists(trackDir(cwd, trackId))) continue;
      const closed = (index.closed_tracks || []).some((t) => t.track_id === trackId);
      if (closed) continue;
      try {
        openTrack(cwd, { trackId, label: trackId, paradigm: trackId });
        index = readIndex(cwd);
        changes.push(`re-registered track "${trackId}" from tracks/`);
      } catch { /* already active or invalid */ }
    }
  }

  if (exists(OMA.legacyRequirements(cwd)) && exists(OMA.requirements(cwd))) {
    fs.unlinkSync(OMA.legacyRequirements(cwd));
    changes.push('removed legacy root requirements.md');
  }
  if (exists(OMA.legacyKnowledge(cwd)) && exists(OMA.knowledge(cwd))) {
    fs.unlinkSync(OMA.legacyKnowledge(cwd));
    changes.push('removed legacy root knowledge.md');
  }

  if (index.reference_skills) {
    for (const [k, v] of Object.entries(index.reference_skills)) {
      if (typeof v === 'string') {
        index.reference_skills[k] = {
          platform: 'cursor',
          skill_key: v.includes('/') ? path.basename(v) : `reference-${k}`,
          path: v.replace(/reference-skills/g, 'reference'),
          migrated: true,
        };
      }
    }
  }

  writeIndex(cwd, index);
  if (changes.length) changes.push(`index.json → schema ${SCHEMA_VERSION}`);
  return changes;
}

function hasLegacyFiles(cwd) {
  return exists(legacyConfigPath(cwd))
    || exists(legacyLoopPath(cwd))
    || exists(OMA.legacyRequirements(cwd))
    || exists(OMA.legacyKnowledge(cwd))
    || exists(OMA.legacyPaper(cwd))
    || exists(OMA.legacyMemory(cwd))
    || exists(OMA.legacyDesigns(cwd))
    || exists(OMA.legacyOmaSkills(cwd))
    || exists(OMA.legacyOmaReference(cwd))
    || exists(OMA.legacyReference(cwd))
    || (exists(OMA.legacyExperimentsRoot(cwd)) && fs.readdirSync(OMA.legacyExperimentsRoot(cwd)).length > 0);
}

function needsLayoutMigration(cwd) {
  const index = readIndex(cwd);
  if (index && index.schema_version !== SCHEMA_VERSION) return true;
  return hasLegacyFiles(cwd);
}

function migrateAll(cwd) {
  const { migrateLegacyLeaderboard, migrateLegacyTrajectory } = require('./experiments');
  return [
    ...migrateLegacy(cwd),
    ...migrateLayout(cwd),
    ...migrateLegacyLeaderboard(cwd),
    ...migrateLegacyTrajectory(cwd),
  ];
}

module.exports = {
  TRACK_ID_RE,
  SCHEMA_VERSION,
  indexPath,
  tracksDir,
  trackDir,
  trackLoopPath,
  trackLoopRel,
  trackRef,
  legacyConfigPath,
  legacyLoopPath,
  defaultIndex,
  readIndex,
  writeIndex,
  ensureIndex,
  validateTrackId,
  getDefaultTrackId,
  resolveTrackId,
  getMeta,
  updateMeta,
  initTrackLayout,
  readTrackLoop,
  writeTrackLoop,
  openTrack,
  closeTrack,
  switchTrack,
  ensureDefaultTrack,
  initLoopForTrack,
  migrateLegacy,
  migrateLayout,
  migrateAll,
  hasLegacyFiles,
  needsLayoutMigration,
  normalizeTrackEntry,
};
