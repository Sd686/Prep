// Weekly GS research: think tanks and global bodies. Picks the most useful items per GS paper,
// builds notes from the source's own sentences, with a diagram, saves data/research.json for the site, sends a Telegram summary.
import { getText, parseFeed, isEnglish, discoverFeeds, scrapeLinks, esc, gemini, makeNotes, articleTextInfo, telegram, chunk, readJson, writeJson, sleep, SITE_URL, todayIST } from './lib.mjs';

const DAYS_BACK = 10;
const SOURCES = [
  { name: 'Centre for Equity Studies', gs: 'GS1', page: 'https://www.centreforequitystudies.org/' },
  { name: 'Population Foundation of India', gs: 'GS1', page: 'https://www.populationfoundation.in/' },
  { name: 'NIUA', gs: 'GS1', page: 'https://niua.in/' },
  { name: 'Sahapedia', gs: 'GS1', page: 'https://www.sahapedia.org/' },
  { name: 'PRS Legislative Research', gs: 'GS2', page: 'https://prsindia.org/theprsblog' },
  { name: 'Vidhi Centre for Legal Policy', gs: 'GS2', page: 'https://vidhilegalpolicy.in/blog/' },
  { name: 'ADR', gs: 'GS2', page: 'https://adrindia.org/' },
  { name: 'ORF', gs: 'GS2', page: 'https://www.orfonline.org/all-updates' },
  { name: 'Accountability Initiative', gs: 'GS2', page: 'https://accountabilityindia.in/' },
  { name: 'ICRIER', gs: 'GS3', page: 'https://icrier.org/publication/' },
  { name: 'CSE', gs: 'GS3', page: 'https://www.cseindia.org/' },
  { name: 'Manohar Parrikar IDSA', gs: 'GS3', page: 'https://www.idsa.in/' },
  { name: 'NITI Aayog', gs: 'GS3', page: 'https://www.niti.gov.in/' },
  // Global bodies. days widens the look-back because flagship reports come out rarely.
  { name: 'UN News', gs: 'GS2', days: 14, page: 'https://news.un.org/en/', feeds: ['https://news.un.org/feed/subscribe/en/news/all/rss.xml'] },
  { name: 'UNDP', gs: 'GS2', days: 45, page: 'https://www.undp.org/publications' },
  { name: 'UNEP', gs: 'GS3', days: 45, page: 'https://www.unep.org/resources' },
  { name: 'FAO', gs: 'GS3', days: 45, page: 'https://www.fao.org/publications/home/en' },
  { name: 'UNCTAD', gs: 'GS3', days: 45, page: 'https://unctad.org/publications' },
  { name: 'WHO', gs: 'GS2', days: 30, page: 'https://www.who.int/news', feeds: ['https://www.who.int/rss-feeds/news-english.xml'] },
  { name: 'World Bank', gs: 'GS3', days: 45, page: 'https://www.worldbank.org/en/research' },
  { name: 'IMF', gs: 'GS3', days: 45, page: 'https://www.imf.org/en/publications' },
  { name: 'World Economic Forum', gs: 'GS3', days: 45, page: 'https://www.weforum.org/publications/' },
  { name: 'IEA', gs: 'GS3', days: 45, page: 'https://www.iea.org/reports' }
];

async function handle(s) {
  const res = { name: s.name, gs: s.gs, method: 'none', items: [] };
  let html = '';
  try { html = await getText(s.page, { timeout: 20000 }); } catch (e) {}
  let origin = ''; try { origin = new URL(s.page).origin; } catch (e) {}
  const cands = (s.feeds || []).concat(discoverFeeds(html, s.page));
  ['/feed/', '/rss.xml', '/feed', '/rss'].forEach(p => cands.push(origin + p));
  const tried = new Set();
  for (const u of cands) {
    if (!origin || !u || tried.has(u)) continue;
    tried.add(u);
    if (tried.size > 6) break;
    try {
      const xml = await getText(u, { timeout: 20000 });
      if (/<(item|entry)[\s>]/i.test(xml)) {
        res.method = 'feed';
        const cut = Date.now() - (s.days || DAYS_BACK) * 86400000;
        res.items = parseFeed(xml, u).filter(x => x.t === null || x.t >= cut).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 6);
        break;
      }
    } catch (e) {}
  }
  if (res.method === 'none' && html) {
    res.items = scrapeLinks(html, s.page, 5);
    if (res.items.length) res.method = 'page';
  }
  return res;
}
const results = await Promise.all(SOURCES.map(handle));
const collected = [];
results.forEach(r => r.items.filter(x => isEnglish(x.title)).forEach(x => collected.push({ id: collected.length + 1, source: r.name, gs: r.gs, title: x.title, link: x.link, dated: x.t !== null, snippet: x.snippet })));
const reached = results.filter(r => r.method !== 'none').length;
const missed = results.filter(r => r.method === 'none').map(r => r.name);
console.log('reached', reached, 'of', results.length, '; items', collected.length);
if (!reached) throw new Error('No research source could be read.');

