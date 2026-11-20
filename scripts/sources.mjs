// Shared source lists. weekly.mjs reads them, and check.mjs tests them.
export const SOURCES = [
  { name: 'Centre for Equity Studies', type: 'Civil society', gs: 'GS1', page: 'https://www.centreforequitystudies.org/' },
  { name: 'Population Foundation of India', type: 'Civil society', gs: 'GS1', page: 'https://www.populationfoundation.in/' },
  { name: 'NIUA', type: 'Think tank', gs: 'GS1', page: 'https://niua.in/' },
  { name: 'Sahapedia', type: 'Think tank', gs: 'GS1', page: 'https://www.sahapedia.org/' },
  { name: 'PRS Legislative Research', type: 'Civil society', gs: 'GS2', page: 'https://prsindia.org/theprsblog' },
  { name: 'Vidhi Centre for Legal Policy', type: 'Think tank', gs: 'GS2', page: 'https://vidhilegalpolicy.in/blog/' },
  { name: 'ADR', type: 'Civil society', gs: 'GS2', page: 'https://adrindia.org/' },
  { name: 'ORF', type: 'Think tank', gs: 'GS2', page: 'https://www.orfonline.org/all-updates' },
  { name: 'Accountability Initiative', type: 'Civil society', gs: 'GS2', page: 'https://accountabilityindia.in/' },
  { name: 'ICRIER', type: 'Think tank', gs: 'GS3', page: 'https://icrier.org/publication/' },
  { name: 'CSE', type: 'Civil society', gs: 'GS3', page: 'https://www.cseindia.org/' },
  { name: 'Manohar Parrikar IDSA', type: 'Think tank', gs: 'GS3', page: 'https://www.idsa.in/' },
  { name: 'NITI Aayog', type: 'Government', gs: 'GS3', page: 'https://www.niti.gov.in/' },
  // Global bodies. days widens the look-back because flagship reports come out rarely.
  { name: 'UN News', type: 'Global body', gs: 'GS2', days: 14, page: 'https://news.un.org/en/', feeds: ['https://news.un.org/feed/subscribe/en/news/all/rss.xml'] },
  { name: 'UNDP', type: 'Global body', gs: 'GS2', days: 45, page: 'https://www.undp.org/publications' },
  { name: 'UNEP', type: 'Global body', gs: 'GS3', days: 45, page: 'https://www.unep.org/resources' },
  { name: 'FAO', type: 'Global body', gs: 'GS3', days: 45, page: 'https://www.fao.org/publications/home/en' },
  { name: 'UNCTAD', type: 'Global body', gs: 'GS3', days: 45, page: 'https://unctad.org/publications' },
  { name: 'WHO', type: 'Global body', gs: 'GS2', days: 30, page: 'https://www.who.int/news', feeds: ['https://www.who.int/rss-feeds/news-english.xml'] },
  { name: 'World Bank', type: 'Global body', gs: 'GS3', days: 45, page: 'https://www.worldbank.org/en/research' },
  { name: 'IMF', type: 'Global body', gs: 'GS3', days: 45, page: 'https://www.imf.org/en/publications' },
  { name: 'World Economic Forum', type: 'Global body', gs: 'GS3', days: 45, page: 'https://www.weforum.org/publications/' },
  { name: 'IEA', type: 'Global body', gs: 'GS3', days: 45, page: 'https://www.iea.org/reports' },
  // Added: more think tanks and civil society groups. Addresses are checked by the "Check sources" workflow.
  { name: 'The India Forum', type: 'Think tank', gs: 'GS1', page: 'https://www.theindiaforum.in/' },
  { name: 'ASER Centre', type: 'Civil society', gs: 'GS1', page: 'https://asercentre.org/' },
  { name: 'Oxfam India', type: 'Civil society', gs: 'GS1', page: 'https://www.oxfamindia.org/' },
  { name: 'Centre for Policy Research', type: 'Think tank', gs: 'GS2', page: 'https://cprindia.org/' },
  { name: 'Carnegie India', type: 'Think tank', gs: 'GS2', page: 'https://carnegieindia.org/' },
  { name: 'Takshashila Institution', type: 'Think tank', gs: 'GS2', page: 'https://takshashila.org.in/' },
  { name: 'DAKSH', type: 'Civil society', gs: 'GS2', page: 'https://dakshindia.org/' },
  { name: 'Janaagraha', type: 'Civil society', gs: 'GS2', page: 'https://www.janaagraha.org/' },
  { name: 'CSEP', type: 'Think tank', gs: 'GS3', page: 'https://csep.org/' },
  { name: 'NCAER', type: 'Think tank', gs: 'GS3', page: 'https://www.ncaer.org/' },
  { name: 'CEEW', type: 'Think tank', gs: 'GS3', page: 'https://www.ceew.in/' },
  { name: 'Dvara Research', type: 'Think tank', gs: 'GS3', page: 'https://www.dvara.com/research/' },
  { name: 'IDFC Institute', type: 'Think tank', gs: 'GS3', page: 'https://www.idfcinstitute.org/' },
  { name: 'TERI', type: 'Think tank', gs: 'GS3', page: 'https://www.teriin.org/' },
];

