// Shared helpers for the Prep Desk scripts. Needs Node 20 or newer, no packages.
import fs from 'node:fs';
import path from 'node:path';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
// True when most letters are Latin, so Hindi, Odia and other scripts are skipped. Everything on the site stays in English.
export function isEnglish(text) {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (letters.length < 8) return true;
  const latin = letters.filter(c => /[A-Za-z]/.test(c)).length;
  return latin / letters.length >= 0.8;
}
export const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const PHASE = process.env.PHASE === 'OPSC_UPSC' ? 'OPSC_UPSC' : 'SSC_ODISHA';
export const SITE_URL = process.env.SITE_URL || (process.env.GITHUB_REPOSITORY
  ? 'https://' + process.env.GITHUB_REPOSITORY.split('/')[0] + '.github.io/' + process.env.GITHUB_REPOSITORY.split('/')[1] + '/' : '');

/* ---------- files ---------- */
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

/* ---------- web ---------- */
export async function getText(url, opts = {}) {
  const { timeout = 25000, headers = {}, binary = false, maxBytes = 12e6 } = opts;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: Object.assign({ 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9' }, headers) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (binary) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('file too large');
      return { buf, type: r.headers.get('content-type') || '' };
    }
    return await r.text();
  } finally { clearTimeout(timer); }
}

export const clean = s => String(s == null ? '' : s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/<[^>]+>/g, ' ').replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&[#a-z0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export const abs = (u, base) => { try { return new URL(u, base).href; } catch (e) { return u; } };

function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i'));
    if (m && m[1].trim()) return m[1];
  }
  return '';
}
export function parseFeed(xml, base) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map(b => {
    const title = clean(tag(b, ['title']));
    let link = clean(tag(b, ['link']));
    if (!/^https?:/i.test(link)) {
      const h = b.match(/<link[^>]+href\s*=\s*["']([^"']+)["']/i);
      link = h ? h[1] : clean(tag(b, ['guid']));
    }
    const dt = Date.parse(clean(tag(b, ['pubDate', 'published', 'updated', 'dc:date'])));
    return { title, link: abs(link, base), t: isNaN(dt) ? null : dt, snippet: clean(tag(b, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 300) };
  }).filter(x => x.title && /^https?:/i.test(x.link));
}
export function discoverFeeds(html, base) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = m[0];
    if (!/rel\s*=\s*["']alternate["']/i.test(t) || !/type\s*=\s*["']application\/(rss|atom)\+xml["']/i.test(t)) continue;
    const h = t.match(/href\s*=\s*["']([^"']+)["']/i);
    if (h && !/comments/i.test(h[1])) out.push(abs(h[1], base));
  }
  return out;
}
export function scrapeLinks(html, page, max = 5) {
  const out = [], seen = new Set();
  let host = '';
  try { host = new URL(page).hostname.replace(/^www\./, ''); } catch (e) {}
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const link = abs(m[1], page);
    let u;
    try { u = new URL(link); } catch (e) { continue; }
    if (u.hostname.replace(/^www\./, '') !== host) continue;
    if (!u.pathname.split('/').filter(Boolean).length || /\.(jpg|jpeg|png|gif|svg|zip|doc|docx)$/i.test(u.pathname)) continue;
    const title = clean(m[2]);
    if (title.length < 35 || title.split(' ').length < 6) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    out.push({ title, link, t: null, snippet: '' });
    if (out.length >= max) break;
  }
  return out;
}

// Reads the main readable text of an article page, up to max characters.
export async function articleText(url, max = 6000) {
  try {
    let html = await getText(url, { timeout: 20000 });
    html = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
    const art = html.match(/<article\b[\s\S]*?<\/article>/i);
    const body = art ? art[0] : html;
    const paras = (body.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).map(clean).filter(p => p.length > 50);
    const joined = paras.join('\n').slice(0, max);
    return isEnglish(joined) ? joined : '';
  } catch (e) { return ''; }
}

