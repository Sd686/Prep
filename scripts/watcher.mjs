// Notice watcher: checks official, job-alert and data-release pages, finds new links, reads each notice page (web pages only)
// and copies exact phrases with plain code (no AI), saves to data/notices.json, writes data/deadlines.ics, sends a Telegram alert.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { effectiveSources } from './sources.mjs';
const { dataPages: DATA_PAGES } = await effectiveSources();
import { getText, clean, abs, esc, articleTextInfo, readerText, noticeFields, telegram, chunk, readJson, writeJson, sleep, SITE_URL, todayIST } from './lib.mjs';

const MAX_DETAILS = Number(process.env.MAX_DETAILS) || 30;
const WATCH = /odisha|osssc|ossc|opsc|\bssc\b|upsc|cgl|chsl|\bmts\b|otet|ctet|\bnda\b|\bcds\b/i;
const kw = /notice|notification|recruitment|exam|vacanc|result|admit|advertis|calendar|answer key|cut.?off|syllabus|corrigendum|interview|schedule|merit/i;
const dkw = /report|release|press note|survey|index|bulletin|annual|statistic|publication|plfs|nfhs|crime in india|census|estimates|data/i;
const SITES = [
  { name: 'SSC', url: 'https://ssc.gov.in/', mode: 'official' },
  { name: 'OSSC', url: 'https://ossc.gov.in/', mode: 'official' },
  { name: 'OSSSC', url: 'https://www.osssc.gov.in/', mode: 'official' },
  { name: 'OPSC', url: 'https://opsc.gov.in/', mode: 'official' },
  { name: 'UPSC', url: 'https://upsc.gov.in/', mode: 'official' },
  { name: 'FreeJobAlert', url: 'https://www.freejobalert.com/', mode: 'aggregator', hrefPattern: '/articles/', watch: true },
  { name: 'GovtJobsAlert', url: 'https://govtjobsalert.in/', mode: 'aggregator', hrefPattern: 'govtjobsalert\\.in/[a-z0-9-]+/$', watch: true },
  { name: 'Odisha IndGovtJobs', url: 'https://odisha.indgovtjobs.net/', mode: 'aggregator', hrefPattern: 'indgovtjobs\\.net/[a-z0-9-]{20,}/?$', watch: false },
  { name: 'OdishaGovtJob', url: 'https://www.odishagovtjob.in/', mode: 'aggregator', hrefPattern: '/\\d{4}/\\d{2}/[^/]+\\.html', watch: false },
  ...DATA_PAGES.map(d => ({ name: d.name, url: d.url, mode: 'official', data: true }))
];

const seen = readJson('data/seen.json', {});
const found = [], failed = [];
await Promise.all(SITES.map(async site => {
  let html = '';
  try { html = await getText(site.url, { timeout: 30000 }); } catch (e) { failed.push(site.name); return; }
  const pat = site.hrefPattern ? new RegExp(site.hrefPattern, 'i') : null;
  const links = {};
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = clean(m[2]);
    const href = abs(m[1], site.url);
    if (site.mode === 'aggregator') {
      if (text.length < 15 || text.split(' ').length < 3) continue;
      if (pat && !pat.test(href)) continue;
      if (site.watch && !WATCH.test(text)) continue;
    } else if (text.length < 8 || !(site.data ? dkw : kw).test(text)) continue;
    links[href] = text.slice(0, 160);
  }
  const keys = Object.keys(links);
  const prev = seen[site.url];
  if (Array.isArray(prev)) for (const k of keys) if (!prev.includes(k)) found.push({ name: site.name, text: links[k], href: k, agg: site.mode === 'aggregator', data: !!site.data });
  seen[site.url] = Array.from(new Set((prev || []).concat(keys))).slice(-600);
}));
console.log('checked', SITES.length, 'sites; failed:', failed.join(', ') || 'none', '; new:', found.length);
if (failed.length === SITES.length) throw new Error('Every site failed. They may be blocking GitHub, or there is no internet.');
writeJson('data/seen.json', seen);

