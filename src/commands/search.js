'use strict';

/**
 * oma search — Stream A literature hunter
 *
 * Queries Semantic Scholar (free, no API key) and saves structured results
 * to .oma/paper/search-cache/ for the $design skill to consume.
 *
 * Usage:
 *   oma search --topic "attention mechanism tabular data"
 *   oma search --from-knowledge          (derive queries from knowledge.md)
 *   oma search --topic "..." --limit 10  (max papers per query, default 8)
 *   oma search --year-from 2022          (filter by min year, default 3 years ago)
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { OMA, exists, readText, readJSON, resolveRequirementsPath, resolveKnowledgePath, resolvePaperDir, resolveTrackDesignDir, resolveTrackMemoryPath } = require('../utils/paths');
const { header, section, ok, warn, fail, info, blank, log, kv, table, color } = require('../utils/print');

const SS_BASE  = 'api.semanticscholar.org';
const SS_PAPER = '/graph/v1/paper/search';
const FIELDS   = 'title,year,authors,abstract,citationCount,venue,externalIds';

// ── Main entry ────────────────────────────────────────────────────────────────

async function search({
  cwd         = process.cwd(),
  topics      = [],
  fromKnowledge = false,
  limit       = 8,
  yearFrom    = new Date().getFullYear() - 3,
  force       = false,
} = {}) {
  header('oma search — Stream A Literature Hunter');
  blank();

  if (!exists(OMA.dir(cwd))) {
    fail('.oma/ not found', 'Run `oma setup` first');
    process.exit(1);
  }

  const cacheDir = path.join(resolvePaperDir(cwd), 'search-cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  // ── 1. Build query list ──────────────────────────────────────────────────
  const queries = [...topics];

  if (fromKnowledge) {
    const knowledgeQueries = deriveQueriesFromKnowledge(cwd);
    if (!knowledgeQueries.length) {
      warn('knowledge.md not found or empty', 'Using --topic queries only');
    } else {
      queries.push(...knowledgeQueries);
      section('Queries derived from knowledge.md');
      knowledgeQueries.forEach((q) => info(q));
    }
  }

  if (!queries.length) {
    fail('No search topics', 'Use --topic "..." or --from-knowledge');
    blank();
    log(color.gray('  Examples:'));
    log(color.gray('    oma search --topic "graph neural network node classification"'));
    log(color.gray('    oma search --from-knowledge'));
    blank();
    process.exit(1);
  }

  // ── 2. Execute queries ────────────────────────────────────────────────────
  section('Querying Semantic Scholar');
  blank();

  const allResults = [];
  const seenIds    = new Set();

  for (const query of queries) {
    log(`  ${color.cyan('→')} ${query}`);
    try {
      const papers = await querySemanticScholar(query, limit, yearFrom);
      const fresh  = papers.filter((p) => !seenIds.has(p.paperId));
      fresh.forEach((p) => seenIds.add(p.paperId));
      allResults.push(...fresh);

      if (fresh.length) {
        ok(`${fresh.length} papers`, `(${papers.length - fresh.length} deduplicated)`);
      } else {
        warn('0 new papers', 'all results already seen from previous query');
      }

      // Per-query cache file
      const slug = query.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const outPath = path.join(cacheDir, `ss-${slug}.json`);
      fs.writeFileSync(outPath, JSON.stringify({ query, yearFrom, results: fresh }, null, 2));

    } catch (e) {
      warn(`Query failed`, e.message);
    }

    // Rate-limit: 1 req/sec (Semantic Scholar public limit)
    await sleep(1100);
  }

  if (!allResults.length) {
    fail('No results found', 'Try broader topics or remove --year-from filter');
    process.exit(1);
  }

  // ── 3. Sort and write combined results ────────────────────────────────────
  section('Results');
  blank();

  const sorted = allResults
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));

  const tableRows = [
    ['#', 'Citations', 'Year', 'Venue', 'Title'],
  ];
  sorted.slice(0, 20).forEach((p, i) => {
    tableRows.push([
      color.gray(String(i + 1)),
      color.cyan(String(p.citationCount || 0)),
      color.gray(String(p.year || '?')),
      color.gray((p.venue || '').slice(0, 12)),
      (p.title || '').slice(0, 52),
    ]);
  });
  table(tableRows);

  if (sorted.length > 20) info(`…and ${sorted.length - 20} more saved to cache`);

  // Write combined results file
  const combined = {
    generated_at : new Date().toISOString(),
    queries,
    year_from    : yearFrom,
    total_papers : sorted.length,
    papers       : sorted.map(formatPaper),
  };
  const combinedPath = path.join(cacheDir, 'search-results.json');
  fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2));

  // ── 4. Write human-readable summary for the agent ────────────────────────
  const summaryPath = path.join(cacheDir, 'stream-a-seeds.md');
  fs.writeFileSync(summaryPath, buildStreamASummary(combined));

  blank();
  ok('Cache written', '.oma/paper/search-cache/');
  ok('stream-a-seeds.md', 'ready for $design Stream A');
  blank();
  info('Next step', 'open Codex and run "$design"');
  blank();
}

// ── Semantic Scholar API ──────────────────────────────────────────────────────

function querySemanticScholar(query, limit, yearFrom) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      query,
      fields : FIELDS,
      limit  : String(Math.min(limit, 20)),
    });
    if (yearFrom) params.set('year', `${yearFrom}-`);

    const options = {
      hostname : SS_BASE,
      path     : `${SS_PAPER}?${params}`,
      method   : 'GET',
      headers  : {
        'User-Agent' : 'oh-my-algorithm/0.1 (research tool)',
        'Accept'     : 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 429) {
          return reject(new Error('Rate limited by Semantic Scholar — wait 60 s'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from Semantic Scholar`));
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          resolve(body.data || []);
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

// ── Query derivation from knowledge.md ───────────────────────────────────────

function deriveQueriesFromKnowledge(cwd) {
  const knowledgePath = resolveKnowledgePath(cwd);
  if (!exists(knowledgePath)) return [];

  const text    = readText(knowledgePath) || '';
  const queries = [];
  const year    = new Date().getFullYear();

  // 1. Problem type + metric + "recent" from Evaluation Protocol
  const metricMatch  = text.match(/Primary metric[:\s]+([^\n\r]+)/i);
  const taskMatch    = text.match(/Task[:\s]+([^\n\r]+)/i);
  const sourceMatch  = text.match(/_Source:[^\n]*—[^\n]*\((\d{4})\)/);
  const paperYear    = sourceMatch ? parseInt(sourceMatch[1]) : year - 2;

  if (taskMatch) {
    const task = taskMatch[1].replace(/\[.*?\]/g, '').trim().slice(0, 60);
    queries.push(`${task} deep learning ${year - 1} OR ${year}`);
    if (metricMatch) {
      const metric = metricMatch[1].replace(/\[.*?\]/g, '').trim().slice(0, 30);
      queries.push(`${task} ${metric} state of the art`);
    }
  }

  // 2. Algorithm families from landscape table
  const landscapeBlock = extractSection(text, 'Algorithm Landscape');
  const families = [...landscapeBlock.matchAll(/^\|\s*([^|{]+?)\s*\|/gm)]
    .map((m) => m[1].trim())
    .filter((f) => f.length > 3 && !f.startsWith('-') && f !== 'Family');
  families.slice(0, 2).forEach((f) => {
    queries.push(`${f} improvement recent advances`);
  });

  // 3. Known limitations as search seeds
  const limitBlock = extractSection(text, 'Known Limitations');
  const limits = [...limitBlock.matchAll(/^\|\s*([^|]+?)\s*\|/gm)]
    .map((m) => m[1].trim())
    .filter((l) => l.length > 10 && !l.startsWith('-') && l !== 'Limitation');
  if (limits[0] && taskMatch) {
    const task = taskMatch[1].replace(/\[.*?\]/g, '').trim().slice(0, 40);
    queries.push(`${task} ${limits[0].slice(0, 40)} solution`);
  }

  return queries.slice(0, 5); // cap at 5 derived queries
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatPaper(p) {
  return {
    paperId      : p.paperId,
    title        : p.title,
    year         : p.year,
    venue        : p.venue || null,
    authors      : (p.authors || []).slice(0, 3).map((a) => a.name),
    citationCount: p.citationCount || 0,
    abstract     : (p.abstract || '').slice(0, 600),
    doi          : p.externalIds?.DOI || null,
    arxiv        : p.externalIds?.ArXiv ? `https://arxiv.org/abs/${p.externalIds.ArXiv}` : null,
  };
}

function buildStreamASummary(combined) {
  const lines = [
    '# Stream A Seeds — Literature Search Results',
    `_Generated: ${combined.generated_at.slice(0, 10)}_`,
    `_Queries: ${combined.queries.length} | Papers: ${combined.total_papers}_`,
    '',
    '<!-- Read by $design Phase 1, Stream A -->',
    '<!-- Papers ranked by citation count (proxy for influence) -->',
    '',
  ];

  combined.papers.slice(0, 20).forEach((p, i) => {
    lines.push(`## Paper ${i + 1}: ${p.title}`);
    lines.push(`_${p.year} · ${p.venue || 'venue unknown'} · ${p.citationCount} citations_`);
    if (p.arxiv) lines.push(`_${p.arxiv}_`);
    lines.push('');
    lines.push('**Abstract excerpt:**');
    lines.push(`> ${(p.abstract || 'No abstract available.').slice(0, 400)}…`);
    lines.push('');
    lines.push('**For Stream A ideation:** What is the single core algorithmic innovation of this paper, and how could it apply to our problem?');
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

function extractSection(text, title) {
  const re = new RegExp(`## ${title}[\\s\\S]*?(?=## |$)`);
  const m  = text.match(re);
  return m ? m[0] : '';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { search };
