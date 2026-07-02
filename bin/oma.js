#!/usr/bin/env node
'use strict';

/**
 * oma — oh-my-algorithm CLI
 *
 * Usage:
 *   oma setup                        Initialize .oma/ workspace
 *   oma extract --paper <path.pdf>   Extract paper → .oma/requirement/paper/ (run before $requirement)
 *   oma search --topic "..."         Fetch papers from Semantic Scholar (Stream A seeds)
 *   oma doctor                       Check gate chain status
 *   oma status                       Show leaderboard, phase, memory snapshot
 *   oma log [options]                Pretty-print the experiment trajectory
 *   oma version                      Print version
 *   oma help [command]               Show help
 */

const { setup }   = require('../src/commands/setup');
const { extract } = require('../src/commands/extract');
const { search }  = require('../src/commands/search');
const { index }   = require('../src/commands/index');
const { go }      = require('../src/commands/go');
const { doctor }  = require('../src/commands/doctor');
const { status }  = require('../src/commands/status');
const { track }   = require('../src/commands/track');
const { reference } = require('../src/commands/reference');
const { logCmd }  = require('../src/commands/log');
const { xp }      = require('../src/commands/experience');
const { log, err, blank, color } = require('../src/utils/print');

const pkg  = require('../package.json');
const args = process.argv.slice(2);
const cmd  = args[0];

// ── Flag parsing ──────────────────────────────────────────────────────────────

function hasFlag(...flags) {
  return flags.some((f) => args.includes(f));
}

function flagValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP = {
  root: `
  ${color.bold(color.cyan('oma'))} — oh-my-algorithm ${color.gray(`v${pkg.version}`)}

  ${color.bold('Usage:')}
    oma <command> [options]

  ${color.bold('Commands:')}
    ${color.cyan('setup')}                        Initialize .oma/ workspace in current directory
    ${color.cyan('go <stage> | go loop')}         Enter a stage directly, or the iteration loop (no requirement)
    ${color.cyan('extract --paper <path.pdf>')}   Extract paper → .oma/requirement/paper/ (run before $requirement)
    ${color.cyan('index --src <repo-path>')}      Index reference codebase → .oma/codebase/ ($design + $implement)
    ${color.cyan('search --topic "..."')}         Fetch papers from Semantic Scholar (Stream A seeds)
    ${color.cyan('doctor')}                       Check gate chain status and workspace health
    ${color.cyan('reference')} <list|install|add>     Install optional lab reference skills
    ${color.cyan('track')} <open|close|list|switch>  Manage design-paradigm tracks (parallel routes)
    ${color.cyan('xp <sub>')}                     Global experience library (add / list / search / show / delete)
    ${color.cyan('version')}                      Print version
    ${color.cyan('help [command]')}               Show help for a command

  ${color.bold('Options:')}
    --cwd <path>          Run as if in this directory (default: process.cwd())
    --no-color            Disable color output
    -h, --help            Show this help

  ${color.bold('Typical first session:')}
    oma setup
    oma extract --paper ./paper.pdf
    oma index --src ./reference-repo     # optional — enables Path A implement
    oma doctor
    # open Codex and run: $requirement

  ${color.bold('Standalone (gate-free) entry:')}
    oma go design                        # jump straight to $design, no gates
    oma go train                         # enter $train even without prior stages
    oma go off                           # return to gated mode
    oma go status                        # show current standalone mode state
`,

  setup: `
  ${color.bold('oma setup')} — Initialize .oma/ workspace

  Creates the .oma/ directory structure, copies templates, and writes
  an initial index.json (project dashboard + meta config). Safe to run multiple times (skips existing files).

  ${color.bold('Options:')}
    -p <platform>         Agent platform. Determines how stage prompts install.
                            codex        → AGENTS.md + .codex/skills/  (default)
                            meta-agent   → AGENT.md  + .codex/skills/
                            cursor       → .cursor/rules + .cursor/skills (+ AGENTS.md fallback)
                            claude-code  → CLAUDE.md + .claude/skills
    --overlay <file.md>   Append a custom markdown file to the end of the generated
                          agent file (AGENTS.md / oma-core.mdc / CLAUDE.md). Your
                          per-stage habits go in that file; OMA appends it verbatim.
    --force               Overwrite existing template files
    --cwd <path>          Initialize in this directory instead of cwd

  ${color.bold('Examples:')}
    oma setup                      # default: generates AGENTS.md
    oma setup -p codex             # same as default
    oma setup -p meta-agent        # generates AGENT.md instead
    oma setup -p cursor            # native Cursor layout (rules + frontmatter'd skills)
    oma setup -p cursor --overlay ./my-habits.md   # + append your custom markdown

  ${color.bold('Creates (codex / meta-agent):')}
    AGENTS.md / AGENT.md  (agent prompt, determined by -p)
    .oma/requirement/requirements.md  (from template — fill via $requirement)
    .oma/tracks/{track_id}/memory.md        (empty Dead Ends / Working Patterns tables)
    .oma/index.json       (dashboard: meta config, active/closed tracks)
    .oma/tracks/          (per-paradigm track state)
    .oma/tracks/{track_id}/design/         (directory for $design outputs)
    .oma/impl/            (directory for $implement outputs)
    .oma/experiments/     (directory for $train / $tune / $evaluate outputs)
    .gitignore            (appends .oma/experiments/ and other volatile state)

  ${color.bold('Creates (cursor):')}
    .cursor/rules/oma-core.mdc       (alwaysApply constitution from AGENTS.md)
    .cursor/skills/<stage>/SKILL.md  (stage prompts + auto-select frontmatter)
    AGENTS.md                        (@-fallback; Cursor auto-load is unstable)
    .oma/  (state: requirements.md, memory.md, index.json, tracks/, designs/, impl/, experiments/)
`,

  go: `
  ${color.bold('oma go <stage>')} — Enter any stage directly (Standalone Mode)

  Bypasses gate enforcement so you can enter any OMA stage without completing
  prior stages. Writes ${color.cyan('.oma/standalone.json')} to signal Codex that gate
  checks should be advisory only (warnings, not blocks).

  ${color.bold('Stages:')}
    requirement   Enter $requirement directly
    design        Enter $design directly
    implement     Enter $implement directly
    train         Enter $train directly
    tune          Enter $tune directly
    deploy        Enter $deploy directly
    consolidate   Enter $consolidate directly
    loop          Enter the iteration loop WITHOUT $requirement (waives the
                  enter-loop hard gate, inits per-track loop.json, gates advisory)
    off           Disable standalone mode (return to gated flow; keeps track loop.json)
    status        Show current standalone mode state

  ${color.bold('Options:')}
    --stage <s>      Start stage for 'go loop' (design|implement|train|tune; default design)
    --track <id>     Track for 'go loop' (default: index.default_track or auto-create default)
    --reason "..."   Document why you're entering standalone mode (becomes the
                     first lap's hypothesis for 'go loop')

  ${color.bold('Examples:')}
    oma go design                         # jump into $design
    oma go loop                           # enter the loop, no requirement, start at $design
    oma go loop --stage tune --reason "已有代码库，直接调 DR"
    oma go train --reason "testing infra"
    oma go off                            # return to normal gated flow
    oma go status                         # check if standalone mode is active

  ${color.bold('Experience library:')}
    oma xp add --stage design             # save a design experience after a session
    oma xp search "reward hacking"        # query past experiences (Codex calls this)
    oma xp list --stage tune              # list all tune-stage experiences
`,

  xp: `
  ${color.bold('oma xp')} — Project experience library (user-configured path)

  Configure once (writes .oma/index.json experiences_dir):
    ${color.cyan('oma xp init --dir <path>')}

  All subcommands accept ${color.cyan('--dir <path>')} to override for one invocation.

  ${color.bold('Subcommands:')}
    ${color.cyan('init --dir <path>')}              Set experiences directory
    ${color.cyan('add [--dir <path>] [--stage <stage>]')}  Archive an experience
    ${color.cyan('list [--stage <s>] [--tag <t>]')} List experiences (table view)
    ${color.cyan('search <query> [--stage <s>]')}   Full-text search
    ${color.cyan('show <id>')}                      Full detail for one entry
    ${color.cyan('delete <id>')}                    Remove one entry

  ${color.bold('Valid stages:')} design, tune, deploy

  ${color.bold('Storage:')}
    {experiences_dir}/xp-index.json
    {experiences_dir}/<id>.md

  ${color.bold('Examples:')}
    oma xp init --dir lab/experiences
    oma xp add --stage design --name my-pattern --description "..."
    oma xp search "reward hacking" --stage tune
    oma xp index --format md
`,

  doctor: `
  ${color.bold('oma doctor')} — Verify gate chain and workspace health

  Checks each gate in the lifecycle chain (requirement → design → implement
  → train → tune → evaluate → deploy) and reports which gates are open
  or blocked. Shows experiment run statistics.

  ${color.bold('Options:')}
    --cwd <path>          Check workspace in this directory
    --migrate             Migrate legacy config.json / root loop.json into index.json + tracks/

  ${color.bold('Exit codes:')}
    0   All gates open (or first blocked gate is deploy)
    1   .oma/ directory not found
`,

  status: `
  ${color.bold('oma status')} — Workspace dashboard

  Shows:
    Current phase (inferred from which artifacts exist)
    Project index (active/closed tracks)
    Per-track iteration loop on default track
    Best result from best.json (deploy gate status)
    Top 8 tune-ranked experiments (experiments-index.json)
    Memory snapshot (Dead Ends / Working Patterns counts)
    Last 5 experiment results (results.json)

  ${color.bold('Options:')}
    --cwd <path>          Read workspace from this directory
`,

  log: `
  ${color.bold('oma log')} — Experiment results viewer (reads tracks/*/experiments/*/results.json)

  ${color.bold('Options:')}
    --tail <n>            Show last N entries (default: 20)
    --phase <name>        Filter by phase: train | tune | evaluate
    --verbose             Print full JSON for each entry
    --cwd <path>          Read workspace from this directory

  ${color.bold('Examples:')}
    oma log
    oma log --tail 5
    oma log --phase tune
    oma log --verbose --tail 3
`,

  search: `
  ${color.bold('oma search')} — Fetch papers from Semantic Scholar (Stream A seeds)

  Queries Semantic Scholar (free, no API key) and saves structured results
  to .oma/requirement/paper/search-cache/ for the $design skill to consume.

  ${color.bold('Options:')}
    --topic <query>       Search query (repeatable for multiple queries)
    --from-knowledge      Derive queries automatically from .oma/requirement/knowledge.md
    --limit <n>           Max papers per query (default: 8, max: 20)
    --year-from <year>    Minimum publication year (default: 3 years ago)
    --force               Re-fetch even if cache already exists
    --cwd <path>          Workspace directory (default: cwd)

  ${color.bold('Output:')}
    .oma/requirement/paper/search-cache/ss-{slug}.json    Per-query results
    .oma/requirement/paper/search-cache/search-results.json  Combined ranked results
    .oma/requirement/paper/search-cache/stream-a-seeds.md    Ready for $design Stream A

  ${color.bold('Examples:')}
    oma search --topic "attention mechanism tabular data"
    oma search --topic "graph neural networks" --topic "message passing"
    oma search --from-knowledge
    oma search --from-knowledge --year-from 2023 --limit 10
`,

  index: `
  ${color.bold('oma index')} — Map local code paths to tracks

  Registers which local directory each design-paradigm track edits during
  $design / $implement (Path A). Parallel tracks can point at different folders.

  ${color.bold('Why this matters:')}
    Two routes often need two code trees. .oma/codebase/config.json holds a
    per-track srcPath map; the active track (index.default_track) selects which
    path Agent reads and modifies.

  ${color.bold('Options:')}
    --src <path>          Local code directory (required to register)
    --track <track-id>    Target track (default: index.default_track)
    --list                Show track → srcPath map (also when --src omitted)
    --force               Overwrite existing mapping for that track
    --cwd <path>          Workspace directory (default: cwd)

  ${color.bold('Output:')}
    .oma/codebase/config.json     { schema_version, tracks: { <id>: { srcPath, ... } } }

  ${color.bold('Examples:')}
    oma index --list
    oma index --src ./legged_gym_gait --track gait-clock
    oma index --src ./legged_gym_minimal --track minimal-reward
    oma index --src ./legged_gym --force
`,

  extract: `
  ${color.bold('oma extract')} — Extract benchmark paper into structured sections

  Runs BEFORE starting a Codex session. Converts a PDF paper into structured
  section files that the $requirement skill reads to ground knowledge.md and
  pre-fill requirements.md without a lengthy interview.

  ${color.bold('Options:')}
    --paper <path>        Path to the PDF file (required)
    --force               Re-extract even if .oma/requirement/paper/ already exists
    --cwd <path>          Workspace directory (default: cwd)

  ${color.bold('Output:')}
    .oma/requirement/paper/raw-text.txt        Full extracted text
    .oma/requirement/paper/raw-sections.json   Heuristically split sections
    .oma/requirement/paper/meta.json           Title, year, venue, best result (best-effort)
    .oma/requirement/paper/manifest.json       Extraction summary

  ${color.bold('Extraction backends (tried in order):')}
    1. pdftotext (poppler-utils)   brew install poppler / apt install poppler-utils
    2. python3 pdfminer.six        pip install pdfminer.six
    3. python3 pypdf               pip install pypdf

  ${color.bold('Examples:')}
    oma extract --paper ./attention.pdf
    oma extract --paper ~/papers/bert.pdf --force
`,

  track: `
  ${color.bold('oma track')} — Manage design-paradigm tracks (parallel routes)

  Tracks are paradigm-level routes (e.g. redirect-data, gait-clock, minimal-reward),
  not reward-tuning laps. Mechanical CRUD only — semantic decisions stay with the Agent.

  ${color.bold('Subcommands:')}
    ${color.cyan('open <track-id>')}     Open a new active track
    ${color.cyan('close <track-id>')}    Move track to closed_tracks
    ${color.cyan('list')}                Show active/closed tracks and default loop
    ${color.cyan('switch <track-id>')}   Set index.default_track

  ${color.bold('Options (open):')}
    --label "..."       Human label (design paradigm name)
    --paradigm "..."    Paradigm description
    --owner name        Owner
    --target path       Target ref (default: requirements.md)

  ${color.bold('Options (close):')}
    --deliverable "..."  What was delivered

  ${color.bold('Examples:')}
    oma track open gait-clock --label "步态时钟驱动"
    oma track list
    oma track switch gait-clock
    oma track close minimal-reward --deliverable "exp_A08 deploy"
`,

  reference: `
  ${color.bold('oma reference')} — Install optional lab reference skills

  Reference skills are lab-specific helpers (e.g. experiment-analysis, experiment-recording).
  They are NOT part of OMA core routing — install only when needed.

  ${color.bold('Subcommands:')}
    ${color.cyan('list')}                          Show package catalog + installed skills
    ${color.cyan('install <name>')}                Copy from skills/reference/ → .codex/skills/reference-
    ${color.cyan('add --name <id> --src <path>')}  Register a custom reference skill

  ${color.bold('Options:')}
    -p cursor           Also install to .cursor/skills/reference-<name>/

  ${color.bold('Examples:')}
    oma reference list
    oma reference install experiment-analysis
    oma reference install experiment-recording -p cursor
    oma reference add --name my-analysis --src ./lab/skills/foo
`,
};

