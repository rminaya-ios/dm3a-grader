// src/blind/aliasVerify.js
// DM3A — the check that runs BEFORE a roster is switched over.
//
// An alias is a promise made on paper. Students wrote their code on work that is already
// handed in, and a code that changes underneath them cannot be matched back to anyone.
// Twice now a roster operation has silently rewritten a live alias set, so nothing may
// replace a roster until the new aliases have been compared, one student at a time,
// against the cards the students are actually holding — and the comparison has to be
// something a non-programmer can read and sign off.
//
// Two jobs:
//   buildAliasMatchReport  — compare a proposed roster against a printed alias-cards CSV
//                            and say exactly who agrees, who differs, and who is missing
//   assertAliasesPreserved — the invariant: an alias that already exists may never change
//
// Pure: no DOM, no network, no crypto. Unit-tested in test/aliasVerify.test.js.

import { nameKey } from './rosterMerge.js';

const norm = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const idKey = (v) => String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
const noZeros = (v) => idKey(v).replace(/^0+/, '');

const rosterName = (s) =>
  nameKey(s && s.studentName) || nameKey(s && s.firstName, s && s.lastName) || '';
const cardName = (c) =>
  nameKey(c && (c.printedName || c.name)) || nameKey(c && c.first, c && c.last) || '';

const label = (x) =>
  (x && (x.studentName || x.printedName || x.name)) ||
  `${(x && (x.firstName || x.first)) || ''} ${(x && (x.lastName || x.last)) || ''}`.trim() ||
  '(unnamed)';

// Identify the same person across a roster and a card list. Cards carry only a name, so
// the name key is the join; Username / Student ID are used when the card CSV happens to
// carry them (the rebuild path pairs cards with a Blackboard roster download).
function indexRoster(roster) {
  const byName = new Map(), byUser = new Map(), byId = new Map();
  (roster || []).forEach((s, i) => {
    const nk = rosterName(s);
    // A duplicated name key is marked ambiguous rather than resolving to whichever came
    // first: two students with the same words must not be matched by name at all.
    if (nk) byName.set(nk, byName.has(nk) ? null : i);
    if (s && s.bbUsername) byUser.set(idKey(s.bbUsername), i);
    if (s && s.studentId) { byId.set(idKey(s.studentId), i); byId.set(noZeros(s.studentId), i); }
  });
  return { byName, byUser, byId };
}

// Compare `roster` (what would be stored) against `cards` (what students hold).
//
// Returns counts plus four lists, each carrying readable labels so the caller can print
// them without knowing the roster's shape:
//   agree             alias on the card === alias in the roster
//   differ            BOTH have an alias and they are NOT the same   ← the dangerous list
//   cardsNotInRoster  a card for somebody the roster does not contain
//   rosterNotOnCards  a roster student with no card
export function buildAliasMatchReport(roster, cards, { course = '' } = {}) {
  const list = Array.isArray(roster) ? roster : [];
  const cardList = (Array.isArray(cards) ? cards : []).filter((c) => c && (c.alias || cardName(c)));
  const { byName, byUser, byId } = indexRoster(list);

  const agree = [], differ = [], cardsNotInRoster = [], ambiguous = [];
  const seenRoster = new Set();

  for (const card of cardList) {
    let idx;
    if (card.username && byUser.has(idKey(card.username))) idx = byUser.get(idKey(card.username));
    else if (card.studentId && byId.has(idKey(card.studentId))) idx = byId.get(idKey(card.studentId));
    else {
      const nk = cardName(card);
      if (nk && byName.get(nk) === null) { ambiguous.push({ card: label(card), reason: 'two roster students share this name' }); continue; }
      if (nk && byName.has(nk)) idx = byName.get(nk);
    }
    if (idx === undefined) { cardsNotInRoster.push({ card: label(card), alias: card.alias || '' }); continue; }
    seenRoster.add(idx);
    const student = list[idx];
    const want = norm(card.alias), have = norm(student.alias);
    const row = { student: label(student), cardAlias: card.alias || '', rosterAlias: student.alias || '' };
    if (want && have && want === have) agree.push(row);
    else differ.push(row);
  }

  const rosterNotOnCards = list
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !seenRoster.has(i))
    .map(({ s }) => ({ student: label(s), rosterAlias: s.alias || '', dropped: !!s.dropped }));

  // An alias belonging to two students would attach two people's work to one code.
  const dupe = (arr, get) => {
    const seen = new Map(), out = [];
    for (const x of arr) {
      const k = norm(get(x));
      if (!k) continue;
      if (seen.has(k)) out.push(get(x)); else seen.set(k, true);
    }
    return [...new Set(out)];
  };

  return {
    course,
    totals: {
      roster: list.length,
      cards: cardList.length,
      agree: agree.length,
      differ: differ.length,
      cardsNotInRoster: cardsNotInRoster.length,
      rosterNotOnCards: rosterNotOnCards.length,
    },
    agree,
    differ,
    cardsNotInRoster,
    rosterNotOnCards,
    ambiguous,
    duplicateRosterAliases: dupe(list, (s) => s.alias),
    duplicateCardAliases: dupe(cardList, (c) => c.alias),
    // SAFE means: every card matched a student and every matched alias is identical.
    // Anything else needs a human decision — never an automatic switch-over.
    safe:
      differ.length === 0 &&
      cardsNotInRoster.length === 0 &&
      ambiguous.length === 0 &&
      dupe(list, (s) => s.alias).length === 0 &&
      dupe(cardList, (c) => c.alias).length === 0 &&
      agree.length > 0,
  };
}

