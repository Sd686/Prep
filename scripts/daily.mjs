// Daily current affairs: read feeds, pick exam-relevant items, build notes from the source's own sentences,
// save to data/digest.json for the site, and send a short Telegram message.
import { getText, parseFeed, clean, esc, gemini, makeNotes, articleText, telegram, chunk, readJson, writeJson, sleep, PHASE, SITE_URL, todayIST } from './lib.mjs';

const UPSC = PHASE === 'OPSC_UPSC';
const PER_SOURCE = 12, MAX_ARTICLES = 60;
const PICKS = Number(process.env.PICKS) || (UPSC ? 10 : 12);
const NOTE_PAUSE = Number(process.env.NOTE_PAUSE_MS ?? 4000);

const FEEDS = [
  ['PIB', 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3'],
  ['Down To Earth', 'https://www.downtoearth.org.in/feed']
];

async function readFeed([name, url]) {
  const xml = await getText(url);
  const items = parseFeed(xml, url);
  if (!items.length) throw new Error('no items');
  return items;
}
async function readVajiram() {
  const raw = await getText('https://vajiramandravi.com/current-affairs/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc&_fields=title,link,date_gmt,excerpt');
  const out = [];
  for (const j of JSON.parse(raw)) {
    const title = clean(j.title && (j.title.rendered || j.title));
    if (!title || !j.link || /^(monthly|weekly)\s+current affairs/i.test(title)) continue;
    out.push({ title, link: j.link, t: Date.parse(j.date_gmt ? j.date_gmt + 'Z' : j.date) || null, snippet: clean(j.excerpt && j.excerpt.rendered).slice(0, 300) });
  }
  return out;
}
async function readGK() {
  const html = await getText('https://www.gktoday.in/');
  const skip = /^(page|category|categories|topics|tag|author|hindi|current-affairs|about|about-us|contact|contact-us|privacy-policy|terms|search|feed|wp-content|wp-json)$/i;
  const out = [], seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let u; try { u = new URL(m[1], 'https://www.gktoday.in/'); } catch (e) { continue; }
    if (!/(^|\.)gktoday\.in$/.test(u.hostname)) continue;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 1 || skip.test(parts[0]) || parts[0].indexOf('-') < 0) continue;
    const title = clean(m[2]);
    if (title.length < 25 || title.split(' ').length < 4) continue;
    const href = u.origin + u.pathname;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ title, link: href, t: Date.now(), snippet: '' });
    if (out.length >= 20) break;
  }
  return out;
}

const jobs = FEEDS.map(f => ({ name: f[0], run: () => readFeed(f) })).concat([
  { name: 'Vajiram', run: readVajiram }, { name: 'GKToday', run: readGK }
]);
const got = await Promise.all(jobs.map(async j => { try { return { name: j.name, items: await j.run() }; } catch (e) { return { name: j.name, items: [], err: e.message }; } }));
const failed = got.filter(g => !g.items.length).map(g => g.name);
console.log('sources:', got.map(g => g.name + '=' + g.items.length).join(', '));

/* ---------- choose articles ---------- */
const cutoff = Date.now() - 36 * 3600e3;
const seen = new Set(), counts = {}, arts = [];
for (const g of got) for (const j of g.items) {
  if (j.t && j.t < cutoff) continue;
  const key = j.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
  if (seen.has(key)) continue;
  seen.add(key);
  let host = ''; try { host = new URL(j.link).hostname.replace(/^www\./, ''); } catch (e) {}
  counts[host] = (counts[host] || 0) + 1;
  if (counts[host] > PER_SOURCE) continue;
  arts.push({ title: j.title, link: j.link, source: host, snippet: j.snippet || '', t: j.t || Date.now() });
}
arts.sort((a, b) => b.t - a.t);
const articles = arts.slice(0, MAX_ARTICLES);
if (!articles.length) {
  await telegram('<b>Daily digest</b>\nNo source could be read today. Failed: ' + esc(failed.join(', ')));
  throw new Error('No articles could be read from any source.');
}

