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

// Reads the main readable text of an article page, up to max characters. Returns {text, why}.
export async function articleTextInfo(url, max = 6000) {
  if (/\.pdf($|\?)/i.test(url)) return { text: '', why: 'this is a PDF report, which is not read' };
  let html;
  const hdr = { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' };
  let lastErr = '';
  for (let k = 0; k < 3 && html === undefined; k++) {
    try { html = await getText(url, { timeout: 25000, headers: hdr }); }
    catch (e) { lastErr = e.message; if (/HTTP (40[0-9]|410|451)/.test(lastErr)) break; await sleep(3000 * (k + 1)); }
  }
  if (html === undefined) return { text: '', why: 'the page could not be opened (' + (/HTTP 40[13]/.test(lastErr) ? lastErr + ', the website refuses requests from GitHub servers' : /HTTP 404/.test(lastErr) ? lastErr + ', the page has moved or been removed' : /abort/i.test(lastErr) ? 'it took too long to answer' : lastErr) + ')' };
  if (html.startsWith('%PDF')) return { text: '', why: 'this is a PDF report, which is not read' };
  html = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const art = html.match(/<article\b[\s\S]*?<\/article>/i);
  const paraList = body => (body.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).map(clean).filter(p => p.length > 50);
  let paras = paraList(art ? art[0] : html);
  if (paras.join(' ').length < 400) paras = paraList(html);
  if (paras.join(' ').length < 400) {
    // Some pages (government sites especially) use div and span instead of p tags.
    paras = html.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/td)\b[^>]*>/gi, '\n').split('\n').map(clean).filter(l => l.length > 60);
  }
  const joined = paras.join('\n').slice(0, max);
  if (!isEnglish(joined)) return { text: '', why: 'the page text is not in English' };
  if (joined.length < 300) return { text: joined, why: /<div id="(root|app|__next)"|window\.__NEXT_DATA__|ng-app/i.test(html) ? 'the page loads its text with JavaScript, which cannot be read here' : 'the page text was too short to build notes' };
  return { text: joined, why: '' };
}
export async function articleText(url, max = 6000) { return (await articleTextInfo(url, max)).text; }