// The report as something an instructor reads and signs off, not a data structure.
export function renderAliasMatchReport(report) {
  const r = report || {};
  const t = r.totals || {};
  const out = [];
  out.push(`Alias match report${r.course ? ` — ${r.course}` : ''}`);
  out.push(`${t.agree || 0} of ${t.cards || 0} printed cards match the roster exactly.`);
  if (r.safe) out.push(`SAFE TO SWITCH: every card matched a student and every alias is identical.`);
  else out.push(`DO NOT SWITCH YET — see below.`);

  if (t.differ) {
    out.push('', `${t.differ} student(s) would get a DIFFERENT alias than the card they hold:`);
    for (const d of r.differ.slice(0, 40)) out.push(`   ${d.student}: card ${d.cardAlias || '(none)'} -> roster ${d.rosterAlias || '(none)'}`);
    if (r.differ.length > 40) out.push(`   …and ${r.differ.length - 40} more`);
  }
  if (t.cardsNotInRoster) {
    out.push('', `${t.cardsNotInRoster} printed card(s) belong to nobody in this roster:`);
    for (const c of r.cardsNotInRoster.slice(0, 20)) out.push(`   ${c.card} (${c.alias})`);
  }
  if (t.rosterNotOnCards) {
    out.push('', `${t.rosterNotOnCards} roster student(s) have no printed card (new students, or a card set from before they enrolled):`);
    for (const s of r.rosterNotOnCards.slice(0, 20)) out.push(`   ${s.student} (${s.rosterAlias || 'no alias'})${s.dropped ? ' [dropped]' : ''}`);
  }
  for (const a of r.ambiguous || []) out.push('', `AMBIGUOUS: ${a.card} — ${a.reason}`);
  if ((r.duplicateRosterAliases || []).length) out.push('', `DUPLICATE alias in the roster: ${r.duplicateRosterAliases.join(', ')}`);
  if ((r.duplicateCardAliases || []).length) out.push('', `DUPLICATE alias on the cards: ${r.duplicateCardAliases.join(', ')}`);
  return out.join('\n');
}

// ── The invariant ──────────────────────────────────────────────────────────
// Aliases are permanent once issued. New students get new aliases; a student who leaves
// is marked inactive, never deleted mid-term. No code path may change an alias that
// already exists — this is the rule whose absence caused both September incidents, and
// it is meant to be called by every write path, not just the migration.
export function assertAliasesPreserved(before, after) {
  const prior = indexRoster(before || []);
  const violations = [];
  const dropped = [];

  const findPrior = (s) => {
    if (s && s.bbUsername && prior.byUser.has(idKey(s.bbUsername))) return (before || [])[prior.byUser.get(idKey(s.bbUsername))];
    if (s && s.studentId && prior.byId.has(idKey(s.studentId))) return (before || [])[prior.byId.get(idKey(s.studentId))];
    const nk = rosterName(s);
    if (nk && prior.byName.get(nk) != null) return (before || [])[prior.byName.get(nk)];
    return null;
  };

  const seen = new Set();
  for (const s of after || []) {
    const was = findPrior(s);
    if (!was) continue; // a new student — a new alias is expected
    seen.add(was);
    if (was.alias && s.alias && norm(was.alias) !== norm(s.alias)) {
      violations.push({ student: label(s), from: was.alias, to: s.alias });
    }
    if (was.alias && !s.alias) violations.push({ student: label(s), from: was.alias, to: '(removed)' });
  }
  for (const was of before || []) {
    if (!seen.has(was)) dropped.push({ student: label(was), alias: was.alias || '' });
  }
  return { ok: violations.length === 0, violations, dropped };
}
