// Notes on demand. The site asks for notes for items YOU choose; only those go to Gemini.
// Input: env LINKS (one address per line). Output: data/notes.json  { link: { summary, notes, key_terms, diagram, full, status, at } }
// Sentences are copied word for word from the article page (see makeNotes in lib.mjs).
import { articleTextInfo, makeNotes, readJson, writeJson, sleep } from './lib.mjs';

const MAX = 12;
const asked = [...new Set(String(process.env.LINKS || '').split(/\s+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x)))].slice(0, MAX);
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
    const info = await articleTextInfo(link, 7000);
    const n = await makeNotes({ title: it.title, snippet: it.summary || '', source: it.source, link }, info.text);
    Object.assign(rec, { summary: n.summary || '', notes: n.notes || [], key_terms: n.key_terms || [], diagram: n.diagram || null, full: n.full });
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
