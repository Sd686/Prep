// Notes on demand. The site asks for notes for items YOU choose; only those go to Gemini.
// Input: env LINKS (one address per line). Output: data/notes.json  { link: { summary, notes, key_terms, diagram, full, status, at } }
// Notes are written by Gemini from the article text. Any bullet with a number that is not in the article is dropped, and the best evidence sentences are kept word for word (see makeNotes in lib.mjs).
import { articleTextInfo, makeNotes, readerText, readJson, writeJson, sleep } from './lib.mjs';

const MAX = 12;
const PASTED = String(process.env.PASTED_TEXT || '').trim(), PASTED_LINK = String(process.env.PASTED_LINK || '').trim();
const asked = [...new Set((String(process.env.LINKS || '') + (PASTED_LINK ? '\n' + PASTED_LINK : '')).split(/\s+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x)))].slice(0, MAX);
if (!asked.length) throw new Error('No links were given.');

// Only items that are already on the site can be requested.
const known = new Map();
for (const d of readJson('data/digest.json', [])) for (const it of d.items || []) known.set(it.link, it);
for (const w of readJson('data/research.json', [])) for (const it of w.items || []) known.set(it.link, it);

const notes = readJson('data/notes.json', {});
let built = 0;
for (const link of asked) {
  const it = known.get(link);
  if (!it) { console.log('Skipped (not an item on the site):', link); continue; }
  const rec = { at: new Date().toISOString() };
  try {
    let text = '', why = '';
    if (PASTED && link === PASTED_LINK) { text = PASTED.slice(0, 9000); rec.via = 'pasted'; }
    else {
      const info = await articleTextInfo(link, 7000);
      text = info.text; why = info.why;
      // If the page could not be opened or read, try the reader service. Notes from it carry a tag.
      if (why && /could not be opened|JavaScript|too short/i.test(why)) {
        try { text = await readerText(link, 7000); if (text) { rec.via = 'reader'; why = ''; } } catch (e) { why += ' (reader service also failed: ' + String(e.message).slice(0, 60) + ')'; }
      }
    }
    const n = await makeNotes({ title: it.title, snippet: it.summary || '', source: it.source, link }, text);
    const info = { why };
    Object.assign(rec, { summary: n.summary || '', notes: n.notes || [], key_terms: n.key_terms || [], exam_angle: n.exam_angle || '', evidence: n.evidence || [], ai: !!n.ai, dropped: n.dropped || 0, diagram: n.diagram || null, full: n.full });
    if (!rec.notes.length) rec.status = info.why || 'no suitable sentences were chosen';
  } catch (e) {
    rec.notes = []; rec.status = 'the AI step failed (' + String(e.message).slice(0, 160) + ')';
    console.log('Notes failed for "' + it.title.slice(0, 60) + '":', e.message);
  }
  if (rec.notes && rec.notes.length) built++; else console.log('No notes for "' + it.title.slice(0, 60) + '":', rec.status);
  notes[link] = rec;
  await sleep(Number(process.env.NOTE_PAUSE_MS ?? 4000));
}
// keep the newest 600
const keep = Object.entries(notes).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 600);
writeJson('data/notes.json', Object.fromEntries(keep));
console.log('notes built for', built, 'of', asked.length, 'items');