const focus = UPSC
  ? 'Audience: an aspirant for OPSC (OAS) and UPSC Civil Services. Prioritise polity and governance, economy, environment, international relations, science and technology, social issues, and Odisha items for OPSC.'
  : 'Audience: an aspirant for SSC (CGL, CHSL, MTS) and Odisha government exams (OSSC, OSSSC, OTET, Odisha Police and similar). Prioritise static-GK style facts: schemes, appointments, awards, summits, reports and indices, sports, science and technology, defence, and Odisha-specific news.';
const list = articles.map((a, i) => (i + 1) + '. [' + a.source + '] ' + a.title + (a.snippet ? ' | ' + a.snippet : '')).join('\n');
const pickPrompt = [
  'You are a current affairs editor for Indian government exam aspirants.', focus,
  'From the numbered articles below, pick the ' + PICKS + ' most exam-relevant. Ignore crime, entertainment, routine party politics and opinion pieces.',
  'You only choose and label. Do not write any facts. For each pick return: id (the article number), topic (one of: Polity, Economy, Environment, Science and Tech, International, Defence, Sports, Awards and Reports, Schemes, Odisha, History and Culture, Geography, Other), exams (array using only SSC, OSSC/OSSSC, OPSC, UPSC), gs (one of GS1, GS2, GS3, GS4 or empty string).',
  'Source notes: downtoearth.org.in is the main environment source, so include at least 2 environment items when available. gktoday.in and vajiramandravi.com are exam-oriented. pib.gov.in carries official releases, so prefer it for schemes and policies. Skip generic evergreen or compilation pages.',
  'Return JSON only, shaped as {"items":[...]}.', 'Articles:', list
].join('\n\n');

let picks = [], ai = true;
try {
  const r = await gemini(pickPrompt);
  picks = (r.items || []).map(x => { const a = articles[Number(x.id) - 1]; return a ? { a, topic: x.topic || '', exams: Array.isArray(x.exams) ? x.exams : [], gs: x.gs || '' } : null; }).filter(Boolean);
} catch (e) { console.log('Pick step failed:', e.message); ai = false; }
if (!picks.length) { ai = false; picks = articles.slice(0, 15).map(a => ({ a, topic: '', exams: [], gs: '' })); }

/* ---------- notes and diagrams ---------- */
const items = [];
for (const p of picks) {
  const item = { title: p.a.title, summary: p.a.snippet, topic: p.topic, exams: p.exams, gs: p.gs, link: p.a.link, source: p.a.source, notes: [], key_terms: [], diagram: null };
  if (ai) {
    try {
      const text = await articleText(p.a.link, 6000);
      const n = await makeNotes(p.a, text);
      Object.assign(item, n);
      if (!n.summary) item.summary = p.a.snippet;
    } catch (e) { console.log('Notes failed for "' + p.a.title.slice(0, 50) + '":', e.message); }
    await sleep(NOTE_PAUSE);
  }
  items.push(item);
}

/* ---------- Telegram ---------- */
const label = UPSC ? 'OPSC + UPSC' : 'SSC + Odisha';
const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const blocks = ['<b>Current Affairs, ' + esc(date) + '</b> (' + label + ')' + (ai ? '' : '\nAI summary unavailable today, showing raw headlines.')];
items.forEach((x, i) => {
  const lines = ['<b>' + (i + 1) + '. ' + esc(x.title) + '</b>'];
  if (x.summary) lines.push(esc(x.summary));
  const meta = [x.topic, (x.exams || []).join(', ')].filter(Boolean).join(' | ');
  if (meta) lines.push('<i>' + esc(meta) + '</i>');
  blocks.push(lines.join('\n'));
});
blocks.push((SITE_URL ? 'Full notes and diagrams: ' + esc(SITE_URL) : '') + (failed.length ? '\nCould not read: ' + esc(failed.join(', ')) : ''));
for (const c of chunk(blocks)) await telegram(c);

/* ---------- save for the site ---------- */
const day = todayIST();
let list0 = readJson('data/digest.json', []);
if (!Array.isArray(list0)) list0 = [];
list0 = list0.filter(x => x.date !== day);
list0.push({ date: day, items });
list0.sort((a, b) => (a.date < b.date ? 1 : -1));
writeJson('data/digest.json', list0.slice(0, 90));
console.log('saved', items.length, 'items for', day);
