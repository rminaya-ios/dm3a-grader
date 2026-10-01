#!/usr/bin/env node
// scripts/alias-cards-to-csv.js
//
// Read a printed DM3A alias-cards PDF and write Last,First,Alias,PrintedName CSV.
//
// WHY THIS EXISTS: the cards students physically hold are the only surviving record of
// an alias set once the vault passphrase is lost. Re-securing a course mints new random
// aliases, so the printed cards and the vault drift apart. This turns the paper back
// into data that "Restore aliases (CSV)" can merge into the vault.
//
//   node scripts/alias-cards-to-csv.js ~/Downloads/MATH1010050-alias-cards.pdf
//   node scripts/alias-cards-to-csv.js <in.pdf> [out.csv]
//
// Requires pdftotext (poppler):  brew install poppler
//
// A NOTE ON THE NAME COLUMNS. The card prints one name line, "<firstName> <lastName>"
// as the vault stored it, so the split back into Last/First is a guess: "Yaileene
// Cordero Ruiz" could be Cordero Ruiz / Yaileene or Ruiz / Yaileene Cordero. The
// PrintedName column is therefore the authoritative one, and the vault merge matches on
// the SET of name words rather than on their order — so a compound surname still lands
// on the right student whichever way this script guessed.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

// Mirrors the card layout in src/blind/aliasCardPdf.js: a 2-column grid where each card
// is "<course> · gen <date>" / name / ALIAS / footer.
const GEN_LINE = /·\s*gen\s/;
const FOOTER = /^Write this DM3A ID/i;
// The alias alphabet excludes 0 O 1 I L (students handwrite these), so an alias is
// "<COURSEPREFIX>-<4 chars>" drawn from that alphabet.
const ALIAS = /^[A-Z0-9]{1,8}-[2-9A-HJ-KM-NP-Z]{3,8}$/;
const COLUMN_GAP = /\s{3,}/; // the gutter between the two card columns

export function parseAliasCardsText(text) {
  const cards = [];          // in print order: left card then right card, row by row
  const open = new Map();    // column index -> card being filled
  const flush = (col) => {
    const c = open.get(col);
    if (c && c.alias) cards.push(c);
    open.delete(col);
  };

  for (const rawLine of String(text || '').split('\n')) {
    if (!rawLine.trim()) continue;
    // Preserve which column each cell came from: a left-column-only line must not be
    // mistaken for the right column's content.
    const cells = rawLine.split(COLUMN_GAP);
    let col = rawLine.match(/^\s*/)[0].length > 40 ? 1 : 0; // an indented lone cell is the right column
    for (const raw of cells) {
      const cell = raw.trim();
      const at = col++;
      if (!cell) continue;
      if (GEN_LINE.test(cell)) {
        flush(at);
        const course = cell.split('·')[0].trim();
        const gen = (cell.match(/gen\s+(.+)$/) || [])[1] || '';
        open.set(at, { course, gen: gen.trim(), printedName: '', alias: '' });
        continue;
      }
      if (FOOTER.test(cell)) continue;
      const card = open.get(at);
      if (!card) continue;
      if (ALIAS.test(cell) && !card.alias) { card.alias = cell; continue; }
      if (!card.printedName) card.printedName = cell;
    }
  }
  for (const col of [...open.keys()]) flush(col);

  return cards.map((c) => {
    const words = c.printedName.split(/\s+/).filter(Boolean);
    // Best effort only — see the note at the top of this file.
    const last = words.length > 1 ? words[words.length - 1] : '';
    const first = words.length > 1 ? words.slice(0, -1).join(' ') : c.printedName;
    return { last, first, alias: c.alias, printedName: c.printedName, course: c.course, gen: c.gen };
  });
}

const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
export const toCsv = (rows) =>
  [['Last', 'First', 'Alias', 'PrintedName'].map(csvCell).join(',')]
    .concat(rows.map((r) => [r.last, r.first, r.alias, r.printedName].map(csvCell).join(',')))
    .join('\n') + '\n';

function main() {
  const [pdfPath, outPath] = process.argv.slice(2);
  if (!pdfPath) {
    console.error('usage: node scripts/alias-cards-to-csv.js <alias-cards.pdf> [out.csv]');
    process.exit(2);
  }
  let text;
  try {
    text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    console.error(`Could not read ${pdfPath} with pdftotext.`);
    console.error(e.status === undefined ? 'Is pdftotext installed?  brew install poppler' : e.message);
    process.exit(1);
  }
  const rows = parseAliasCardsText(text);
  if (!rows.length) {
    console.error('No alias cards found in that PDF. Is it a DM3A alias-cards file?');
    process.exit(1);
  }
  const out = outPath || pdfPath.replace(/\.pdf$/i, '') + '.csv';
  writeFileSync(out, toCsv(rows), 'utf8');

  const gens = [...new Set(rows.map((r) => r.gen))];
  console.log(`${basename(pdfPath)} -> ${out}`);
  console.log(`${rows.length} cards · course ${[...new Set(rows.map((r) => r.course))].join(', ')} · generated ${gens.join(', ')}`);
  if (gens.length > 1) console.log('WARNING: more than one generation date in one file — these cards are not one alias set.');
  const dupes = rows.map((r) => r.alias).filter((a, i, arr) => arr.indexOf(a) !== i);
  if (dupes.length) console.log(`WARNING: duplicate alias in this PDF: ${[...new Set(dupes)].join(', ')}`);
  const blank = rows.filter((r) => !r.printedName || !r.alias).length;
  if (blank) console.log(`WARNING: ${blank} card(s) missing a name or an alias — check the PDF.`);
  console.log('');
  console.log('  #  Alias           Printed name');
  rows.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}  ${r.alias.padEnd(15)} ${r.printedName}`));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
