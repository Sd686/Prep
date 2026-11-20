// "Check sources": opens every source once from GitHub's servers and reports what works.
// For each source it tries the front page or feed, then one article, then the reader service for failures.
// Writes data/sourcecheck.json (shown on the site, Resources tab) and a table in the run summary. No AI is used.
import fs from 'node:fs';
import { effectiveSources } from './sources.mjs';
const { sources: SOURCES, dataPages: DATA_PAGES } = await effectiveSources();
import { getText, parseFeed, discoverFeeds, scrapeLinks, articleTextInfo, readerText, writeJson } from './lib.mjs';

const JOB_SITES = [['SSC', 'https://ssc.gov.in/'], ['OSSC', 'https://ossc.gov.in/'], ['OSSSC', 'https://www.osssc.gov.in/'], ['OPSC', 'https://opsc.gov.in/'], ['UPSC', 'https://upsc.gov.in/'], ['FreeJobAlert', 'https://www.freejobalert.com/'], ['GovtJobsAlert', 'https://govtjobsalert.in/'], ['Odisha IndGovtJobs', 'https://odisha.indgovtjobs.net/'], ['OdishaGovtJob', 'https://www.odishagovtjob.in/']];
const NEWS = [['PIB (English feed)', 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3'], ['Down To Earth feed', 'https://www.downtoearth.org.in/feed'], ['Vajiram API', 'https://vajiramandravi.com/current-affairs/wp-json/wp/v2/posts?per_page=3&_fields=title,link'], ['GKToday', 'https://www.gktoday.in/']];

const rows = [];
function short(e) { return String(e && e.message || e).slice(0, 80); }
async function open(url) { try { const h = await getText(url, { timeout: 25000 }); return { ok: true, html: h }; } catch (e) { return { ok: false, err: short(e) }; } }

async function checkPage(group, name, url, tryArticle) {
  const row = { group, name, url, page: '', article: '', reader: '' };
  const r = await open(url);
  if (!r.ok) {
    row.page = 'blocked or down (' + r.err + ')';
    try { const t = await readerText(url, 1500); row.reader = t.length > 300 ? 'reader service can read it' : 'reader service gave too little'; } catch (e) { row.reader = 'reader service failed (' + short(e) + ')'; }
  } else {
    row.page = 'opens';
    if (tryArticle) {
      let item = null;
      const feeds = discoverFeeds(r.html, url);
      for (const f of feeds.slice(0, 2)) { try { const x = await getText(f, { timeout: 20000 }); const it = parseFeed(x, f)[0]; if (it) { item = it; row.page = 'opens, feed works'; break; } } catch (e) {} }
      if (!item) item = scrapeLinks(r.html, url, 3)[0];
      if (!item) row.article = 'no article link found on the page';
      else {
        const info = await articleTextInfo(item.link, 3000);
        row.article = info.text && !info.why ? 'article text readable (' + info.text.length + ' characters)' : 'article not readable: ' + info.why;
        if (!info.text || info.why) { try { const t = await readerText(item.link, 3000); row.reader = t.length > 300 ? 'reader service can read it' : 'reader service gave too little'; } catch (e) { row.reader = 'reader service failed (' + short(e) + ')'; } }
      }
    }
  }
  rows.push(row);
  console.log(group + ' | ' + name + ' | ' + row.page + (row.article ? ' | ' + row.article : '') + (row.reader ? ' | ' + row.reader : ''));
}

const jobs = [];
for (const [n, u] of NEWS) jobs.push(() => checkPage('News', n, u, false));
for (const s of SOURCES) jobs.push(() => checkPage('Research: ' + s.type, s.name, s.page, true));
for (const [n, u] of JOB_SITES) jobs.push(() => checkPage('Jobs', n, u, false));
for (const d of DATA_PAGES) jobs.push(() => checkPage('Data', d.name, d.url, false));
let i = 0;
await Promise.all(Array.from({ length: 5 }, async () => { while (i < jobs.length) { const j = jobs[i++]; try { await j(); } catch (e) { console.log('check error', short(e)); } } }));

rows.sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name));
const good = rows.filter(r => r.page.startsWith('opens')).length;
writeJson('data/sourcecheck.json', { at: new Date().toISOString(), good, total: rows.length, rows });
const md = ['## Source check', '', good + ' of ' + rows.length + ' open from GitHub.', '', '| Group | Source | Page | Article | Reader service |', '|---|---|---|---|---|']
  .concat(rows.map(r => '| ' + [r.group, r.name, r.page, r.article || '-', r.reader || '-'].join(' | ') + ' |')).join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log('\n' + good + ' of ' + rows.length + ' sources open from GitHub.');
