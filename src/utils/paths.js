'use strict';

const path = require('path');
const fs   = require('fs');

function omaDir(cwd = process.cwd()) {
  return path.join(cwd, '.oma');
}

const OMA = {
  dir:                    (cwd) => omaDir(cwd),
  index:                  (cwd) => path.join(omaDir(cwd), 'index.json'),

  // ── Requirement zone (hard gate in) ───────────────────────────────────────
  requirement:            (cwd) => path.join(omaDir(cwd), 'requirement'),
  requirements:           (cwd) => path.join(omaDir(cwd), 'requirement', 'requirements.md'),
  knowledge:              (cwd) => path.join(omaDir(cwd), 'requirement', 'knowledge.md'),
  paper:                  (cwd) => path.join(omaDir(cwd), 'requirement', 'paper'),

  // ── Tracks (one folder per design paradigm) ───────────────────────────────
  tracks:                 (cwd) => path.join(omaDir(cwd), 'tracks'),
  track:                  (cwd, trackId) => path.join(omaDir(cwd), 'tracks', trackId),
  trackLoop:              (cwd, trackId) => path.join(omaDir(cwd), 'tracks', trackId, 'loop.json'),
  trackMemory:            (cwd, trackId) => path.join(omaDir(cwd), 'tracks', trackId, 'memory.md'),
  trackExperimentsIndex:  (cwd, trackId) => path.join(omaDir(cwd), 'tracks', trackId, 'experiments-index.json'),
  trackDesignDir:         (cwd, trackId) => path.join(omaDir(cwd), 'tracks', trackId, 'design'),
  trackExperiments:       (cwd, trackId) => path.join(omaDir(cwd), 'tracks', trackId, 'experiments'),
  trackExperiment:        (cwd, trackId, expId) => path.join(omaDir(cwd), 'tracks', trackId, 'experiments', expId),

  // ── Project-level loop artifacts ─────────────────────────────────────────
  impl:                   (cwd) => path.join(omaDir(cwd), 'impl'),
  implChecklist:          (cwd) => path.join(omaDir(cwd), 'impl', 'impl-checklist.md'),
  best:                   (cwd) => path.join(omaDir(cwd), 'best.json'),

  // ── Optional reference skills: installed to agent platform dir only ─────
  // (no .oma/reference/ — see skills-install.js)
  legacyRequirements:     (cwd) => path.join(omaDir(cwd), 'requirements.md'),
  legacyKnowledge:        (cwd) => path.join(omaDir(cwd), 'knowledge.md'),
  legacyPaper:            (cwd) => path.join(omaDir(cwd), 'paper'),
  legacyMemory:           (cwd) => path.join(omaDir(cwd), 'memory.md'),
  legacyDesigns:          (cwd) => path.join(omaDir(cwd), 'designs'),
  legacyExperimentsRoot:  (cwd) => path.join(omaDir(cwd), 'experiments'),
  legacyTrackExperiments: (cwd, trackId) => path.join(omaDir(cwd), 'experiments', trackId),
  legacyOmaSkills:        (cwd) => path.join(omaDir(cwd), 'skills'),
  legacyOmaReference:     (cwd) => path.join(omaDir(cwd), 'reference'),
  legacyReference:        (cwd) => path.join(omaDir(cwd), 'reference-skills'),
};

/** Resolve requirements.md (new layout, then legacy root). */
function resolveRequirementsPath(cwd) {
  if (exists(OMA.requirements(cwd))) return OMA.requirements(cwd);
  if (exists(OMA.legacyRequirements(cwd))) return OMA.legacyRequirements(cwd);
  return OMA.requirements(cwd);
}

function resolveKnowledgePath(cwd) {
  if (exists(OMA.knowledge(cwd))) return OMA.knowledge(cwd);
  if (exists(OMA.legacyKnowledge(cwd))) return OMA.legacyKnowledge(cwd);
  return OMA.knowledge(cwd);
}

function resolvePaperDir(cwd) {
  if (exists(OMA.paper(cwd))) return OMA.paper(cwd);
  if (exists(OMA.legacyPaper(cwd))) return OMA.legacyPaper(cwd);
  return OMA.paper(cwd);
}

function resolveTrackMemoryPath(cwd, trackId) {
  const p = OMA.trackMemory(cwd, trackId);
  if (exists(p)) return p;
  if (exists(OMA.legacyMemory(cwd))) return OMA.legacyMemory(cwd);
  return p;
}