// ── Router ────────────────────────────────────────────────────────────────────

async function main() {
  if (hasFlag('-h', '--help') && !cmd) {
    log(HELP.root);
    return;
  }

  const cwd = flagValue('--cwd') || process.cwd();

  switch (cmd) {

    case 'setup':
      if (hasFlag('-h', '--help')) { log(HELP.setup); return; }
      await setup({ cwd, force: hasFlag('--force'), platform: flagValue('-p') || 'codex', overlay: flagValue('--overlay') });
      break;

    case 'go':
      if (hasFlag('-h', '--help')) { log(HELP.go); return; }
      await go({
        cwd,
        stage     : args[1] || 'status',
        reason    : flagValue('--reason') || '',
        startStage: flagValue('--stage') || (args[1] === 'loop' ? args[2] : undefined),
        trackId   : flagValue('--track') || null,
      });
      break;

    case 'search': {
      if (hasFlag('-h', '--help')) { log(HELP.search); return; }
      // Collect all --topic values (flag may appear multiple times)
      const topics = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--topic' && args[i + 1]) topics.push(args[i + 1]);
      }
      await search({
        cwd,
        topics,
        fromKnowledge : hasFlag('--from-knowledge'),
        limit         : parseInt(flagValue('--limit')     || '8',  10),
        yearFrom      : parseInt(flagValue('--year-from') || String(new Date().getFullYear() - 3), 10),
        force         : hasFlag('--force'),
      });
      break;
    }

    case 'index':
      if (hasFlag('-h', '--help')) { log(HELP.index); return; }
      await index({
        cwd,
        srcPath : flagValue('--src'),
        trackId : flagValue('--track'),
        force   : hasFlag('--force'),
        list    : hasFlag('--list') || !flagValue('--src'),
      });
      break;

    case 'extract':
      if (hasFlag('-h', '--help')) { log(HELP.extract); return; }
      await extract({ cwd, paperPath: flagValue('--paper'), force: hasFlag('--force') });
      break;

    case 'doctor':
      if (hasFlag('-h', '--help')) { log(HELP.doctor); return; }
      await doctor({ cwd, migrate: hasFlag('--migrate') });
      break;

    case 'track':
      if (hasFlag('-h', '--help')) { log(HELP.track); return; }
      await track(args.slice(1), { cwd });
      break;

    case 'reference':
      if (hasFlag('-h', '--help')) { log(HELP.reference); return; }
      await reference(args.slice(1), {
        cwd,
        platform: flagValue('-p') || null,
      });
      break;

    case 'status':
      if (hasFlag('-h', '--help')) { log(HELP.status); return; }
      await status({ cwd });
      break;

    case 'log':
      if (hasFlag('-h', '--help')) { log(HELP.log); return; }
      await logCmd({
        cwd,
        tail:    parseInt(flagValue('--tail') || '20', 10),
        phase:   flagValue('--phase') || null,
        verbose: hasFlag('--verbose', '-v'),
      });
      break;

    case 'xp': {
      if (hasFlag('-h', '--help')) { log(HELP.xp); return; }
      // Parse xp-specific flags
      const xpFlags = {};
      const xpArgs  = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
          xpFlags[args[i]] = args[i + 1];
          i++;
        } else if (args[i].startsWith('--')) {
          xpFlags[args[i]] = true;
        } else {
          xpArgs.push(args[i]);
        }
      }
      await xp(xpArgs, { ...xpFlags, cwd });
      break;
    }

    case 'version':
    case '--version':
    case '-v':
      log(`oh-my-algorithm v${pkg.version}`);
      break;

    case 'help':
    case undefined:
      log(HELP[args[1]] ?? HELP.root);
      break;

    default:
      err(`  ${color.red('✗')} Unknown command: ${color.bold(cmd)}`);
      blank();
      err(`  Run ${color.cyan('oma help')} to see available commands.`);
      blank();
      process.exit(1);
  }
}

main().catch((e) => {
  err(`\n  ${color.red('✗')} Fatal error: ${e.message}`);
  if (process.env.OMA_DEBUG) err(e.stack);
  process.exit(1);
});