// Official data pages. The watcher tells you when a new release link appears. Addresses are checked by "Check sources".
export const DATA_PAGES = [
  { name: 'MoSPI (PLFS, CPI, GDP, NSS)', url: 'https://www.mospi.gov.in/' },
  { name: 'NCRB (Crime in India)', url: 'https://ncrb.gov.in/' },
  { name: 'RBI press releases', url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx' },
  { name: 'NITI Aayog', url: 'https://www.niti.gov.in/' },
  { name: 'Census and SRS (Registrar General)', url: 'https://censusindia.gov.in/' },
  { name: 'NFHS (IIPS)', url: 'https://rchiips.org/nfhs/' },
  { name: 'Open Government Data', url: 'https://data.gov.in/' }
];

/* ---------- settings kept in a secret gist (managed from the site) ---------- */
const TYPES = ['Think tank', 'Civil society', 'Global body', 'Government'];
const okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(x.hostname) && x.hostname.includes('.'); } catch (e) { return false; } };
export async function loadConfig() {
  const url = process.env.CONFIG_URL;
  if (!url) return { add: [], remove: [], dataAdd: [], dataRemove: [] };
  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const arr = a => (Array.isArray(a) ? a : []);
    const add = arr(j.sources_add).filter(x => x && typeof x.name === 'string' && x.name.length <= 80 && okUrl(x.page)).map(x => ({ name: x.name, type: TYPES.includes(x.type) ? x.type : 'Think tank', gs: /^GS[1-4]$/.test(x.gs) ? x.gs : 'GS2', page: x.page, ...(Number(x.days) > 0 ? { days: Math.min(Number(x.days), 90) } : {}) })).slice(0, 40);
    const remove = arr(j.sources_remove).filter(x => typeof x === 'string').slice(0, 80);
    const dataAdd = arr(j.data_add).filter(x => x && typeof x.name === 'string' && okUrl(x.url)).map(x => ({ name: x.name.slice(0, 80), url: x.url })).slice(0, 30);
    const dataRemove = arr(j.data_remove).filter(x => typeof x === 'string').slice(0, 60);
    console.log('Settings gist loaded: +' + add.length + ' sources, -' + remove.length + ', +' + dataAdd.length + ' data pages.');
    return { add, remove, dataAdd, dataRemove };
  } catch (e) { console.log('Could not read the settings gist (' + String(e.message).slice(0, 80) + '). Using the built-in lists.'); return { add: [], remove: [], dataAdd: [], dataRemove: [] }; }
}
export async function effectiveSources() {
  const c = await loadConfig();
  const lc = a => new Set(a.map(x => x.toLowerCase()));
  const rm = lc(c.remove), drm = lc(c.dataRemove);
  const names = new Set(SOURCES.map(s => s.name.toLowerCase()));
  const sources = SOURCES.filter(s => !rm.has(s.name.toLowerCase())).concat(c.add.filter(a => !names.has(a.name.toLowerCase())));
  const dnames = new Set(DATA_PAGES.map(d => d.name.toLowerCase()));
  const dataPages = DATA_PAGES.filter(d => !drm.has(d.name.toLowerCase())).concat(c.dataAdd.filter(a => !dnames.has(a.name.toLowerCase())));
  return { sources, dataPages };
}
