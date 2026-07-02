'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const reps = [
  ['.oma/requirements.md', '.oma/requirement/requirements.md'],
  ['.oma/knowledge.md', '.oma/requirement/knowledge.md'],
  ['.oma/paper/', '.oma/requirement/paper/'],
  ['.oma/designs/', '.oma/tracks/{track_id}/design/'],
  ['designs/design-{id}.md', 'tracks/{track_id}/design/design-{id}.md'],
  ['designs/{design-id}.md', 'tracks/{track-id}/design/{design-id}.md'],
  ['.oma/memory.md', '.oma/tracks/{track_id}/memory.md'],
  ['.oma/experiments/{track-id}/', '.oma/tracks/{track-id}/experiments/'],
  ['experiments/{track_id}/{exp_id}/', 'tracks/{track_id}/experiments/{exp_id}/'],
  ['experiments/{track-id}/{exp-id}/', 'tracks/{track-id}/experiments/{exp-id}/'],
  ['.oma/reference-skills/', '.oma/reference/'],
  ['reference-skills/', 'reference/'],
];

const targets = ['skills', 'AGENTS.md', 'AGENTS.zh-CN.md', 'README.md', 'bin/oma.js', 'configs/cursor-skill-meta.json'];

function patchFile(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  const orig = text;
  for (const [from, to] of reps) {
    text = text.split(from).join(to);
  }
  if (text !== orig) {
    fs.writeFileSync(filePath, text);
    console.log('patched', path.relative(root, filePath));
  }
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(md|json)$/.test(name)) patchFile(p);
  }
}

for (const t of targets) {
  const p = path.join(root, t);
  if (!fs.existsSync(p)) continue;
  if (fs.statSync(p).isDirectory()) walk(p);
  else patchFile(p);
}