function resolveTrackDesignDir(cwd, trackId) {
  const p = OMA.trackDesignDir(cwd, trackId);
  if (exists(p)) return p;
  if (exists(OMA.legacyDesigns(cwd))) return OMA.legacyDesigns(cwd);
  return p;
}

function pkgRoot() {
  return path.resolve(__dirname, '..', '..');
}

function templatePath(name) {
  return path.join(pkgRoot(), 'templates', name);
}

function exists(p) {
  return fs.existsSync(p);
}

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readLines(p) {
  if (!exists(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function readText(p) {
  if (!exists(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function listTrackIds(cwd) {
  const ids = new Set();
  const tracksRoot = OMA.tracks(cwd);
  if (exists(tracksRoot)) {
    for (const name of fs.readdirSync(tracksRoot)) {
      const p = path.join(tracksRoot, name);
      try {
        if (fs.statSync(p).isDirectory()) ids.add(name);
      } catch { /* skip */ }
    }
  }
  const expRoot = OMA.legacyExperimentsRoot(cwd);
  if (exists(expRoot)) {
    for (const name of fs.readdirSync(expRoot)) {
      const p = path.join(expRoot, name);
      try {
        if (fs.statSync(p).isDirectory() && !name.startsWith('exp-')) ids.add(name);
      } catch { /* skip */ }
    }
  }
  return [...ids];
}

// Collect all exp-* IDs across tracks (new + legacy layouts).
function listExpIds(cwd = process.cwd()) {
  const ids = new Set();

  function scanExpDir(dirPath) {
    if (!exists(dirPath)) return;
    for (const name of fs.readdirSync(dirPath)) {
      if (name.startsWith('exp-')) ids.add(name);
    }
  }

  for (const trackId of listTrackIds(cwd)) {
    scanExpDir(OMA.trackExperiments(cwd, trackId));
    scanExpDir(OMA.legacyTrackExperiments(cwd, trackId));
  }

  scanExpDir(OMA.legacyExperimentsRoot(cwd));
  return [...ids];
}

function nextExpId(cwd = process.cwd()) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let seq     = 1;

  const existing = listExpIds(cwd)
    .filter((d) => d.startsWith(`exp-${today}-`))
    .map((d) => parseInt(d.split('-').pop(), 10))
    .filter((n) => !isNaN(n));

  if (existing.length) seq = Math.max(...existing) + 1;

  return `exp-${today}-${String(seq).padStart(3, '0')}`;
}

function resolveExperimentDir(cwd, trackId, expId) {
  const trackPath = OMA.trackExperiment(cwd, trackId, expId);
  if (exists(trackPath)) return trackPath;

  const legacyTrack = OMA.legacyTrackExperiments(cwd, trackId);
  const legacyPath  = path.join(legacyTrack, expId);
  if (exists(legacyPath)) return legacyPath;

  const flatLegacy = path.join(OMA.legacyExperimentsRoot(cwd), expId);
  if (exists(flatLegacy)) return flatLegacy;

  return trackPath;
}

function listAllExperimentDirs(cwd) {
  const found = [];

  function addFromDir(dirPath, labelPrefix) {
    if (!exists(dirPath)) return;
    for (const name of fs.readdirSync(dirPath)) {
      if (!name.startsWith('exp-')) continue;
      const p = path.join(dirPath, name);
      try {
        if (fs.statSync(p).isDirectory()) found.push({ path: p, label: `${labelPrefix}${name}` });
      } catch { /* skip */ }
    }
  }

  for (const trackId of listTrackIds(cwd)) {
    addFromDir(OMA.trackExperiments(cwd, trackId), `tracks/${trackId}/experiments/`);
    addFromDir(OMA.legacyTrackExperiments(cwd, trackId), `experiments/${trackId}/`);
  }
  addFromDir(OMA.legacyExperimentsRoot(cwd), 'experiments/');
  return found;
}

module.exports = {
  OMA, pkgRoot, templatePath, exists, readJSON, readLines, readText,
  listExpIds, nextExpId, resolveExperimentDir, listTrackIds, listAllExperimentDirs,
  resolveRequirementsPath, resolveKnowledgePath, resolvePaperDir,
  resolveTrackMemoryPath, resolveTrackDesignDir,
};