/* ---------- Gemini ---------- */
function parseJson(text) {
  const t = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  return JSON.parse(t);
}
export async function gemini(prompt, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY secret is missing.');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts = opts.parts || [{ text: prompt }];
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: opts.temperature ?? 0.3, responseMimeType: 'application/json' } });
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body });
    if (r.status === 429 || r.status >= 500) { last = 'HTTP ' + r.status; await sleep(10000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error('Gemini error ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    return parseJson(text);
  }
  throw new Error('Gemini kept failing (' + last + '). The free limit may be used up for now.');
}

/* ---------- study notes from the source's own sentences ---------- */
// Nothing here lets the AI write facts. The AI only CHOOSES sentences by number and
// CHOOSES terms; the code copies the sentences word for word from the fetched text and
// checks every term and every diagram label against that text.
export const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
export function splitSentences(text) {
  return String(text || '').split(/\n+/).flatMap(par => par.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘])/))
    .map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length >= 40 && x.length <= 420).slice(0, 70);
}
const STOP = new Set(['with', 'that', 'this', 'from', 'will', 'into', 'over', 'under', 'than', 'then', 'they', 'their', 'have', 'been', 'were', 'also', 'such', 'only', 'about', 'after', 'before', 'which']);
export function grounded(label, haystack) {
  const h = norm(haystack).replace(/,/g, '');
  for (const n of (String(label).match(/\d[\d,.]*\d|\d/g) || [])) if (!h.includes(n.replace(/,/g, ''))) return false;
  const words = norm(label).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w));
  if (!words.length) return true;
  const hit = words.filter(w => h.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
  return hit / words.length >= 0.7;
}
export function cleanDiagram(d, text) {
  if (!d || typeof d !== 'object' || typeof d.code !== 'string') return null;
  const code = d.code.replace(/```(?:mermaid)?/gi, '').trim();
  if (!/^(flowchart (TD|LR)|timeline)\b/.test(code)) return null;
  if (/<|click\s|javascript|script/i.test(code) || code.length > 1200) return null;
  const labels = code.startsWith('timeline')
    ? code.split('\n').slice(1).map(l => l.replace(/^\s*title\s+/i, '')).filter(Boolean)
    : (code.match(/"([^"]+)"/g) || []).map(x => x.slice(1, -1));
  if (!labels.length || labels.some(l => !grounded(l, text))) return null;
  return { title: String(d.title || '').slice(0, 80), type: code.startsWith('timeline') ? 'timeline' : 'flowchart', code };
}
export const DIAGRAM_RULES =
  'diagram: an object {"title": string, "code": string} or null. The code is Mermaid. Use ONLY "flowchart TD" (a process, cause and effect, or how a scheme or law works) or "timeline" (only when the text has several dates). ' +
  'Every label must reuse words and numbers that appear in the article text. Do not add any fact, number, name or date that is not in the text. ' +
  'Flowchart rules: first line "flowchart TD"; node ids A, B, C and so on; every label in double quotes, e.g. A["Bill introduced"] --> B["Committee review"]; labels use only letters, numbers, spaces, commas and hyphens, no brackets, quotes or colons inside; at most 9 nodes; one statement per line. ' +
  'Timeline rules: first line "timeline", second line "title Short title", then lines like "2024 : Event text" with no colons inside the event text. ' +
  'If the text does not support a useful diagram, return null for diagram.';

// Returns {summary, notes, key_terms, diagram, full}. Sentences are copied exactly from the text.
export async function makeNotes(item, text) {
  const sents = splitSentences(text);
  if (text.length < 300 || sents.length < 3) return { summary: item.snippet || '', notes: [], key_terms: [], diagram: null, full: false };
  const numbered = sents.map((x, i) => (i + 1) + '. ' + x).join('\n');
  const prompt = [
    'You help an Indian government exam aspirant study an article. You must NOT write any facts yourself.',
    'The article is given as numbered sentences. Choose by number only.',
    'Return JSON: note_ids (up to 8 sentence numbers, in article order, that carry the most exam-relevant facts: schemes, numbers, names, dates, bodies, decisions), summary_ids (1 or 2 sentence numbers that best summarise the article), key_terms (up to 6 important terms, each copied exactly as written in the article, 1 to 5 words), ' + DIAGRAM_RULES,
    'Headline: ' + item.title,
    'Sentences:\n' + numbered
  ].join('\n\n');
  const j = await gemini(prompt, { temperature: 0 });
  const ids = a => (Array.isArray(a) ? a : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= sents.length);
  const uniq = a => Array.from(new Set(a)).sort((x, y) => x - y);
  const noteIds = uniq(ids(j.note_ids)).slice(0, 8);
  const sumIds = uniq(ids(j.summary_ids)).slice(0, 2);
  const hay = norm(text);
  return {
    summary: (sumIds.length ? sumIds : noteIds.slice(0, 2)).map(i => sents[i - 1]).join(' '),
    notes: Array.from(new Set(noteIds.map(i => sents[i - 1]))),
    key_terms: (Array.isArray(j.key_terms) ? j.key_terms : []).map(x => String(x).trim()).filter(x => x && x.length <= 60 && hay.includes(norm(x))).slice(0, 6),
    diagram: cleanDiagram(j.diagram, text),
    full: true
  };
}

// Reads a date written in a notice, such as 30/11/2026 or 30 November 2026 or November 30, 2026.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function parseDateText(t) {
  const mk = (y, m, d) => { const dt = new Date(Date.UTC(y, m, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : ''; };
  let m = String(t).match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/); if (m) return mk(+m[3], +m[2] - 1, +m[1]);
  m = String(t).match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b/); if (m && MON[m[2].slice(0, 3).toLowerCase()] !== undefined) return mk(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = String(t).match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/); if (m && MON[m[1].slice(0, 3).toLowerCase()] !== undefined) return mk(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return '';
}

/* ---------- Telegram (optional) ---------- */
export async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log('Telegram secrets not set, skipping message.'); return false; }
  const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  if (!r.ok) { console.log('Telegram error', r.status, (await r.text()).slice(0, 200)); return false; }
  return true;
}
export function chunk(blocks, limit = 3800) {
  const out = []; let cur = '';
  for (const b of blocks) {
    if ((cur + '\n\n' + b).length > limit && cur) { out.push(cur); cur = b; } else cur = cur ? cur + '\n\n' + b : b;
  }
  if (cur) out.push(cur);
  return out;
}
export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
