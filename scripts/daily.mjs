// Daily current affairs: read every source, keep EVERY English item (no AI here), tag a rough topic by keywords,
// save to data/digest.json for the site, and send a short Telegram list. Notes are built later, only for items you choose (notes.mjs).
import { getText, parseFeed, isEnglish, abs, clean, esc, tagTopic, telegram, chunk, readJson, writeJson, PHASE, SITE_URL, todayIST } from './lib.mjs';

const UPSC = PHASE === 'OPSC_UPSC';
const PER_SOURCE = 80, MAX_ARTICLES = 500;

const FEEDS = [
  ['Down To Earth', 'https://www.downtoearth.org.in/feed']
];

// PIB serves Hindi unless the English edition (lang=1) is asked for, so every PIB link is forced to English.
function pibEnglish(link) {
  try { const u = new URL(link); if (/(^|\.)pib\.gov\.in$/.test(u.hostname)) { u.searchParams.set('lang', '1'); u.searchParams.set('reg', '3'); return u.href; } } catch (e) {}
  return link;
}
async function readPIB() {
  const errs = [];
  for (const url of ['https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3']) {
    try {
      const items = parseFeed(await getText(url), url).map(x => Object.assign(x, { link: pibEnglish(x.link) })).filter(x => isEnglish(x.title));
      if (items.length) { console.log('PIB: English feed worked,', items.length, 'items'); return items; }
      errs.push('the feed had no English titles');
    } catch (e) { errs.push(e.message); }
  }
  for (const url of ['https://www.pib.gov.in/allRel.aspx?reg=3&lang=1', 'https://pib.gov.in/allRel.aspx?reg=3&lang=1']) {
    try {
      const html = await getText(url), out = [], seen = new Set();
      const re = /<a\b[^>]*href\s*=\s*["']([^"']*PRID=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const title = clean(m[2]), link = pibEnglish(abs(m[1].replace(/&amp;/g, '&'), url));
        if (title.length < 20 || !isEnglish(title) || seen.has(link)) continue;
        seen.add(link); out.push({ title, link, t: Date.now(), snippet: '' });
        if (out.length >= 30) break;
      }
      if (out.length) { console.log('PIB: English release list worked,', out.length, 'items'); return out; }
      errs.push('the release list had no English items');
    } catch (e) { errs.push(e.message); }
  }
  throw new Error('no English PIB items (' + errs.join('; ') + ')');
}
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
  { name: 'PIB', run: readPIB }, { name: 'Vajiram', run: readVajiram }, { name: 'GKToday', run: readGK }
]);
const got = await Promise.all(jobs.map(async j => { try { return { name: j.name, items: await j.run() }; } catch (e) { return { name: j.name, items: [], err: e.message }; } }));
const failed = got.filter(g => !g.items.length).map(g => g.name);
got.filter(g => g.err).forEach(g => console.log('Source problem:', g.name, '-', g.err));
console.log('sources:', got.map(g => g.name + '=' + g.items.length).join(', '));

/* ---------- choose articles ---------- */
const cutoff = Date.now() - 48 * 3600e3;
const seen = new Set(), counts = {}, arts = [];
for (const g of got) for (const j of g.items) {
  if (j.t && j.t < cutoff) continue;
  if (!isEnglish(j.title)) continue;
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

const items = articles.map(a => {
  const tg = tagTopic(a.title, a.snippet);
  return { title: a.title, summary: a.snippet, topic: tg.topic, exams: [], gs: tg.gs, link: a.link, source: a.source, notes: [], key_terms: [], diagram: null };
});
console.log('items kept:', items.length);

/* ---------- Telegram ---------- */
const label = UPSC ? 'OPSC + UPSC' : 'SSC + Odisha';
const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const bySrc = {};
items.forEach(x => { (bySrc[x.source] = bySrc[x.source] || []).push(x); });
const blocks = ['<b>Current Affairs, ' + esc(date) + '</b> (' + label + '): ' + items.length + ' headlines from ' + Object.keys(bySrc).length + ' sources'];
for (const [src, list] of Object.entries(bySrc)) blocks.push('<b>' + esc(src) + '</b> (' + list.length + ')\n' + list.slice(0, 12).map(x => '- ' + esc(x.title)).join('\n') + (list.length > 12 ? '\n+ ' + (list.length - 12) + ' more on the site' : ''));
blocks.push((SITE_URL ? 'Read everything and pick items for notes: ' + SITE_URL : 'Open your Prep Desk site to read everything and pick items for notes.') + (failed.length ? '\nSources with no items: ' + esc(failed.join(', ')) : ''));
for (const c of chunk(blocks)) await telegram(c);

/* ---------- save for the site ---------- */
const day = todayIST();
let list0 = readJson('data/digest.json', []);
if (!Array.isArray(list0)) list0 = [];
const prev = list0.find(x => x.date === day);
list0 = list0.filter(x => x.date !== day);
const have = new Set(items.map(x => x.link));
const merged = items.concat(prev && Array.isArray(prev.items) ? prev.items.filter(x => !have.has(x.link)) : []);
list0.push({ date: day, items: merged });
list0.sort((a, b) => (a.date < b.date ? 1 : -1));
writeJson('data/digest.json', list0.slice(0, 60));
console.log('saved', merged.length, 'items for', day);
