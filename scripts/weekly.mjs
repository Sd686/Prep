// Weekly GS research: reads think tanks and global bodies, keeps every new item (no AI), saves data/research.json,
// sends a Telegram list. Notes are built later, only for items you choose (notes.mjs).
import { getText, parseFeed, isEnglish, discoverFeeds, scrapeLinks, esc, telegram, chunk, readJson, writeJson, SITE_URL, todayIST } from './lib.mjs';

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

// No AI here. Every new item is kept; notes are built later, only for items you choose (notes.mjs).
let all = readJson('data/research.json', []);
if (!Array.isArray(all)) all = [];
const day = todayIST();
const old = new Set();
all.filter(x => x.date !== day).forEach(w => (w.items || []).forEach(x => old.add(x.link)));
const items = collected.filter(c => !old.has(c.link)).map(c => ({ gs: c.gs, source: c.source, title: c.title, link: c.link, theme: '', summary: c.snippet || '', notes: [], key_terms: [], diagram: null }));
console.log('new items this week:', items.length);

/* ---------- Telegram ---------- */
const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const names = { GS1: 'GS Paper 1', GS2: 'GS Paper 2', GS3: 'GS Paper 3' };
const blocks = ['<b>Weekly GS Research, ' + esc(date) + '</b>: ' + items.length + ' new reports and articles'];
for (const g of ['GS1', 'GS2', 'GS3']) {
  const its = items.filter(x => x.gs === g);
  if (its.length) blocks.push('<b>' + names[g] + '</b> (' + its.length + ')\n' + its.slice(0, 10).map(x => '- ' + esc(x.title) + ' (' + esc(x.source) + ')').join('\n') + (its.length > 10 ? '\n+ ' + (its.length - 10) + ' more on the site' : ''));
}
blocks.push('Sources reached: ' + reached + ' of ' + results.length + (missed.length ? '. Could not read: ' + esc(missed.join(', ')) : '') + (SITE_URL ? '\nRead all and pick items for notes: ' + SITE_URL : ''));
for (const c of chunk(blocks)) await telegram(c);

/* ---------- save ---------- */
all = all.filter(x => x.date !== day);
const prevDay = readJson('data/research.json', []).find(x => x.date === day);
const have = new Set(items.map(x => x.link));
const merged = items.concat(prevDay && Array.isArray(prevDay.items) ? prevDay.items.filter(x => !have.has(x.link)) : []);
all.push({ date: day, items: merged, questions: [], reached, total: results.length, missed });
all.sort((a, b) => (a.date < b.date ? 1 : -1));
writeJson('data/research.json', all.slice(0, 26));
console.log('saved', merged.length, 'research items');