/* ---------- Gemini ---------- */
function parseJson(text) {
  const t = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  return JSON.parse(t);
}
const MODELS = (process.env.GEMINI_MODEL ? process.env.GEMINI_MODEL.split(',') : ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']).map(x => x.trim()).filter(Boolean);
let goodModel = null; // once a model works, keep using it
const badModels = new Set();
export async function gemini(prompt, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY secret is missing.');
  const parts = opts.parts || [{ text: prompt }];
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: opts.temperature ?? 0.3, responseMimeType: 'application/json' } });
  const order = goodModel ? [goodModel, ...MODELS.filter(m => m !== goodModel)] : MODELS;
  const problems = [];
  for (const model of order) {
    if (badModels.has(model)) continue;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
    let last = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body });
      if (r.status === 429 || r.status >= 500) { last = 'HTTP ' + r.status; await sleep(8000 * (attempt + 1)); continue; }
      if (r.status === 401 || (r.status === 400 && /api key/i.test(await r.clone().text()))) throw new Error('Gemini rejected the API key (HTTP ' + r.status + '). Check the GEMINI_API_KEY secret.');
      if (!r.ok) { const t = (await r.text()).slice(0, 160).replace(/\s+/g, ' '); last = 'HTTP ' + r.status + ' ' + t; badModels.add(model); break; }
      const j = await r.json();
      const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (!goodModel || goodModel !== model) { goodModel = model; console.log('Gemini model in use:', model); }
      return parseJson(text);
    }
    problems.push(model + ': ' + last);
  }
  throw new Error('No Gemini model worked. ' + problems.join(' | '));
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
    'You are a tutor for an Indian government exam aspirant (UPSC, OPSC, SSC and Odisha exams). Write study notes from the article below.',
    'Use ONLY facts stated in the article. Do not add outside facts, numbers, dates or names. Write in your own words, in plain English.',
    'Return JSON with these keys: summary (2 or 3 plain sentences), notes (6 to 10 short exam-focused bullet strings: schemes, bodies, numbers, names, dates, decisions, and why it matters), key_terms (up to 8 important terms of 1 to 5 words each; for a term that needs it write "Term: short meaning"), exam_angle (one sentence on how this could be asked and which GS paper it fits), evidence_ids (up to 4 sentence numbers that best back the notes), ' + DIAGRAM_RULES,
    'Headline: ' + item.title,
    'Article sentences:\n' + numbered
  ].join('\n\n');
  const j = await gemini(prompt, { temperature: 0.2 });
  const str = x => String(x || '').replace(/\s+/g, ' ').trim();
  const nums = s => (String(s).match(/\d[\d,]*\.?\d*/g) || []).map(x => x.replace(/,/g, '').replace(/\.$/, ''));
  const have = new Set(nums(text));
  let dropped = 0;
  // An AI bullet is kept only if every number in it also appears in the article.
  const notes = (Array.isArray(j.notes) ? j.notes : []).map(str).filter(x => x && x.length <= 300).filter(x => { const ok = nums(x).every(n => have.has(n)); if (!ok) dropped++; return ok; }).slice(0, 10);
  const ids = a => (Array.isArray(a) ? a : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= sents.length);
  const evidence = Array.from(new Set(ids(j.evidence_ids).sort((x, y) => x - y).slice(0, 4).map(i => sents[i - 1])));
  const summary = str(j.summary);
  return {
    summary: nums(summary).every(n => have.has(n)) ? summary : (evidence.slice(0, 2).join(' ') || item.snippet || ''),
    notes,
    key_terms: (Array.isArray(j.key_terms) ? j.key_terms : []).map(str).filter(x => x && x.length <= 120).slice(0, 8),
    exam_angle: str(j.exam_angle).slice(0, 300),
    evidence,
    dropped,
    diagram: cleanDiagram(j.diagram, text),
    ai: true,
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

/* ---------- plain keyword tags (no AI): a rough topic and GS paper from the title and snippet ---------- */
const TOPIC_RULES = [
  ['Environment', 'GS3', /\b(climate|environment|pollution|forest|wildlife|biodiversity|emission|carbon|tiger|elephant|wetland|ramsar|river|glacier|air quality|renewable|solar|ozone|cop\d*|species|conservation|monsoon|cyclone|flood|drought)\b/i],
  ['Economy', 'GS3', /\b(gdp|inflation|rbi|repo rate|budget|gst|tax|bank|fiscal|export|import|trade|sebi|msme|startup|fdi|rupee|economy|economic|industry|manufacturing|employment|unemployment|agricultur|msp|subsid)/i],
  ['Science and Tech', 'GS3', /\b(isro|satellite|space|nasa|mission|launch|ai|artificial intelligence|quantum|semiconductor|drdo|vaccine|research|technology|digital|cyber|5g|6g|chandrayaan|gaganyaan|nuclear)\b/i],
  ['Defence', 'GS3', /\b(defence|army|navy|air force|missile|exercise|military|border|drdo|security forces|ordnance)\b/i],
  ['International', 'GS2', /\b(un|united nations|g20|g7|brics|sco|asean|quad|summit|bilateral|treaty|foreign|embassy|ambassador|imf|world bank|who|wto|nato|visit|diplomatic|president of|prime minister of)\b/i],
  ['Polity', 'GS2', /\b(supreme court|high court|parliament|lok sabha|rajya sabha|constitution|bill|act|amendment|election|commission|governor|judiciary|president|cabinet|ordinance|federal|panchayat|tribunal|verdict|judge)\b/i],
  ['Schemes', 'GS2', /\b(scheme|yojana|mission|programme|program|abhiyan|launched|inaugurat|beneficiar|pm-|pradhan mantri|welfare|portal|campaign)\b/i],
  ['Sports', 'GS1', /\b(olympic|asian games|cricket|hockey|football|medal|championship|tournament|world cup|athlete|badminton|chess|wrestling|boxing|tennis|paralympic)\b/i],
  ['Awards and Reports', 'GS1', /\b(award|prize|index|ranking|report|survey|bharat ratna|padma|nobel|booker|jnanpith|list of)\b/i],
  ['Odisha', 'GS1', /\b(odisha|bhubaneswar|cuttack|puri|odia|naveen|majhi|ossc|osssc|opsc|koraput|sambalpur|bhitarkanika|konark|jagannath)\b/i],
  ['Society', 'GS1', /\b(women|children|tribal|education|health|literacy|poverty|census|caste|migration|culture|heritage|unesco|festival|temple|language|nutrition)\b/i],
  ['History and Culture', 'GS1', /\b(history|ancient|medieval|freedom|independence|archaeolog|inscription|monument|dynasty|museum|manuscript)\b/i]
];
export function tagTopic(title, snippet = '') {
  const t = String(title) + ' ' + String(snippet).slice(0, 200);
  for (const [topic, gs, re] of TOPIC_RULES) if (re.test(t)) return { topic, gs };
  return { topic: '', gs: '' };
}

/* ---------- reader-service fallback (text of a page fetched by another service) ---------- */
// Used only when the page cannot be opened directly. The text is still the page's own words, but it passed through the service, so notes carry a tag.
export async function readerText(url, max = 7000) {
  const r = await fetch('https://r.jina.ai/' + url, { headers: { Accept: 'text/plain', 'X-Return-Format': 'text', 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('reader service HTTP ' + r.status);
  let t = await r.text();
  const p = t.indexOf('Markdown Content:'); if (p >= 0) t = t.slice(p + 17);
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/[*_`>|]+/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return t.slice(0, max);
}

/* ---------- job notice fields, copied by code (no AI) ---------- */
// Every phrase returned is an exact piece of the page text. Numbers and dates are read out of those phrases by code.
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
function firstMatch(text, re, span = 0) { const m = re.exec(text); return m ? text.slice(m.index, m.index + m[0].length + span).trim() : ''; }
export function noticeFields(text) {
  const t = String(text).replace(/\s+/g, ' ');
  const out = { last_date_text: '', last_date: '', vacancies: '', age_limit: '', age_asof_text: '', age_min: null, age_max: null, age_asof: '', relax: [], fee: '', qualification: '' };
  const last = new RegExp('(last date[^.]{0,80}?\\d{1,2}(?:st|nd|rd|th)?[\\s,\\-\\/.]+(?:\\d{1,2}|(?:' + MONTHS + '))[\\s,\\-\\/.]+\\d{2,4})', 'i').exec(t);
  if (last) { out.last_date_text = last[1].trim().slice(0, 160); out.last_date = parseDateText(out.last_date_text); }
  const vac = /(\d[\d,]*\s*(?:[a-z]+\s+){0,2}(?:vacanc(?:y|ies)|posts?|seats?)|(?:vacanc(?:y|ies)|total posts?)[^.]{0,40}?\d[\d,]*)/i.exec(t);
  if (vac) out.vacancies = vac[1].trim().slice(0, 120);
  const age = /(\d{2})\s*(?:to|-|–|and)\s*(\d{2})\s*years?(?:[^.]{0,60}?as (?:on|of)\s+[^.]{0,30}?\d{4})?/i.exec(t);
  if (age) { out.age_limit = age[0].trim().slice(0, 200); out.age_min = Number(age[1]); out.age_max = Number(age[2]); }
  else { const mx = /(?:maximum|upper|not (?:more|exceeding)|up to|upto)[^.]{0,40}?(\d{2})\s*years?(?:[^.]{0,60}?as (?:on|of)\s+[^.]{0,30}?\d{4})?/i.exec(t); if (mx) { out.age_limit = mx[0].trim().slice(0, 200); out.age_max = Number(mx[1]); } }
  const asof = new RegExp('as (?:on|of)\\s+(\\d{1,2}(?:st|nd|rd|th)?[\\s,\\-\\/.]+(?:\\d{1,2}|(?:' + MONTHS + '))[\\s,\\-\\/.]+\\d{4})', 'i').exec(t);
  if (asof) { out.age_asof_text = asof[0].trim(); out.age_asof = parseDateText(asof[1]); }
  const relRe = /\b(SC\s*\/?\s*ST|SC|ST|OBC(?:\s*\(?NCL\)?)?|EWS|PwBD|PwD|PH|persons with benchmark disabilit(?:y|ies)|ex-?servicem[ae]n|women|female)\b[^.\d]{0,40}?(\d{1,2})\s*years?/gi;
  let rm; const seenR = new Set();
  while ((rm = relRe.exec(t)) !== null && out.relax.length < 8) { const p = rm[0].trim().slice(0, 100); if (!seenR.has(p)) { seenR.add(p); out.relax.push(p); } }
  const fee = /(?:application\s+)?fee[^.]{0,220}?(?:rs\.?|₹|inr)\s*\.?\s*\d[\d,]*[^.]{0,160}/i.exec(t) || /(?:rs\.?|₹)\s*\.?\s*\d[\d,]*[^.]{0,60}(?:general|obc|ews|sc|st)[^.]{0,120}/i.exec(t) || /no (?:application )?fee[^.]{0,100}/i.exec(t);
  if (fee) out.fee = fee[0].trim().slice(0, 320);
  const q = /(?:(?:minimum |educational )?qualification|eligibility)[^.]{0,200}?(?:10th|matric|12th|intermediate|graduat|post.?graduat|diploma|iti|b\.?ed|b\.?tech|b\.?e\b|degree|master|any discipline)[^.]{0,120}/i.exec(t);
  if (q) out.qualification = q[0].trim().slice(0, 320);
  return out;
}