/* ---------- read each new notice ---------- */
// The AI only copies exact phrases. The code keeps a phrase only if it really appears in the page text,
// and works out the last date itself from the copied phrase. PDFs are not read (they cannot be checked).
async function details(n) {
  if (/\.pdf($|\?)/i.test(n.href) || n.data) return null;
  let text = '';
  try { const info = await articleTextInfo(n.href, 12000); text = info.text; } catch (e) {}
  if (text.length < 150) { try { text = await readerText(n.href, 12000); n.via = 'reader'; } catch (e) { return null; } }
  if (text.length < 150) return null;
  const f = noticeFields(text);
  const info = {
    summary: '', posts: [], vacancies: f.vacancies, last_date: f.last_date, last_date_text: f.last_date_text, eligibility: f.qualification,
    qualification: f.qualification, age_limit: f.age_limit, age_min: f.age_min, age_max: f.age_max, age_asof: f.age_asof, age_asof_text: f.age_asof_text,
    relax: f.relax, fee: f.fee, selection: '', how_to_apply: '', important_dates: []
  };
  return Object.values(f).some(v => (Array.isArray(v) ? v.length : v)) ? info : null;
}
found.sort((a, b) => (a.agg ? 1 : 0) - (b.agg ? 1 : 0));
const t = new Date().toISOString();
const fresh = found.slice(0, 60).map(x => ({ t, name: x.name, text: x.text, href: x.href, agg: !!x.agg, data: !!x.data }));
let used = 0;
for (const n of fresh) {
  if (used >= MAX_DETAILS) break;
  used++;
  try { const d = await details(n); if (d) n.info = d; } catch (e) { console.log('Details failed for', n.href, e.message); }
  await sleep(600);
}

/* ---------- save ---------- */
let all = readJson('data/notices.json', []);
if (!Array.isArray(all)) all = [];
const byHref = new Map(all.map(x => [x.href, x]));
for (const n of fresh) byHref.set(n.href, n);
all = Array.from(byHref.values()).sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 200);
writeJson('data/notices.json', all);

// Calendar file: subscribe to <site>/data/deadlines.ics in Google Calendar.
const today = todayIST();
const ev = all.filter(n => n.info && n.info.last_date && n.info.last_date >= today);
const d8 = s => s.replace(/-/g, '');
const next = s => new Date(Date.parse(s + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const fold = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prep Desk//Notices//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Prep Desk deadlines']
  .concat(ev.flatMap(n => ['BEGIN:VEVENT', 'UID:' + crypto.createHash('md5').update(n.href).digest('hex') + '@prepdesk', 'DTSTAMP:' + t.replace(/[-:]|\.\d+/g, ''),
    'DTSTART;VALUE=DATE:' + d8(n.info.last_date), 'DTEND;VALUE=DATE:' + d8(next(n.info.last_date)),
    'SUMMARY:' + fold('Last date: ' + n.text.slice(0, 100)), 'DESCRIPTION:' + fold(n.name + '\n' + n.href + '\nConfirm the date on the official site.'), 'END:VEVENT']))
  .concat(['END:VCALENDAR']).join('\r\n') + '\r\n';
fs.writeFileSync('data/deadlines.ics', ics);

/* ---------- Telegram ---------- */
if (found.length) {
  const shown = fresh.slice(0, 15);
  let msg = '<b>New notices</b>\n';
  for (const f of shown) {
    msg += '\n<b>' + esc(f.name) + (f.data ? ' (data release)' : f.agg ? ' (job site, confirm on the official site)' : '') + ':</b> ' + esc(f.text);
    if (f.info) {
      if (f.info.last_date) msg += '\nLast date: ' + esc(f.info.last_date);
      if (f.info.vacancies) msg += '\nVacancies: ' + esc(f.info.vacancies);
    }
    msg += '\n';
  }
  if (found.length > shown.length) msg += '\n+' + (found.length - shown.length) + ' more';
  if (SITE_URL) msg += '\nAll details: ' + esc(SITE_URL) + '#deadlines';
  if (failed.length) msg += '\nCould not read: ' + esc(failed.join(', '));
  for (const c of chunk([msg])) await telegram(c);
}
