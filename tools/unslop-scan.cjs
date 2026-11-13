#!/usr/bin/env node
// Scans player-facing strings and Markdown docs for AI-writing tells.
// Usage: node tools/unslop-scan.cjs [--json] [--hits rule]
// Player-facing = string/template literals in commands/, utils/, services/,
// progression/, bot_final.js, and text in public/**/*.html|js (minus sprites/data).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'sprites', '.git', 'audit-data', 'mockups', 'previews', 'review', 'm3-previews']);

const RULES = [
  { id: 'R13-emdash', re: /—/g },
  { id: 'R19-curly', re: /[“”‘’]/g },
  { id: 'R7-vocab', re: /\b(additionally|crucial|delve|enduring|enhance[sd]?|fostering|garner|interplay|intricate|pivotal|showcas(e|es|ing)|tapestry|testament|underscore[sd]?|vibrant|seamless(ly)?|elevate[sd]?|unleash(es|ed)?|embark|journey|realm|epic adventure|ultimate)\b/gi },
  { id: 'R8-copula', re: /\b(serves as|stands as|boasts)\b/gi },
  { id: 'R9-notjust', re: /\bnot (just|only) [^.!?]{1,60}\bbut\b/gi },
  { id: 'R3-ing-tail', re: /, (ensuring|highlighting|reflecting|showcasing|fostering|making it|allowing (you|players))\b/gi },
  { id: 'R20-chatbot', re: /(let me know|hope this helps|of course!|certainly!|great question|absolutely!|happy to help|feel free to)/gi },
  { id: 'R23-filler', re: /\b(in order to|due to the fact|it is important to note|please note that|simply|just click)\b/gi },
  { id: 'R31-fancy', re: /\b(utiliz(e|es|ing)|leverag(e|es|ing)|facilitat(e|es)|numerous|in the event that)\b/gi },
  { id: 'R26-jargon', re: /\b(substrate|paradigm|flywheel|north star|bedrock|nexus|modality)\b/gi },
  { id: 'R25-hype', re: /(get ready|the future looks|like never before|take your .* to the next level|awaits!?|let'?s go!|level up your)/gi },
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Pull string literals out of JS so code identifiers and comments don't count.
function jsStrings(src) {
  const strs = [];
  const re = /(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/g;
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, a) => a + m.slice(a.length).replace(/./g, ' '));
  let m;
  while ((m = re.exec(noComments))) {
    const s = m[0].slice(1, -1);
    if (/[a-z] [a-z]/i.test(s)) strs.push({ s, line: noComments.slice(0, m.index).split('\n').length });
  }
  return strs;
}

function htmlText(src) {
  const body = src.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  return body.split('\n').map((l, i) => ({ s: l.replace(/<[^>]+>/g, ' '), line: i + 1 }));
}

function mdText(src) {
  let inFence = false;
  return src.split('\n').map((l, i) => {
    if (/^```/.test(l)) { inFence = !inFence; return null; }
    return inFence ? null : { s: l, line: i + 1 };
  }).filter(Boolean);
}

const PLAYER_JS = ['commands', 'utils', 'services', 'progression', 'catalog', 'public'];
const files = [];
for (const d of PLAYER_JS) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d), files);
files.push(path.join(ROOT, 'bot_final.js'));
const docs = walk(path.join(ROOT, 'docs'), []).filter(f => f.endsWith('.md'))
  .concat(['README.md', 'RUNBOOK.md', 'CONTEXT.md'].map(f => path.join(ROOT, f)));

const results = [];
function scan(file, chunks, kind) {
  for (const { s, line } of chunks) {
    for (const r of RULES) {
      r.re.lastIndex = 0;
      const hits = (s.match(r.re) || []).filter(h => h !== 'Showcase'); // the Showcase team is a game term
      if (!hits.length) continue;
      results.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line, rule: r.id, kind, n: hits.length, text: s.trim().slice(0, 160) });
    }
  }
}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.js') && !/pokemonData|trainerSprites|spriteconfig/.test(f)) scan(f, jsStrings(src), 'player');
  else if (f.endsWith('.html')) scan(f, htmlText(src), 'player');
}
for (const f of docs) if (fs.existsSync(f)) scan(f, mdText(fs.readFileSync(f, 'utf8')), 'doc');

const args = process.argv.slice(2);
if (args.includes('--json')) { process.stdout.write(JSON.stringify(results, null, 1)); process.exit(0); }
const hitsFor = args[args.indexOf('--hits') + 1];
if (args.includes('--hits')) {
  for (const r of results.filter(r => r.rule.startsWith(hitsFor))) console.log(`${r.kind}\t${r.file}:${r.line}\t${r.text}`);
  process.exit(0);
}
const tally = {};
for (const r of results) {
  const k = `${r.kind}\t${r.rule}`;
  tally[k] = (tally[k] || 0) + r.n;
}
console.log('kind\trule\tcount');
for (const [k, v] of Object.entries(tally).sort()) console.log(`${k}\t${v}`);
const byFile = {};
for (const r of results.filter(r => r.kind === 'player')) byFile[r.file] = (byFile[r.file] || 0) + r.n;
console.log('\nplayer-facing hits by file:');
for (const [f, v] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${v}\t${f}`);
