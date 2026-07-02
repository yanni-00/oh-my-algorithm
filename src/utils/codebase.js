'use strict';

const fs   = require('fs');
const path = require('path');
const { OMA, exists, readJSON } = require('./paths');
const { getDefaultTrackId } = require('./oma-index');

const SCHEMA_VERSION = '2.0';

const LANG_MAP = {
  '.py': 'Python', '.js': 'JavaScript', '.ts': 'TypeScript',
  '.cpp': 'C++', '.cc': 'C++', '.rs': 'Rust', '.java': 'Java',
  '.go': 'Go', '.r': 'R', '.m': 'MATLAB', '.cu': 'CUDA',
};

function codebaseConfigPath(cwd) {
  return path.join(OMA.dir(cwd), 'codebase', 'config.json');
}

function detectLangAndTopLevel(resolvedSrc) {
  const topLevel = fs.readdirSync(resolvedSrc, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();

  const extCount = {};
  topLevel.forEach((name) => {
    const ext = path.extname(name).toLowerCase();
    if (ext) extCount[ext] = (extCount[ext] || 0) + 1;
  });
  const primaryExt = Object.entries(extCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const primaryLang = LANG_MAP[primaryExt] || primaryExt || 'unknown';

  return { topLevel, primaryLang };
}

function normalizeCodebaseConfig(config, cwd) {
  const base = config || { schema_version: SCHEMA_VERSION, tracks: {} };
  if (!base.tracks) base.tracks = {};

  if (base.srcPath && Object.keys(base.tracks).length === 0) {
    const defaultTrack = getDefaultTrackId(cwd);
    if (defaultTrack) {
      base.tracks[defaultTrack] = {
        srcPath      : base.srcPath,
        primaryLang  : base.primaryLang || null,
        topLevel     : base.topLevel || [],
        registeredAt : base.registeredAt || null,
      };
    }
  }

  base.schema_version = SCHEMA_VERSION;
  return base;
}

function readCodebaseConfig(cwd) {
  const configPath = codebaseConfigPath(cwd);
  if (!exists(configPath)) return null;
  return normalizeCodebaseConfig(readJSON(configPath), cwd);
}

function writeCodebaseConfig(cwd, config) {
  const codebaseDir = path.join(OMA.dir(cwd), 'codebase');
  fs.mkdirSync(codebaseDir, { recursive: true });
  const normalized = normalizeCodebaseConfig(config, cwd);
  fs.writeFileSync(codebaseConfigPath(cwd), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function resolveTrackId(cwd, trackId) {
  return trackId || getDefaultTrackId(cwd) || null;
}

function resolveTrackSrcPath(cwd, trackId) {
  const config = readCodebaseConfig(cwd);
  if (!config) return null;

  const id = resolveTrackId(cwd, trackId);
  if (id && config.tracks?.[id]?.srcPath) return config.tracks[id].srcPath;
  if (config.srcPath) return config.srcPath;
  return null;
}

function getTrackCodebaseEntry(cwd, trackId) {
  const config = readCodebaseConfig(cwd);
  if (!config) return null;

  const id = resolveTrackId(cwd, trackId);
  if (id && config.tracks?.[id]) return { trackId: id, ...config.tracks[id] };
  if (config.srcPath) {
    return {
      trackId : id,
      srcPath : config.srcPath,
      primaryLang: config.primaryLang,
      topLevel: config.topLevel,
      registeredAt: config.registeredAt,
      legacy  : true,
    };
  }
  return null;
}

function listTrackCodebases(cwd) {
  const config = readCodebaseConfig(cwd);
  if (!config) return [];

  const rows = [];
  for (const [trackId, entry] of Object.entries(config.tracks || {})) {
    if (!entry?.srcPath) continue;
    rows.push({ trackId, ...entry });
  }

  if (!rows.length && config.srcPath) {
    rows.push({
      trackId      : getDefaultTrackId(cwd),
      srcPath      : config.srcPath,
      primaryLang  : config.primaryLang,
      topLevel     : config.topLevel,
      registeredAt : config.registeredAt,
      legacy       : true,
    });
  }

  return rows;
}

function registerCodebase(cwd, { trackId, srcPath, force = false }) {
  const resolvedSrc = path.resolve(srcPath);
  if (!exists(resolvedSrc)) {
    throw new Error(`Source path not found: ${resolvedSrc}`);
  }
  if (!fs.statSync(resolvedSrc).isDirectory()) {
    throw new Error(`--src must be a directory, not a file: ${resolvedSrc}`);
  }

  const id = resolveTrackId(cwd, trackId);
  if (!id) {
    throw new Error(
      'No track specified. Use --track <track-id> or set index.default_track via `oma track open`.',
    );
  }

  const existing = readCodebaseConfig(cwd) || { schema_version: SCHEMA_VERSION, tracks: {} };
  const current = existing.tracks?.[id];
  if (!force && current?.srcPath === resolvedSrc) {
    return { unchanged: true, trackId: id, entry: current };
  }

  const { topLevel, primaryLang } = detectLangAndTopLevel(resolvedSrc);
  const entry = {
    srcPath      : resolvedSrc,
    primaryLang,
    topLevel,
    registeredAt : new Date().toISOString(),
  };

  existing.tracks = existing.tracks || {};
  existing.tracks[id] = entry;

  const defaultTrack = getDefaultTrackId(cwd);
  if (defaultTrack === id) {
    existing.srcPath = resolvedSrc;
    existing.primaryLang = primaryLang;
    existing.topLevel = topLevel;
    existing.registeredAt = entry.registeredAt;
  }

  writeCodebaseConfig(cwd, existing);
  return { unchanged: false, trackId: id, entry };
}

module.exports = {
  SCHEMA_VERSION,
  codebaseConfigPath,
  detectLangAndTopLevel,
  readCodebaseConfig,
  writeCodebaseConfig,
  resolveTrackSrcPath,
  getTrackCodebaseEntry,
  listTrackCodebases,
  registerCodebase,
};