let picks = [], questions = [], ai = true;
if (collected.length) {
  const list = collected.map(x => x.id + '. [' + x.gs + ' | ' + x.source + (x.dated ? '' : ' | date unknown') + '] ' + x.title + (x.snippet ? ' | ' + x.snippet : '')).join('\n');
  const prompt = [
    'You are a research editor helping an aspirant for UPSC and OPSC Mains (GS Papers 1 to 3).',
    'Below are numbered items from think tanks, research portals and global bodies, each tagged with its GS paper and source. Items marked date unknown were read from a web page, so they may be older.',
    'Pick up to 4 items per GS paper that are most useful for Mains answers: reports, data, policy analysis, bills and legal debates. Skip event announcements, job posts, fundraising and promotional pages.',
    'Items from UN agencies, the World Bank, IMF, WHO, WEF, IEA and similar bodies are global reports. Prefer flagship reports, indices and datasets over routine news.',
    'You only choose and label. Do not write any facts. For each pick return: id, theme (two to four words).',
    'Then write one Mains-style practice question (150 words, 10 marks) for each GS paper that has picks, based on those picks. The question must not state any fact that is not in the item text: gs (GS1, GS2 or GS3), question.',
    'Return JSON only, shaped as {"items":[...],"questions":[...]}.', 'Items:', list
  ].join('\n\n');
  try {
    const r = await gemini(prompt);
    picks = (r.items || []).map(x => { const a = collected.find(c => c.id === Number(x.id)); return a ? { a, theme: String(x.theme || '') } : null; }).filter(Boolean).slice(0, 12);
    questions = (Array.isArray(r.questions) ? r.questions : []).map(q => ({ gs: String(q.gs || ''), question: String(q.question || '') })).filter(q => q.question);
  } catch (e) { console.log('Pick step failed:', e.message); ai = false; }
  if (!picks.length) { ai = false; picks = collected.slice(0, 18).map(a => ({ a, theme: '' })); }
}

const items = [];
for (const p of picks) {
  const item = { gs: p.a.gs, source: p.a.source, title: p.a.title, link: p.a.link, theme: p.theme, summary: p.a.snippet, notes: [], key_terms: [], diagram: null };
  if (ai) {
    try {
      const info = await articleTextInfo(p.a.link, 7000);
      const n = await makeNotes(p.a, info.text);
      item.summary = n.summary || item.summary; item.notes = n.notes; item.key_terms = n.key_terms; item.diagram = n.diagram; item.full = n.full;
      if (!n.notes.length) item.status = info.why || 'no suitable sentences were chosen';
    } catch (e) { item.status = 'the AI step failed (' + String(e.message).slice(0, 120) + ')'; console.log('Notes failed for', p.a.title.slice(0, 50), e.message); }
    await sleep(Number(process.env.NOTE_PAUSE_MS ?? 4000));
  } else item.status = 'the AI step was unavailable this week';
  items.push(item);
}

const withNotes = items.filter(x => x.notes && x.notes.length).length;
console.log('notes built for', withNotes, 'of', items.length, 'items');
items.filter(x => x.status).forEach(x => console.log('No notes for "' + x.title.slice(0, 50) + '" (' + x.source + '):', x.status));

/* ---------- Telegram ---------- */
const names = { GS1: 'GS Paper 1: Society, Culture and Geography', GS2: 'GS Paper 2: Governance, Polity and IR', GS3: 'GS Paper 3: Economy, Environment and Security' };
const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const blocks = ['<b>Weekly GS Research Digest, ' + esc(date) + '</b>' + (ai ? '' : '\nAI summary unavailable this week, showing raw titles.')];
for (const g of ['GS1', 'GS2', 'GS3']) {
  const its = items.filter(x => x.gs === g);
  if (!its.length) continue;
  const lines = ['<b>' + names[g] + '</b>'];
  its.forEach((x, i) => { lines.push('', '<b>' + (i + 1) + '. ' + esc(x.title) + '</b> (' + esc(x.source) + ')'); if (x.summary) lines.push(esc(x.summary)); });
  blocks.push(lines.join('\n'));
}
if (!items.length) blocks.push('No new items found this week.');
if (questions.length) blocks.push('<b>Practice questions</b> (written by AI, not from the sources)\n' + questions.map(q => esc(q.gs) + ': ' + esc(q.question)).join('\n\n'));
blocks.push('Notes built for ' + withNotes + ' of ' + items.length + ' items. Sources reached: ' + reached + ' of ' + results.length + (missed.length ? '. Could not read: ' + esc(missed.join(', ')) : '') + (SITE_URL ? '\nFull notes and diagrams: ' + esc(SITE_URL) + '#research' : ''));
for (const c of chunk(blocks)) await telegram(c);

/* ---------- save ---------- */
let all = readJson('data/research.json', []);
if (!Array.isArray(all)) all = [];
const day = todayIST();
all = all.filter(x => x.date !== day);
all.push({ date: day, items, questions, reached, total: results.length, missed });
all.sort((a, b) => (a.date < b.date ? 1 : -1));
writeJson('data/research.json', all.slice(0, 26));
console.log('saved', items.length, 'research items');
