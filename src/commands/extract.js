'use strict';

/**
 * oma extract --paper <path.pdf>
 *
 * Mechanical PDF → structured sections pipeline.
 * Runs BEFORE a Codex session. Produces:
 *
 *   .oma/requirement/paper/raw-text.txt
 *   .oma/requirement/paper/raw-sections.json
 *   .oma/requirement/paper/meta.json
 *
 * The Codex agent reads raw-sections.json during $requirement Phase 2
 * and synthesises knowledge.md from it.
 */

const fs     = require('fs');
const path   = require('path');
const cp     = require('child_process');
const { OMA, exists } = require('../utils/paths');
const { header, section, ok, warn, fail, info, blank, log, kv, color } = require('../utils/print');

// ── Section header patterns (covers most CS/ML paper styles) ─────────────────
const SECTION_PATTERNS = [
  { key: 'abstract',     patterns: [/^abstract\b/i] },
  { key: 'introduction', patterns: [/^\d*\.?\s*introduction\b/i] },
  { key: 'related',      patterns: [/^\d*\.?\s*related\s+work\b/i, /^\d*\.?\s*background\b/i, /^\d*\.?\s*prior\s+work\b/i, /^\d*\.?\s*literature\s+review\b/i] },
  { key: 'method',       patterns: [/^\d*\.?\s*method(ology)?\b/i, /^\d*\.?\s*approach\b/i, /^\d*\.?\s*model\b/i, /^\d*\.?\s*proposed\b/i, /^\d*\.?\s*framework\b/i] },
  { key: 'experiments',  patterns: [/^\d*\.?\s*experiment(s|al)?\b/i, /^\d*\.?\s*evaluation\b/i, /^\d*\.?\s*results\b/i, /^\d*\.?\s*empirical\b/i] },
  { key: 'limitations',  patterns: [/^\d*\.?\s*limitation(s)?\b/i, /^\d*\.?\s*conclusion(s)?\b/i, /^\d*\.?\s*discussion\b/i, /^\d*\.?\s*future\s+work\b/i] },
];

