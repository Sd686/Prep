// GS research and global reports (runs daily): reads think tanks and global bodies, keeps every new item (no AI), saves data/research.json,
// sends a Telegram list. Notes are built later, only for items you choose (notes.mjs).
import { effectiveSources } from './sources.mjs';
import { getText, parseFeed, isEnglish, discoverFeeds, scrapeLinks, esc, telegram, chunk, readJson, writeJson, SITE_URL, todayIST } from './lib.mjs';

const DAYS_BACK = 10;


async function handle(s) {
  const res = { name: s.name, type: s.type || '', gs: s.gs, method: 'none', items: [] };
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
        res.items = parseFeed(xml, u).filter(x => x.t === null || x.t >= cut).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 10);
        break;
      }
    } catch (e) {}
  }
  if (res.method === 'none' && html) {
    res.items = scrapeLinks(html, s.page, 8);
    if (res.items.length) res.method = 'page';
  }
  return res;
}
const { sources: SRC } = await effectiveSources();
const results = await Promise.all(SRC.map(handle));
const collected = [];
results.forEach(r => r.items.filter(x => isEnglish(x.title)).forEach(x => collected.push({ id: collected.length + 1, source: r.name, stype: r.type, gs: r.gs, title: x.title, link: x.link, dated: x.t !== null, snippet: x.snippet })));
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
const items = collected.filter(c => !old.has(c.link)).map(c => ({ gs: c.gs, source: c.source, stype: c.stype, title: c.title, link: c.link, theme: '', summary: c.snippet || '', notes: [], key_terms: [], diagram: null }));
console.log('new items this week:', items.length);

/* ---------- Telegram ---------- */
const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const names = { GS1: 'GS Paper 1', GS2: 'GS Paper 2', GS3: 'GS Paper 3' };
const blocks = ['<b>GS Research and Reports, ' + esc(date) + '</b>: ' + items.length + ' new items'];
for (const g of ['GS1', 'GS2', 'GS3']) {
  const its = items.filter(x => x.gs === g);
  if (its.length) blocks.push('<b>' + names[g] + '</b> (' + its.length + ')\n' + its.slice(0, 10).map(x => '- ' + esc(x.title) + ' (' + esc(x.source) + ')').join('\n') + (its.length > 10 ? '\n+ ' + (its.length - 10) + ' more on the site' : ''));
}
blocks.push('Sources reached: ' + reached + ' of ' + results.length + (missed.length ? '. Could not read: ' + esc(missed.join(', ')) : '') + (SITE_URL ? '\nRead all and pick items for notes: ' + SITE_URL : ''));
if (items.length) for (const c of chunk(blocks)) await telegram(c);

/* ---------- save ---------- */
all = all.filter(x => x.date !== day);
const prevDay = readJson('data/research.json', []).find(x => x.date === day);
const have = new Set(items.map(x => x.link));
const merged = items.concat(prevDay && Array.isArray(prevDay.items) ? prevDay.items.filter(x => !have.has(x.link)) : []);
all.push({ date: day, items: merged, questions: [], reached, total: results.length, missed });
all.sort((a, b) => (a.date < b.date ? 1 : -1));
writeJson('data/research.json', all.filter(x => (x.items || []).length).slice(0, 60));
console.log('saved', merged.length, 'research items');