async function extract({ cwd = process.cwd(), paperPath = null, force = false } = {}) {
  header('oma extract — PDF Paper Ingestion');
  blank();

  // ── 1. Validate input ──────────────────────────────────────────────────────
  if (!paperPath) {
    fail('No paper specified', 'Usage: oma extract --paper path/to/paper.pdf');
    blank();
    process.exit(1);
  }

  const absPath = path.resolve(cwd, paperPath);
  if (!exists(absPath)) {
    fail('File not found', absPath);
    blank();
    process.exit(1);
  }
  if (!absPath.toLowerCase().endsWith('.pdf')) {
    warn('Expected a .pdf file', `Got: ${path.basename(absPath)}`);
  }

  ok('Paper', path.basename(absPath));

  // ── 2. Check .oma/ exists ─────────────────────────────────────────────────
  const omaDir = OMA.dir(cwd);
  if (!exists(omaDir)) {
    fail('.oma/ not found', 'Run `oma setup` first');
    blank();
    process.exit(1);
  }

  const paperDir = OMA.paper(cwd);
  const outText  = path.join(paperDir, 'raw-text.txt');
  const outSecs  = path.join(paperDir, 'raw-sections.json');
  const outMeta  = path.join(paperDir, 'meta.json');

  if (exists(outSecs) && !force) {
    warn('Already extracted', 'Use --force to re-extract');
    info('raw-sections.json', outSecs);
    blank();
    printNextSteps();
    return;
  }

  fs.mkdirSync(paperDir, { recursive: true });

  // ── 3. Extract raw text ────────────────────────────────────────────────────
  section('Extracting text from PDF');

  const rawText = extractText(absPath);
  if (!rawText) {
    fail('Text extraction failed', 'Install pdftotext (poppler-utils) or python3 pdfminer.six');
    blank();
    log(color.gray('  macOS:   brew install poppler'));
    log(color.gray('  Ubuntu:  sudo apt install poppler-utils'));
    log(color.gray('  pip:     pip install pdfminer.six'));
    blank();
    process.exit(1);
  }

  fs.writeFileSync(outText, rawText, 'utf8');
  ok('Raw text', `${Math.round(rawText.length / 1000)}k chars → requirement/paper/raw-text.txt`);

  // ── 4. Parse sections ──────────────────────────────────────────────────────
  section('Splitting into sections');

  const sections = splitIntoSections(rawText);
  const found    = Object.keys(sections).filter((k) => sections[k].length > 100);
  const missing  = SECTION_PATTERNS.map((p) => p.key).filter((k) => !found.includes(k));

  for (const key of found) {
    const chars = sections[key].length;
    ok(key, `${Math.round(chars / 100) / 10}k chars`);
  }
  for (const key of missing) {
    warn(key, 'Not detected — agent will note as [not found]');
  }

  fs.writeFileSync(outSecs, JSON.stringify(sections, null, 2), 'utf8');
  ok('raw-sections.json', 'requirement/paper/raw-sections.json');

  // ── 5. Extract metadata ────────────────────────────────────────────────────
  section('Extracting metadata');

  const meta = extractMeta(rawText);
  fs.writeFileSync(outMeta, JSON.stringify(meta, null, 2), 'utf8');

  kv('Title (best-effort)',   meta.title   || '[not detected]');
  kv('Year  (best-effort)',   meta.year    || '[not detected]');
  kv('Venue (best-effort)',   meta.venue   || '[not detected]');
  kv('Baseline result found', meta.bestResult ? `${meta.bestResult.metric}: ${meta.bestResult.value}` : '[not detected]');

  // ── 6. Write extraction manifest ──────────────────────────────────────────
  const manifest = {
    extracted_at:  new Date().toISOString(),
    source_file:   absPath,
    source_size:   fs.statSync(absPath).size,
    raw_text_chars: rawText.length,
    sections_found: found,
    sections_missing: missing,
    meta,
  };
  fs.writeFileSync(path.join(paperDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // ── 7. Done ────────────────────────────────────────────────────────────────
  blank();
  ok('Extraction complete', 'requirement/paper/ ready for $requirement');
  blank();
  printNextSteps(missing);
}

// ── PDF text extraction — tries multiple backends ─────────────────────────────

function extractText(pdfPath) {
  // Try 1: pdftotext (poppler-utils)
  const txt = tryPdfToText(pdfPath);
  if (txt) return txt;

  // Try 2: python pdfminer
  const py = tryPdfMiner(pdfPath);
  if (py) return py;

  // Try 3: python pypdf2 (legacy)
  const py2 = tryPyPdf(pdfPath);
  if (py2) return py2;

  return null;
}

function tryPdfToText(pdfPath) {
  try {
    const result = cp.spawnSync('pdftotext', ['-layout', pdfPath, '-'], {
      maxBuffer: 50 * 1024 * 1024,
      timeout:   30000,
    });
    if (result.status === 0 && result.stdout.length > 100) {
      return result.stdout.toString('utf8');
    }
  } catch { /* not installed */ }
  return null;
}

function tryPdfMiner(pdfPath) {
  try {
    const script = `
from pdfminer.high_level import extract_text
import sys
print(extract_text(sys.argv[1]))
`.trim();
    const result = cp.spawnSync('python3', ['-c', script, pdfPath], {
      maxBuffer: 50 * 1024 * 1024,
      timeout:   60000,
    });
    if (result.status === 0 && result.stdout.length > 100) {
      return result.stdout.toString('utf8');
    }
  } catch { /* not installed */ }
  return null;
}

function tryPyPdf(pdfPath) {
  try {
    const script = `
import pypdf, sys
r = pypdf.PdfReader(sys.argv[1])
print("\\n".join(p.extract_text() or "" for p in r.pages))
`.trim();
    const result = cp.spawnSync('python3', ['-c', script, pdfPath], {
      maxBuffer: 50 * 1024 * 1024,
      timeout:   60000,
    });
    if (result.status === 0 && result.stdout.length > 100) {
      return result.stdout.toString('utf8');
    }
  } catch { /* not installed */ }
  return null;
}

// ── Section splitter ──────────────────────────────────────────────────────────

function splitIntoSections(text) {
  const lines    = text.split('\n');
  const sections = Object.fromEntries(SECTION_PATTERNS.map((p) => [p.key, '']));
  sections._full = text;

  let currentKey  = null;
  let buffer      = [];

  const flush = () => {
    if (currentKey && buffer.length) {
      sections[currentKey] = (sections[currentKey] || '') + buffer.join('\n').trim() + '\n';
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section header
    const match = SECTION_PATTERNS.find((p) =>
      p.patterns.some((re) => re.test(trimmed)) && trimmed.length < 80
    );

    if (match) {
      flush();
      currentKey = match.key;
      buffer.push(line);
    } else if (currentKey) {
      buffer.push(line);
    }
  }
  flush();

  // Abstract heuristic: if not found via header, grab first N chars before introduction
  if (!sections.abstract || sections.abstract.length < 50) {
    const introIdx = text.search(/\n\s*\d*\.?\s*introduction\b/i);
    if (introIdx > 200) {
      sections.abstract = text.slice(0, Math.min(introIdx, 3000)).trim();
    }
  }

  return sections;
}

// ── Metadata extraction (best-effort heuristics) ──────────────────────────────

function extractMeta(text) {
  const meta = { title: null, year: null, venue: null, bestResult: null };

  // Year: look for 4-digit year in 2015–2030 range near top of paper
  const topText = text.slice(0, 3000);
  const yearMatch = topText.match(/\b(201[5-9]|202[0-9])\b/);
  if (yearMatch) meta.year = yearMatch[1];

  // Title: first non-empty, non-numeric, reasonably long line
  const firstLines = text.split('\n').filter((l) => l.trim().length > 20).slice(0, 8);
  if (firstLines.length) meta.title = firstLines[0].trim().slice(0, 200);

  // Venue: look for common conference/journal names
  const venuePatterns = [
    /\b(NeurIPS|ICML|ICLR|CVPR|ICCV|ECCV|ACL|EMNLP|NAACL|AAAI|IJCAI|KDD|WWW|SIGIR|RecSys|VLDB|SIGMOD)\b/i,
    /\b(Nature|Science|Cell|PNAS|JMLR|TPAMI|TKDE|TOIS)\b/,
    /proceedings of/i,
  ];
  for (const pat of venuePatterns) {
    const m = topText.match(pat);
    if (m) { meta.venue = m[0]; break; }
  }

  // Best result: scan experiments section for metric patterns
  const expSection = text.slice(text.search(/experiment|evaluation|results/i)).slice(0, 8000);
  const metricPatterns = [
    /\b(accuracy|f1|auc|ndcg|map|rmse|mae|bleu|rouge)\b.*?(\d+\.\d+)/gi,
    /(\d+\.\d+)\s*%?\s*\(?(accuracy|f1|auc|ndcg)\)?/gi,
  ];
  for (const pat of metricPatterns) {
    const m = pat.exec(expSection);
    if (m) {
      meta.bestResult = { metric: (m[1] || m[2]).toLowerCase(), value: m[2] || m[1] };
      break;
    }
  }

  return meta;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function printNextSteps(missingSections = []) {
  log(color.bold('  Next steps:'));
  blank();
  info('Start a Codex session and run:', '"$requirement"');
  info('The agent will read requirement/paper/ and synthesise requirement/knowledge.md');
  if (missingSections.length) {
    warn('Missing sections', missingSections.join(', '));
    info('  → The agent will ask you to provide these manually during the interview');
  }
  blank();
}

module.exports = { extract };
