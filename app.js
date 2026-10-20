/* くらしの献立帖 v2 — ふたりで使う献立・予定・買い物の手帳
 * データ: Supabase（Auth + Postgres + Realtime）。アクセス制御は supabase/schema.sql の RLS。
 * すべてのデータは「スペース」に属する: じぶん（personal）/ ふたり（shared）。
 */
(function(){
'use strict';

const CFG = window.KONDATE_CONFIG || {};
const APP_VERSION = '2.0';

/* ---------- utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gid = p => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const uuid = () => {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
};
const pad = n => String(n).padStart(2, '0');
const ds = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const pd = s => { const a = String(s).split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const todayS = () => ds(new Date());
const WD = ['日','月','火','水','木','金','土'];
const jp = s => { const d = pd(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）'; };
const jpS = s => { const d = pd(s); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; };
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const kata2hira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const norm = s => kata2hira(String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ''));
const ING_ALIAS = [['馬鈴薯','じゃがいも'],['じゃが芋','じゃがいも'],['玉葱','たまねぎ'],['玉ねぎ','たまねぎ'],['人参','にんじん'],['生姜','しょうが'],['醤油','しょうゆ'],['味噌','みそ'],['大根','だいこん'],['玉子','たまご'],['卵','たまご'],['胡椒','こしょう'],['茄子','なす'],['椎茸','しいたけ'],['長葱','ながねぎ'],['長ネギ','ながねぎ'],['葱','ねぎ'],['南瓜','かぼちゃ'],['牛蒡','ごぼう'],['蓮根','れんこん'],['胡瓜','きゅうり'],['大蒜','にんにく'],['豆腐','とうふ'],['砂糖','さとう'],['小松菜','こまつな'],['白菜','はくさい'],['味醂','みりん']];
const normIng = s => { let t = String(s || '').normalize('NFKC'); ING_ALIAS.forEach(([a, b]) => { t = t.split(a).join(b); }); return norm(t); };
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();
const lsGet = k => { try { return localStorage.getItem('kk.' + k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem('kk.' + k); else localStorage.setItem('kk.' + k, v); } catch (e) {} };
const initial = name => (Array.from(String(name || '').trim())[0] || '？');

function parseQty(q){
  if (q == null) return null;
  const s = String(q).normalize('NFKC').replace(/⁄/g, '/').replace(/^約/, '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return +m[1];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[2] > 0 ? +m[1] / +m[2] : null;
  if ((m = s.match(/^(\d+)(?:\s+|と)(\d+)\/(\d+)$/))) return +m[3] > 0 ? +m[1] + (+m[2] / +m[3]) : null;
  return null;
}
const fmtNum = n => String(Math.round(n * 100) / 100);
const UNIT_MAP = {'グラム':'g','cc':'ml','ミリリットル':'ml','リットル':'l','キロ':'kg','キログラム':'kg'};
function normUnit(u){
  let s = String(u || '').normalize('NFKC').trim();
  if (/^[a-z]+$/i.test(s)) s = s.toLowerCase();
  return UNIT_MAP[s] || s;
}
function safeUrl(u){
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = 'https://' + s;
  try { const x = new URL(s); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : ''; } catch (e) { return ''; }
}
function srcOf(u){
  try {
    const h = new URL(u).hostname.replace(/^www\.|^m\./, '');
    if (/(^|\.)instagram\.com$/.test(h)) return 'Instagram';
    if (/(^|\.)tiktok\.com$/.test(h)) return 'TikTok';
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h)) return 'YouTube';
    if (/(^|\.)cookpad\.com$/.test(h)) return 'クックパッド';
    if (/(^|\.)kurashiru\.com$/.test(h)) return 'クラシル';
    if (/(^|\.)delishkitchen\.tv$/.test(h)) return 'デリッシュキッチン';
    if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(h)) return 'X';
    return h;
  } catch (e) { return ''; }
}

/* ---------- constants ---------- */
const SLOTS = [
  {k:'main', label:'主菜', cat:'主菜'},
  {k:'side', label:'副菜', cat:'副菜'},
  {k:'soup', label:'汁物', cat:'汁物'},
  {k:'other', label:'その他', cat:'その他'}
];
const SHIFTS = [
  {k:'day', label:'日勤', short:'日'},
  {k:'evening', label:'準夜勤', short:'準'},
  {k:'night', label:'深夜勤', short:'深'},
  {k:'off', label:'休み', short:'休'},
  {k:'other', label:'その他', short:'他'}
];
const PLANS = [
  {k:'out', label:'外出'},
  {k:'shopping', label:'買い物'},
  {k:'chores', label:'家事'},
  {k:'custom', label:'自由入力'}
];
const RCATS = ['主菜','副菜','汁物','鍋','麺類','お菓子','その他'];
const REMOJI = {'主菜':'🍳','副菜':'🥗','汁物':'🍲','鍋':'🫕','麺類':'🍜','お菓子':'🍰','その他':'🍽️'};
const SCATS = ['野菜','肉・魚','卵・乳製品','豆腐・加工食品','調味料','日用品','その他'];
const SEMOJI = {'野菜':'🥕','肉・魚':'🐟','卵・乳製品':'🥚','豆腐・加工食品':'🫘','調味料':'🧂','日用品':'🧻','その他':'🛍️'};
const COLORS = [['rose','ローズ'],['sky','ブルー'],['sage','グリーン'],['apricot','オレンジ'],['lavender','ラベンダー']];
const CAT_WORDS = [
  ['豆腐・加工食品', '豆腐 油揚げ 油あげ 厚揚げ 納豆 ちくわ かまぼこ はんぺん さつま揚げ ハム ベーコン ソーセージ ウインナー こんにゃく しらたき 春雨 ツナ 缶 麩 キムチ 漬物 冷凍 練り物'],
  ['卵・乳製品', '卵 たまご 玉子 牛乳 チーズ バター ヨーグルト 生クリーム ミルク 豆乳'],
  ['調味料', '醤油 しょうゆ 味噌 みそ 砂糖 塩 こしょう 胡椒 みりん 料理酒 酒 酢 油 だし 出汁 コンソメ ケチャップ マヨネーズ ソース 鶏ガラ 顆粒 片栗粉 小麦粉 薄力粉 強力粉 パン粉 ポン酢 めんつゆ 白だし オイスター 豆板醤 コチュジャン 甜麺醤 ごま はちみつ スパイス カレー粉 ルウ ルー 中華だし チューブ'],
  ['肉・魚', '肉 豚 牛 鶏 ひき ミンチ 鮭 さけ 魚 さば 鯖 あじ 鯵 いわし ぶり たら 鱈 まぐろ 刺身 えび 海老 いか たこ あさり しじみ しらす ほたて ささみ 手羽 レバー かに'],
  ['野菜', '野菜 キャベツ 玉ねぎ たまねぎ 玉葱 にんじん 人参 じゃがいも じゃが芋 ねぎ 葱 大根 ほうれん草 小松菜 もやし ピーマン なす 茄子 トマト きゅうり レタス ブロッコリー かぼちゃ ごぼう れんこん しめじ えのき しいたけ 椎茸 まいたけ エリンギ きのこ にんにく しょうが 生姜 白菜 水菜 にら ニラ 大葉 しそ 三つ葉 パプリカ アボカド オクラ いんげん 枝豆 さつまいも 里芋 長芋 山芋 セロリ みょうが ズッキーニ 豆苗 チンゲン菜 春菊 レモン りんご バナナ いちご みかん 果物 パセリ バジル 貝割れ かいわれ'],
  ['日用品', 'ティッシュ 洗剤 ラップ ホイル ペーパー シャンプー リンス 石けん 石鹸 電池 ゴミ袋 ごみ袋 スポンジ トイレ 歯ブラシ 歯磨き マスク 柔軟剤 保存袋']
].map(([c, w]) => [c, w.split(' ').map(norm)]);
function guessCat(name){
  const n = norm(name);
  if (!n) return 'その他';
  for (const [c, words] of CAT_WORDS) if (words.some(w => n.includes(w))) return c;
  return 'その他';
}
const shiftOf = k => SHIFTS.find(s => s.k === k) || SHIFTS[4];
const planOf = k => PLANS.find(p => p.k === k) || PLANS[3];
const evLabel = e => e.kind === 'shift'
  ? (e.type === 'other' ? (e.title || 'その他') : shiftOf(e.type).label)
  : (e.type === 'custom' ? (e.title || '予定') : (e.title ? planOf(e.type).label + '：' + e.title : planOf(e.type).label));
const evTime = e => (e.start_time || e.end_time) ? ((e.start_time || '') + '〜' + (e.end_time || '')) : '';
const slotToCat = k => (SLOTS.find(s => s.k === k) || SLOTS[3]).cat;
const catToSlot = c => ({'主菜':'main','鍋':'main','麺類':'main','副菜':'side','汁物':'soup'})[c] || 'other';

/* ---------- icons ---------- */
const sv = (p, s) => '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
const IC = {
  cal: sv('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>'),
  book: sv('<path d="M4 5.5c2.6-1.1 5.5-1 8 .9v13c-2.5-1.8-5.4-2-8-.9z"/><path d="M20 5.5c-2.6-1.1-5.5-1-8 .9v13c2.5-1.8 5.4-2 8-.9z"/>'),
  cart: sv('<path d="M4 9.5h16l-1.5 8.8a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7z"/><path d="M8.5 9.5 11 4.5M15.5 9.5 13 4.5M9.5 13.5v3M14.5 13.5v3"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/><circle cx="12" cy="12" r="7"/>'),
  left: sv('<path d="M14.5 6 8.5 12l6 6"/>', 20),
  right: sv('<path d="M9.5 6l6 6-6 6"/>', 20),
  search: sv('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', 20),
  x: sv('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 20),
  plus: sv('<path d="M12 5v14M5 12h14"/>', 26),
  bookS: sv('<path d="M4 5.5c2.6-1.1 5.5-1 8 .9v13c-2.5-1.8-5.4-2-8-.9z"/><path d="M20 5.5c-2.6-1.1-5.5-1-8 .9v13c2.5-1.8 5.4-2 8-.9z"/>', 16),
  ext: sv('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 16)
};

/* ---------- state ---------- */
const S = {
  status: 'boot', // boot | config | auth | loading | dberror | ready
  authMode: 'login', authMsg: '', authErr: '', authBusy: false,
  user: null, uid: null,
  profiles: new Map(), spaces: new Map(), members: [],
  personalId: null, sharedId: null, cur: null,
  recipes: new Map(), meals: new Map(), events: new Map(), shop: new Map(),
  settings: {weekStart: 0, monthMeals: 'all', shiftTimes: {}, curSpace: null},
  loaded: false, offline: false, ver: 0,
  tab: ['cal','recipes','shop','prefs'].includes(lsGet('tab')) ? lsGet('tab') : 'cal',
  cal: {view: lsGet('calView') === 'week' ? 'week' : 'month', sel: todayS()},
  adder: null, adderQ: '',
  rq: {text:'', filter:'all', cat:'all'},
  shopDup: null, shopCatTouched: false,
  sheets: [], photoCache: new Map(), undo: null, scroll: {},
  hideInviteCard: lsGet('hideInvite') === '1'
};
const markDirty = () => { S.ver++; };

/* ---------- supabase ---------- */
let sb = null, channel = null, subscribedOnce = false;
const TABLE_MAP = {recipes: 'recipes', meal_items: 'meals', events: 'events', shopping_items: 'shop', profiles: 'profiles'};
const SERVER_COLS = ['created_by','updated_by','created_at','updated_at','checked_by','checked_at'];
const strip = row => { const o = Object.assign({}, row); SERVER_COLS.forEach(k => delete o[k]); return o; };
const isNetErr = e => { const m = String((e && (e.message || e)) || ''); return /Failed to fetch|NetworkError|Load failed|network|fetch/i.test(m) && !(e && e.code); };

const chains = new Map(), pending = new Map();
function enqueue(table, ids, fn){
  const keys = ids.map(id => table + ':' + id);
  ids.forEach(id => pending.set(id, (pending.get(id) || 0) + 1));
  const prev = Promise.all(keys.map(k => chains.get(k)).filter(Boolean).map(p => p.catch(() => {})));
  const run = prev.then(async () => {
    let res = await fn(0);
    if (res && res.error && isNetErr(res.error) && navigator.onLine !== false) { await sleep(500 + Math.random() * 700); res = await fn(1); }
    if (res && res.error) throw res.error;
    return res;
  });
  keys.forEach(k => chains.set(k, run));
  return run.then(() => true, e => { onWriteError(e); return false; }).finally(() => {
    ids.forEach(id => { const n = (pending.get(id) || 1) - 1; if (n <= 0) pending.delete(id); else pending.set(id, n); });
    keys.forEach(k => { if (chains.get(k) === run) chains.delete(k); });
  });
}
function onWriteError(e){
  const code = e && e.code, msg = String((e && e.message) || '');
  let t = '保存できませんでした。もう一度お試しください';
  if (navigator.onLine === false || isNetErr(e)) t = 'オフラインのため保存できませんでした。通信できるところでもう一度お試しください';
  else if (code === '42501' || /row-level security/i.test(msg)) t = '保存する権限がありません。スペースのメンバーか確認してください';
  else if (code === '23503') t = 'つながっているデータが見つかりませんでした。最新の状態に更新しました';
  else if (/JWT|token/i.test(msg)) t = 'ログインの有効期限が切れました。もう一度ログインしてください';
  else if (code === '23514') t = '入力内容が長すぎるか、形式が正しくありません';
  toast(t, {err: true});
  if (!(navigator.onLine === false || isNetErr(e))) refreshSoon();
}
const baseRow = () => ({created_by: S.uid, updated_by: S.uid, created_at: nowISO(), updated_at: nowISO()});
function insertRows(table, rows){
  if (!rows.length) return Promise.resolve(true);
  const key = TABLE_MAP[table];
  rows.forEach(r => S[key].set(r.id, Object.assign(baseRow(), r)));
  markDirty(); scheduleRender(); saveSnapshotSoon();
  const body = rows.map(strip);
  const chunks = [];
  for (let i = 0; i < body.length; i += 100) chunks.push(body.slice(i, i + 100));
  return Promise.all(chunks.map(ch => enqueue(table, ch.map(r => r.id), async attempt => {
    const r = await sb.from(table).insert(ch);
    if (r.error && r.error.code === '23505' && attempt > 0) return {error: null};
    return r;
  }))).then(a => a.every(Boolean));
}
const insertRow = (table, row) => insertRows(table, [row]);
function updateRow(table, id, patch){
  const key = TABLE_MAP[table];
  const cur = S[key].get(id);
  if (cur) S[key].set(id, Object.assign({}, cur, patch, {updated_by: S.uid, updated_at: nowISO()}));
  markDirty(); scheduleRender(); saveSnapshotSoon();
  return enqueue(table, [id], () => sb.from(table).update(strip(patch)).eq('id', id));
}
function deleteRows(table, ids){
  if (!ids.length) return Promise.resolve(true);
  const key = TABLE_MAP[table];
  ids.forEach(id => S[key].delete(id));
  markDirty(); scheduleRender(); saveSnapshotSoon();
  return enqueue(table, ids, () => sb.from(table).delete().in('id', ids));
}
function savePhoto(recipeId, spaceId, data){
  if (data) S.photoCache.set(recipeId, data); else S.photoCache.delete(recipeId);
  return enqueue('recipe_photos', [recipeId], () => data
    ? sb.from('recipe_photos').upsert({recipe_id: recipeId, space_id: spaceId, data}, {onConflict: 'recipe_id'})
    : sb.from('recipe_photos').delete().eq('recipe_id', recipeId));
}
let settingsT = null;
function saveSettings(next){
  S.settings = Object.assign({}, S.settings, next);
  if ('curSpace' in next) { pickSpaces(); markDirty(); }
  scheduleRender(); saveSnapshotSoon();
  clearTimeout(settingsT);
  settingsT = setTimeout(() => {
    const data = Object.assign({}, S.settings);
    enqueue('user_settings', [S.uid], () => sb.from('user_settings').upsert({user_id: S.uid, data}, {onConflict: 'user_id'}));
  }, 500);
}

async function fetchAll(table, cols, orderCol){
  const out = [], page = 1000;
  for (let from = 0; ; from += page) {
    const {data, error} = await sb.from(table).select(cols || '*').order(orderCol || 'id').range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}
function mergeMap(key, rows){
  const m = new Map();
  rows.forEach(r => {
    if (pending.has(r.id)) { const l = S[key].get(r.id); if (l) m.set(r.id, l); }
    else m.set(r.id, r);
  });
  S[key].forEach((r, id) => { if (pending.has(id) && !m.has(id)) m.set(id, r); });
  S[key] = m;
}
let refreshing = null, refreshT = null;
function refreshSoon(ms){ clearTimeout(refreshT); refreshT = setTimeout(() => refreshAll(), ms || 600); }
function refreshAll(){
  if (!sb || !S.uid) return Promise.resolve();
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const [spaces, members, profiles, recipes, meals, events, shop, st] = await Promise.all([
        fetchAll('spaces'), fetchAll('space_members', 'space_id,user_id,role,joined_at', 'space_id'), fetchAll('profiles'),
        fetchAll('recipes'), fetchAll('meal_items'), fetchAll('events'), fetchAll('shopping_items'),
        sb.from('user_settings').select('data').eq('user_id', S.uid).maybeSingle()
      ]);
      S.spaces = new Map(spaces.map(s => [s.id, s]));
      S.members = members;
      mergeMap('profiles', profiles);
      mergeMap('recipes', recipes);
      mergeMap('meals', meals);
      mergeMap('events', events);
      mergeMap('shop', shop);
      if (st && st.data && st.data.data && !chains.has('user_settings:' + S.uid)) applySettings(st.data.data);
      pickSpaces();
      S.loaded = true; S.offline = false; S.lastFetch = Date.now();
      if (S.status === 'loading') S.status = 'ready';
      markDirty(); saveSnapshotSoon();
    } catch (e) {
      S.offline = navigator.onLine === false || isNetErr(e);
      if (!S.loaded) {
        S.status = S.offline ? 'ready' : 'dberror';
        S.dbErr = String((e && e.message) || e);
      }
    } finally {
      refreshing = null;
      scheduleRender();
    }
  })();
  return refreshing;
}
function applySettings(d){
  d = d || {};
  S.settings = {
    weekStart: d.weekStart === 1 ? 1 : 0,
    monthMeals: d.monthMeals === 'main' ? 'main' : 'all',
    shiftTimes: (d.shiftTimes && typeof d.shiftTimes === 'object') ? d.shiftTimes : {},
    curSpace: typeof d.curSpace === 'string' ? d.curSpace : null
  };
}
function pickSpaces(){
  const sp = [...S.spaces.values()];
  const p = sp.find(s => s.kind === 'personal' && s.owner_id === S.uid);
  const sh = sp.find(s => s.kind === 'shared');
  S.personalId = p ? p.id : null;
  S.sharedId = sh ? sh.id : null;
  const want = S.settings.curSpace;
  const next = (want && S.spaces.has(want)) ? want : (S.sharedId || S.personalId);
  if (next !== S.cur) { S.cur = next; markDirty(); }
}
function subscribe(){
  if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; }
  subscribedOnce = false;
  let ch = sb.channel('kondate-' + S.uid);
  ['recipes','meal_items','events','shopping_items'].forEach(t => {
    ch = ch.on('postgres_changes', {event: '*', schema: 'public', table: t}, p => onChange(t, p));
  });
  ['spaces','space_members','profiles'].forEach(t => {
    ch = ch.on('postgres_changes', {event: '*', schema: 'public', table: t}, p => {
      if (t === 'profiles' && p.new && p.new.id && p.eventType !== 'DELETE') { if (!pending.has(p.new.id)) { S.profiles.set(p.new.id, p.new); markDirty(); scheduleRender(); } return; }
      refreshSoon(400);
    });
  });
  channel = ch.subscribe(status => {
    if (status === 'SUBSCRIBED') { if (subscribedOnce) refreshSoon(200); subscribedOnce = true; }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(() => { if (S.uid) subscribe(); }, 5000);
  });
}
function onChange(table, p){
  const key = TABLE_MAP[table];
  if (p.eventType === 'DELETE') {
    const id = p.old && p.old.id;
    if (id && S[key].has(id) && !pending.has(id)) { S[key].delete(id); markDirty(); scheduleRender(); saveSnapshotSoon(); }
    return;
  }
  const row = p.new;
  if (!row || !row.id || pending.has(row.id)) return;
  if (table === 'recipes') { const old = S.recipes.get(row.id); if (old && (old.has_photo !== row.has_photo || old.thumb !== row.thumb)) S.photoCache.delete(row.id); }
  S[key].set(row.id, row);
  markDirty(); scheduleRender(); saveSnapshotSoon();
}

/* ---------- local snapshot (fast start / offline view) ---------- */
let snapT = null;
function saveSnapshotSoon(){
  if (!S.uid || !S.loaded) return;
  clearTimeout(snapT);
  snapT = setTimeout(() => {
    const snap = {v: 2, at: Date.now(), spaces: [...S.spaces.values()], members: S.members, profiles: [...S.profiles.values()],
      recipes: [...S.recipes.values()], meals: [...S.meals.values()], events: [...S.events.values()], shop: [...S.shop.values()], settings: S.settings};
    let txt = JSON.stringify(snap);
    if (txt.length > 3500000) { snap.recipes = snap.recipes.map(r => Object.assign({}, r, {thumb: ''})); txt = JSON.stringify(snap); }
    lsSet('snap.' + S.uid, txt);
  }, 1500);
}
function loadSnapshot(uid){
  try {
    const t = lsGet('snap.' + uid);
    if (!t) return false;
    const s = JSON.parse(t);
    if (!s || s.v !== 2) return false;
    S.spaces = new Map(s.spaces.map(x => [x.id, x]));
    S.members = s.members || [];
    S.profiles = new Map(s.profiles.map(x => [x.id, x]));
    S.recipes = new Map(s.recipes.map(x => [x.id, x]));
    S.meals = new Map(s.meals.map(x => [x.id, x]));
    S.events = new Map(s.events.map(x => [x.id, x]));
    S.shop = new Map(s.shop.map(x => [x.id, x]));
    applySettings(s.settings);
    pickSpaces();
    S.loaded = true; markDirty();
    return true;
  } catch (e) { return false; }
}
function resetData(){
  S.profiles = new Map(); S.spaces = new Map(); S.members = [];
  S.recipes = new Map(); S.meals = new Map(); S.events = new Map(); S.shop = new Map();
  S.personalId = S.sharedId = S.cur = null; S.loaded = false; S.photoCache = new Map();
  S.settings = {weekStart: 0, monthMeals: 'all', shiftTimes: {}, curSpace: null};
  markDirty();
}

/* ---------- derived ---------- */
let IDX = {ver: -1};
function idx(){
  if (IDX.ver === S.ver) return IDX;
  const days = new Map();
  const ensure = d => { let x = days.get(d); if (!x) { x = {date: d, meals: {main: [], side: [], soup: [], other: []}, events: []}; days.set(d, x); } return x; };
  S.meals.forEach(m => { if (m.space_id === S.cur && ensure(m.date).meals[m.slot]) ensure(m.date).meals[m.slot].push(m); });
  days.forEach(d => SLOTS.forEach(s => d.meals[s.k].sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)))));
  S.events.forEach(e => { if (S.spaces.has(e.space_id)) ensure(e.date).events.push(e); });
  const rIndex = new Map(), recipes = [];
  S.recipes.forEach(r => { if (r.space_id === S.cur) { recipes.push(r); const k = norm(r.name); if (k && !rIndex.has(k)) rIndex.set(k, r); } });
  IDX = {ver: S.ver, days, rIndex, recipes};
  return IDX;
}
const EMPTY = date => ({date, meals: {main: [], side: [], soup: [], other: []}, events: []});
const getDay = date => idx().days.get(date) || EMPTY(date);
const dayDishes = d => d ? SLOTS.flatMap(s => (d.meals[s.k] || []).map(x => Object.assign({slot: s.k}, x))) : [];
const dayHasMeals = d => dayDishes(d).length > 0;
const curRecipes = () => idx().recipes;
const curShop = () => [...S.shop.values()].filter(i => i.space_id === S.cur);
function resolve(di){
  if (!di) return null;
  const r = di.recipe_id && S.recipes.get(di.recipe_id);
  return r || idx().rIndex.get(norm(di.name)) || null;
}
const hasShared = () => !!S.sharedId;
const spaceMembers = sid => S.members.filter(m => m.space_id === sid);
const partnerId = () => { if (!S.sharedId) return null; const m = spaceMembers(S.sharedId).find(x => x.user_id !== S.uid); return m ? m.user_id : null; };
const profileOf = id => S.profiles.get(id) || {id, display_name: '', color: 'sky'};
const nameOf = id => (id === S.uid ? (profileOf(id).display_name || 'わたし') : (profileOf(id).display_name || 'あいて'));
const colorOf = id => { const c = profileOf(id).color; return COLORS.some(x => x[0] === c) ? c : 'rose'; };
const spaceLabel = sid => { const s = S.spaces.get(sid); return s && s.kind === 'shared' ? 'ふたり' : 'じぶん'; };
function whoHTML(pid, size){
  const cls = size ? ' ' + size : '';
  if (pid == null) return '<i class="who who-both' + cls + '" aria-label="ふたり">ふたり</i>';
  return '<i class="who who-' + colorOf(pid) + cls + '" title="' + esc(nameOf(pid)) + '" aria-label="' + esc(nameOf(pid)) + '">' + esc(initial(nameOf(pid))) + '</i>';
}
const personRank = pid => pid === S.uid ? 0 : pid == null ? 2 : 1;
function sortEvents(evs){
  return evs.slice().sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'shift' ? -1 : 1) || (personRank(a.person_id) - personRank(b.person_id)) || String(a.start_time || '99').localeCompare(String(b.start_time || '99')));
}

/* ---------- boot / auth ---------- */
async function boot(){
  const m = location.hash.match(/join=([A-Za-z0-9-]{6,20})/);
  if (m) { lsSet('pendingJoin', m[1].toUpperCase()); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase || !window.supabase.createClient) {
    S.status = (!CFG.supabaseUrl || !CFG.supabaseAnonKey) ? 'config' : 'dberror';
    S.dbErr = '通信ライブラリを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。';
    render(); return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'kk-auth'}
  });
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') { if (session && session.user && S.uid !== session.user.id) startSession(session.user); openSheet('newPassword', {static: true}); return; }
      if (event === 'SIGNED_OUT') { endSession(); return; }
      if (session && session.user && S.uid !== session.user.id && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) startSession(session.user);
      if (!session && event === 'INITIAL_SESSION' && S.status === 'boot') { S.status = 'auth'; render(); }
    }, 0);
  });
  try {
    const {data} = await sb.auth.getSession();
    if (data && data.session && data.session.user) { if (S.uid !== data.session.user.id) startSession(data.session.user); }
    else if (S.status === 'boot') { S.status = 'auth'; render(); }
  } catch (e) { if (S.status === 'boot') { S.status = 'auth'; render(); } }
}
async function startSession(user){
  if (S.uid === user.id && S.status !== 'auth') return;
  S.user = user; S.uid = user.id;
  const had = loadSnapshot(user.id);
  S.status = had ? 'ready' : 'loading';
  render();
  const meta = user.user_metadata || {};
  const {error} = await sb.rpc('bootstrap', {p_name: meta.display_name || null});
  if (error && !isNetErr(error)) {
    S.status = 'dberror';
    S.dbErr = /function .*bootstrap|does not exist|schema cache/i.test(error.message || '') ? 'データベースの準備ができていません。Supabase の SQL Editor で supabase/schema.sql を実行してください。' : (error.message || '');
    render(); return;
  }
  await refreshAll();
  subscribe();
  handlePendingJoin();
}
function endSession(){
  if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; }
  if (S.uid) lsSet('snap.' + S.uid, null);
  S.user = null; S.uid = null; resetData();
  closeAllSheets();
  S.status = 'auth'; S.authMode = 'login'; S.authMsg = ''; S.authErr = '';
  render();
}
function handlePendingJoin(){
  const code = lsGet('pendingJoin');
  if (!code || S.status !== 'ready') return;
  if (S.sharedId) { lsSet('pendingJoin', null); return; }
  openSheet('join', {static: true, code});
}
function authErrorText(e){
  const m = String((e && e.message) || '');
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います';
  if (/Email not confirmed/i.test(m)) return '確認メールのリンクを開いてから、もう一度ログインしてください';
  if (/already registered|already been registered/i.test(m)) return 'このメールアドレスはすでに登録されています。ログインしてください';
  if (/Password should be|at least/i.test(m)) return 'パスワードは8文字以上にしてください';
  if (/valid email|invalid format|Unable to validate email/i.test(m)) return 'メールアドレスの形を確認してください';
  if (/rate limit|too many|security purposes/i.test(m)) return '短い時間に何度も試したため、しばらく待ってからもう一度お試しください';
  if (/Signups not allowed|signup is disabled/i.test(m)) return '新規登録は締め切られています。管理している人に確認してください';
  if (isNetErr(e)) return '通信できませんでした。電波のよいところでもう一度お試しください';
  return m || 'うまくいきませんでした。もう一度お試しください';
}
const appUrl = () => location.origin + location.pathname;

/* ---------- rendering core ---------- */
function morphNode(f, t){
  if (f.nodeType !== t.nodeType || f.nodeName !== t.nodeName || (f.nodeType === 1 && (f.id || t.id) && f.id !== t.id)) { f.replaceWith(t); return; }
  if (f.nodeType !== 1) { if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue; return; }
  const fa = f.attributes;
  for (let i = fa.length - 1; i >= 0; i--) { const n = fa[i].name; if (!t.hasAttribute(n)) f.removeAttribute(n); }
  const ta = t.attributes;
  for (let i = 0; i < ta.length; i++) { const a = ta[i]; if (f.getAttribute(a.name) !== a.value) f.setAttribute(a.name, a.value); }
  const tag = f.nodeName;
  if (tag === 'INPUT') {
    if (t.hasAttribute('data-fresh')) { if (f.type === 'checkbox' || f.type === 'radio') f.checked = t.checked; else if (f.value !== t.value) f.value = t.value; }
    return;
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT') { if (t.hasAttribute('data-fresh')) f.value = t.value; return; }
  morphKids(f, t);
}
function morphKids(f, t){
  const tk = Array.from(t.childNodes);
  for (let j = 0; j < tk.length; j++) {
    const fn = f.childNodes[j];
    if (!fn) f.appendChild(tk[j]); else morphNode(fn, tk[j]);
  }
  while (f.childNodes.length > tk.length) f.removeChild(f.lastChild);
}
function patch(el, html){
  const ae = document.activeElement;
  let fid = null, s1 = null, s2 = null;
  if (ae && ae !== document.body && el.contains(ae) && ae.id) { fid = ae.id; try { s1 = ae.selectionStart; s2 = ae.selectionEnd; } catch (e) {} }
  const tpl = document.createElement('div');
  tpl.innerHTML = html;
  morphKids(el, tpl);
  if (fid && document.activeElement !== ae) {
    const n = document.getElementById(fid);
    if (n && el.contains(n)) { try { n.focus({preventScroll: true}); if (s1 != null && n.setSelectionRange) n.setSelectionRange(s1, s2); } catch (e) {} }
  }
}
let rafPending = false, composing = false;
function scheduleRender(){
  if (rafPending) return;
  rafPending = true;
  const go = () => {
    if (!rafPending) return;
    if (composing) { setTimeout(go, 250); return; }
    rafPending = false; render();
  };
  requestAnimationFrame(go); setTimeout(go, 120);
}
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; });
document.addEventListener('focusout', () => { composing = false; });
function render(){
  rafPending = false;
  renderView(); renderTabs(); renderSheets();
}
function renderView(){
  const v = $('#view');
  let html;
  if (S.status === 'boot') html = gateHTML('読み込み中…', '');
  else if (S.status === 'config') html = gateHTML('セットアップが必要です', 'config.js に Supabase の Project URL と anon キーを入れてください。手順は README にあります。');
  else if (S.status === 'auth') html = authHTML();
  else if (S.status === 'loading') html = gateHTML('読み込み中…', 'ふたりの献立帖を開いています。');
  else if (S.status === 'dberror') html = gateHTML('データを読み込めませんでした', S.dbErr || 'ページを再読み込みしてもう一度お試しください。') + '<div style="text-align:center"><button class="btn" data-act="reload">再読み込み</button> <button class="btn ghost" data-act="logout">ログアウト</button></div>';
  else html = (S.offline ? '<p style="text-align:center"><span class="offline">オフラインです。前回の内容を表示しています</span></p>' : '') + ({cal: calHTML, recipes: recipesHTML, shop: shopHTML, prefs: prefsHTML}[S.tab])();
  const key = S.status + ':' + (S.status === 'ready' ? S.tab : S.authMode);
  if (v.dataset.key !== key) { v.dataset.key = key; v.innerHTML = html; }
  else patch(v, html);
}
function gateHTML(t, m){
  return '<div class="gate"><div><div class="brand">くらしの献立帖</div><h1 style="font-size:17px;margin-bottom:8px">' + esc(t) + '</h1>' + (m ? '<p>' + esc(m) + '</p>' : '') + '</div></div>';
}
function renderTabs(){
  const nav = $('#tabs');
  if (S.status !== 'ready') { nav.hidden = true; return; }
  nav.hidden = false;
  const todo = curShop().filter(i => !i.checked).length;
  const tabs = [['cal','カレンダー',IC.cal],['recipes','レシピ',IC.book],['shop','買い物',IC.cart],['prefs','設定',IC.gear]];
  const html = tabs.map(([k, l, ic]) => '<button class="tab" data-act="tab" data-tab="' + k + '"' + (S.tab === k ? ' aria-current="page"' : '') + '><span class="ic">' + ic + '</span>' + (k === 'shop' && todo ? '<span class="bdg">' + todo + '</span>' : '') + '<span>' + l + '</span></button>').join('');
  if (nav.innerHTML !== html) nav.innerHTML = html;
}

/* ---------- sign in ---------- */
function authHTML(){
  const m = S.authMode;
  const pendingJoin = lsGet('pendingJoin');
  let body = '';
  if (m === 'reset') {
    body = '<h2 style="font-size:16px">パスワードの再設定</h2><p class="muted small" style="margin-top:4px">登録したメールアドレスに、再設定用のリンクを送ります。</p>'
      + '<div class="field"><label for="au-email">メールアドレス</label><input class="in" id="au-email" type="email" autocomplete="email" inputmode="email" data-enter="authSubmit"></div>'
      + '<button class="btn primary block" style="margin-top:16px" data-act="authSubmit"' + (S.authBusy ? ' disabled' : '') + '>' + (S.authBusy ? '送信中…' : 'リンクを送る') + '</button>';
  } else {
    body = '<div class="seg wide" role="group" aria-label="ログインか新規登録"><button data-act="authMode" data-m="login" aria-pressed="' + (m === 'login') + '">ログイン</button><button data-act="authMode" data-m="signup" aria-pressed="' + (m === 'signup') + '">はじめて使う</button></div>'
      + (m === 'signup' ? '<div class="field"><label for="au-name">表示する名前</label><input class="in" id="au-name" autocomplete="nickname" placeholder="例：はなこ" maxlength="40"></div>' : '')
      + '<div class="field"><label for="au-email">メールアドレス</label><input class="in" id="au-email" type="email" autocomplete="email" inputmode="email"></div>'
      + '<div class="field"><label for="au-pass">パスワード' + (m === 'signup' ? '（8文字以上）' : '') + '</label><input class="in" id="au-pass" type="password" autocomplete="' + (m === 'signup' ? 'new-password' : 'current-password') + '" data-enter="authSubmit" minlength="8"></div>'
      + '<button class="btn primary block" style="margin-top:18px" data-act="authSubmit"' + (S.authBusy ? ' disabled' : '') + '>' + (S.authBusy ? '処理中…' : (m === 'signup' ? '登録する' : 'ログイン')) + '</button>';
  }
  return '<div class="auth">'
    + '<div class="brand"><img class="logo" src="icons/icon-192.png" alt=""><h1>くらしの献立帖</h1><p>ふたりで使う、献立と予定の手帳</p></div>'
    + (pendingJoin ? '<p class="hint">招待コード <b>' + esc(pendingJoin) + '</b> を受け取りました。ログインまたは登録すると、ふたりのスペースに参加できます。</p>' : '')
    + '<div class="card">' + body
    + (S.authErr ? '<p class="err" role="alert">' + esc(S.authErr) + '</p>' : '')
    + (S.authMsg ? '<p class="msg" role="status">' + esc(S.authMsg) + '</p>' : '')
    + '</div>'
    + '<div class="links">' + (m === 'reset' ? '<button data-act="authMode" data-m="login">ログインに戻る</button>' : '<button data-act="authMode" data-m="reset">パスワードを忘れた</button>') + '</div>'
    + '<p class="fine">データはふたりだけが見られる場所に保存されます。</p>'
    + '</div>';
}

/* ---------- calendar ---------- */
function weekStartOf(s){ const ws = S.settings.weekStart || 0; const off = (pd(s).getDay() - ws + 7) % 7; return addD(s, -off); }
function spaceChipHTML(){
  if (!hasShared()) return '';
  return '<button class="space-chip" data-act="openSpacePick" aria-label="献立・レシピ・買い物のスペースを切り替える">' + (S.cur === S.sharedId ? '👫 ふたり' : '👤 じぶん') + '<span class="ar">▼</span></button>';
}
function inviteCardHTML(){
  if (S.hideInviteCard) return '';
  if (hasShared() && partnerId()) return '';
  return '<div class="invite-card"><span class="em">💌</span><p>' + (hasShared() ? 'ふたりのスペースができました。相手に招待コードを送ると、予定や献立を一緒に使えます。' : '相手を招待すると、予定・献立・買い物リストをふたりで共有できます。') + '</p>'
    + '<button class="btn sm primary" data-act="' + (hasShared() ? 'openInvite' : 'goShare') + '">招待する</button><button class="x" data-act="hideInvite" aria-label="この案内を閉じる">' + IC.x + '</button></div>';
}
function calHTML(){
  const sel = S.cal.sel, d = pd(sel);
  const wk = weekStartOf(sel);
  const head = '<header class="top sticky">'
    + '<div class="cal-head">'
    + '<button class="icon-btn" data-act="calNav" data-n="-1" aria-label="' + (S.cal.view === 'month' ? '前の月' : '前の週') + '">' + IC.left + '</button>'
    + '<h1 class="month-title"><small>' + d.getFullYear() + '年</small>' + (d.getMonth() + 1) + '月</h1>'
    + '<button class="icon-btn" data-act="calNav" data-n="1" aria-label="' + (S.cal.view === 'month' ? '次の月' : '次の週') + '">' + IC.right + '</button>'
    + '<span class="sp"></span>'
    + '<button class="icon-btn boxed" data-act="openSearch" aria-label="過去の献立を検索">' + IC.search + '</button>'
    + '<button class="icon-btn boxed" data-act="openGen" data-from="cal" aria-label="献立から買い物リストを作る">' + IC.cart + '</button>'
    + '</div>'
    + '<div class="cal-sub"><div class="seg" role="group" aria-label="表示の切り替え">'
    + '<button data-act="calView" data-v="month" aria-pressed="' + (S.cal.view === 'month') + '">月</button>'
    + '<button data-act="calView" data-v="week" aria-pressed="' + (S.cal.view === 'week') + '">週</button></div>'
    + (S.cal.view === 'week' ? '<span class="range">' + (pd(wk).getMonth() + 1) + '/' + pd(wk).getDate() + '〜' + (pd(addD(wk, 6)).getMonth() + 1) + '/' + pd(addD(wk, 6)).getDate() + '</span>' : '')
    + '<span class="sp"></span>' + spaceChipHTML() + '<button class="chip-btn" data-act="calToday">今日</button></div>'
    + '</header>';
  if (!S.loaded) return head + '<p class="muted small" style="padding:20px 4px">カレンダーを読み込んでいます…</p>';
  return head + inviteCardHTML() + (S.cal.view === 'month' ? monthHTML(sel) + dayPanelHTML(sel, 'in') : weekHTML(sel));
}
function monthHTML(sel){
  const ws = S.settings.weekStart || 0;
  const d = pd(sel), y = d.getFullYear(), mo = d.getMonth();
  const off = (new Date(y, mo, 1).getDay() - ws + 7) % 7;
  const dim = new Date(y, mo + 1, 0).getDate();
  const rows = Math.ceil((off + dim) / 7);
  const start = ds(new Date(y, mo, 1 - off));
  const t = todayS(), shared = hasShared();
  let cells = '';
  for (let i = 0; i < rows * 7; i++) {
    const s = addD(start, i), dd = pd(s), dow = dd.getDay();
    const day = idx().days.get(s);
    const evs = day ? sortEvents(day.events) : [];
    const shifts = evs.filter(e => e.kind === 'shift');
    const plans = evs.filter(e => e.kind === 'plan');
    let dishes = dayDishes(day);
    if (S.settings.monthMeals === 'main') dishes = dishes.filter(x => x.slot === 'main');
    const cls = ['cell', dd.getMonth() !== mo && 'out', s === t && 'today', s === sel && 'sel', dow === 0 && 'sun', dow === 6 && 'sat', i >= (rows - 1) * 7 && 'last'].filter(Boolean).join(' ');
    const shown = dishes.slice(0, 2).map(x => '<span class="m">' + esc(x.name) + '</span>').join('')
      + (dishes.length > 2 ? '<span class="m more">ほか' + (dishes.length - 2) + '品</span>' : '');
    const badges = shifts.slice(0, 2).map(e => '<i class="sb sh-' + e.type + (shared && e.person_id ? ' mk-' + colorOf(e.person_id) : '') + '">' + esc(shiftOf(e.type).short) + '</i>').join('');
    const aria = jp(s) + (shifts.length ? '、' + shifts.map(e => (shared ? nameOf(e.person_id) + 'の' : '') + evLabel(e)).join('・') : '') + (dishes.length ? '、献立' + dishes.length + '品' : '');
    cells += '<button class="' + cls + '" data-act="pickDate" data-date="' + s + '" aria-label="' + esc(aria) + '">'
      + '<span class="crow"><span class="dnum">' + dd.getDate() + '</span>' + (badges && shifts.length < 2 ? '<span class="sbs">' + badges + '</span>' : '') + '</span>'
      + (shifts.length > 1 ? '<span class="sbs row2">' + badges + '</span>' : '')
      + (plans.length ? '<span class="dots">' + plans.slice(0, 3).map(p => '<i class="pl-' + p.type + '"></i>').join('') + '</span>' : '')
      + shown + '</button>';
  }
  const dow = Array.from({length: 7}, (_, i) => { const w = (ws + i) % 7; return '<span class="' + (w === 0 ? 'sun' : w === 6 ? 'sat' : '') + '">' + WD[w] + '</span>'; }).join('');
  let legend = SHIFTS.slice(0, 4).map(s => '<span><i class="sb sh-' + s.k + '">' + s.short + '</i>' + s.label + '</span>').join('')
    + PLANS.slice(0, 3).map(p => '<span><i class="pd pl-' + p.k + '"></i>' + p.label + '</span>').join('');
  if (shared) {
    const pid = partnerId();
    legend += '<span>' + whoHTML(S.uid, 'xs') + esc(nameOf(S.uid)) + '</span>' + (pid ? '<span>' + whoHTML(pid, 'xs') + esc(nameOf(pid)) + '</span>' : '');
  }
  return '<div class="grid swipe"><div class="dow">' + dow + '</div><div class="weeks">' + cells + '</div></div><div class="legend" aria-hidden="true">' + legend + '</div>';
}
function evPillHTML(e, short){
  const shared = hasShared();
  const who = shared ? whoHTML(e.person_id, 'xs') : '';
  const lock = shared && e.space_id !== S.sharedId ? '<span class="lock">🔒</span>' : '';
  if (e.kind === 'shift') return '<span class="evp">' + who + '<span class="pill sh-' + e.type + '">' + esc(evLabel(e)) + (evTime(e) && !short ? ' ' + esc(evTime(e)) : '') + '</span>' + lock + '</span>';
  return '<span class="evp">' + who + '<span class="pill plan"><i class="pd pl-' + e.type + '"></i>' + esc(evLabel(e)) + (e.start_time ? ' ' + esc(e.start_time) : '') + '</span>' + lock + '</span>';
}
function weekHTML(sel){
  const start = weekStartOf(sel), t = todayS();
  let out = '';
  for (let i = 0; i < 7; i++) {
    const s = addD(start, i), dd = pd(s), dow = dd.getDay();
    const day = idx().days.get(s);
    const evs = day ? sortEvents(day.events) : [];
    const tags = evs.map(e => evPillHTML(e)).join('');
    const meals = SLOTS.map(sl => {
      const list = (day && day.meals[sl.k]) || [];
      return list.length ? '<span class="wm"><em>' + sl.label + '</em><span>' + esc(list.map(x => x.name).join('・')) + '</span></span>' : '';
    }).join('');
    out += '<button class="wrow' + (s === t ? ' today' : '') + (s === sel ? ' sel' : '') + '" data-act="openDay" data-date="' + s + '">'
      + '<span class="wd ' + (dow === 0 ? 'sun' : dow === 6 ? 'sat' : '') + '"><b>' + dd.getDate() + '</b><small>' + WD[dow] + (s === t ? '・今日' : '') + '</small></span>'
      + '<span class="wb">' + (tags ? '<span class="wtags">' + tags + '</span>' : '') + (meals || (tags ? '' : '<span class="wempty">予定・献立はまだありません</span>')) + '</span></button>';
  }
  return '<div class="wlist swipe">' + out + '</div>';
}
function dayPanelHTML(date, ctx){
  const day = getDay(date), t = todayS();
  const evs = sortEvents(day.events);
  const evHTML = evs.length ? '<div class="evs">' + evs.map(e => evRowHTML(date, e)).join('') + '</div>' : '<p class="muted small">予定はまだありません</p>';
  const slots = SLOTS.map(sl => {
    const list = day.meals[sl.k] || [];
    const adding = S.adder && S.adder.ctx === ctx && S.adder.date === date && S.adder.slot === sl.k;
    return '<div class="slot"><div class="slot-l">' + sl.label + '</div><div class="dishes">'
      + '<div class="dlist">' + list.map(di => dishBtnHTML(date, sl.k, di)).join('') + '</div>'
      + (adding ? adderHTML(ctx, date, sl.k) : '<button class="add-dish" data-act="openAdder" data-ctx="' + ctx + '" data-date="' + date + '" data-slot="' + sl.k + '">＋ ' + sl.label + 'を追加</button>')
      + '</div></div>';
  }).join('');
  const has = dayHasMeals(day);
  return '<section class="day' + (ctx === 'sh' ? ' flat' : '') + '" id="day-' + ctx + '">'
    + (ctx === 'in' ? '<div class="day-h"><button class="icon-btn sm" data-act="dayStep" data-n="-1" aria-label="前の日">' + IC.left + '</button><h2>' + jp(date) + (date === t ? '<span class="badge">今日</span>' : '') + '</h2><button class="icon-btn sm" data-act="dayStep" data-n="1" aria-label="次の日">' + IC.right + '</button></div>' : '')
    + '<div class="blk"><div class="blk-h"><h3>予定</h3><div class="row-gap"><button class="chip-btn" data-act="newEvent" data-date="' + date + '" data-kind="shift">＋ 勤務</button><button class="chip-btn" data-act="newEvent" data-date="' + date + '" data-kind="plan">＋ 予定</button></div></div>' + evHTML + '</div>'
    + '<div class="blk"><div class="blk-h"><h3>献立' + (hasShared() ? ' <span class="tag" style="letter-spacing:0;vertical-align:1px">' + (S.cur === S.sharedId ? '👫 ふたり' : '👤 じぶん') + '</span>' : '') + '</h3></div>' + slots + '</div>'
    + '<div class="day-actions">'
    + '<button class="btn sm" data-act="copyDay" data-date="' + date + '" data-n="-1"' + (has ? '' : ' disabled') + '>前日にコピー</button>'
    + '<button class="btn sm" data-act="copyDay" data-date="' + date + '" data-n="1"' + (has ? '' : ' disabled') + '>翌日にコピー</button>'
    + (has ? '<button class="btn sm ghost text-danger" data-act="clearMeals" data-date="' + date + '">献立を消去</button>' : '')
    + '</div></section>';
}
function evRowHTML(date, e){
  return '<button class="ev" data-act="editEvent" data-id="' + esc(e.id) + '">'
    + (e.kind === 'shift'
      ? (hasShared() ? whoHTML(e.person_id) : '') + '<span class="pill sh-' + e.type + '">' + esc(e.type === 'other' ? (e.title || 'その他') : shiftOf(e.type).label) + '</span>' + (e.type !== 'other' && e.title ? '<span class="ev-t">' + esc(e.title) + '</span>' : '')
      : (hasShared() ? whoHTML(e.person_id) : '') + '<i class="pd pl-' + e.type + '"></i><span class="ev-t">' + esc(evLabel(e)) + '</span>')
    + (evTime(e) ? '<span class="ev-time">' + esc(evTime(e)) + '</span>' : '')
    + (hasShared() && e.space_id !== S.sharedId ? '<span class="lock">🔒 自分だけ</span>' : '')
    + (e.memo ? '<span class="ev-memo">' + esc(e.memo) + '</span>' : '')
    + '</button>';
}
function dishBtnHTML(date, slot, di){
  const r = resolve(di);
  return '<button class="dish" data-act="openDish" data-id="' + esc(di.id) + '"><span class="dn">' + esc(di.name) + '</span>' + (r ? '<span class="lk" aria-label="レシピあり">' + IC.bookS + '</span>' : '') + '</button>';
}
function adderHTML(ctx, date, slot){
  const id = 'ad-' + ctx + '-' + slot;
  return '<div><div class="adder"><input class="in" id="' + id + '" data-in="dishQ" data-enter="addDishEnter" placeholder="料理名を入力（レシピ名で候補）" autocomplete="off" enterkeyhint="done">'
    + '<button class="btn sm primary" data-act="addDishBtn">追加</button><button class="icon-btn sm" data-act="closeAdder" aria-label="入力を閉じる">' + IC.x + '</button></div>'
    + '<div class="sugs" id="sg-' + ctx + '">' + sugHTML(slot, S.adderQ) + '</div></div>';
}
function suggest(slot, q){
  const n = norm(q);
  let list = curRecipes().slice();
  if (!n) {
    const cats = slot === 'main' ? ['主菜','鍋','麺類'] : slot === 'side' ? ['副菜'] : slot === 'soup' ? ['汁物'] : null;
    if (cats) list = list.filter(r => cats.includes(r.category));
    list.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return {cap: list.length ? 'よく使うレシピ' : '', list: list.slice(0, 5)};
  }
  list = list.filter(r => norm(r.name).includes(n));
  list.sort((a, b) => (norm(a.name).startsWith(n) ? 0 : 1) - (norm(b.name).startsWith(n) ? 0 : 1) || (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  return {cap: list.length ? '保存済みレシピ' : '', list: list.slice(0, 8)};
}
function sugHTML(slot, q){
  const r = suggest(slot, q);
  if (!r.list.length) return q && q.trim() ? '<p class="cap">「' + esc(q.trim()) + '」はレシピ未登録です。追加すると料理名だけで登録されます</p>' : '';
  return '<p class="cap">' + r.cap + '</p>' + r.list.map(x => '<button class="sug" data-act="pickSug" data-rid="' + esc(x.id) + '"><span>' + (REMOJI[x.category] || '🍽️') + '</span><span class="sn">' + esc(x.name) + '</span>' + (x.favorite ? '<small>★</small>' : '') + '<small>' + esc(x.category || '') + '</small></button>').join('');
}

/* ---------- recipes ---------- */
function recipeList(){
  const q = norm(S.rq.text);
  let list = curRecipes().slice();
  if (S.rq.filter === 'fav') list = list.filter(r => r.favorite);
  else if (S.rq.filter === 'want') list = list.filter(r => !r.made);
  if (S.rq.cat !== 'all') list = list.filter(r => r.category === S.rq.cat);
  if (q) list = list.filter(r => norm(r.name).includes(q) || norm(r.memo).includes(q) || (r.ingredients || []).some(i => norm(i.name).includes(q)));
  list.sort((a, b) => (q ? ((norm(a.name).includes(q) ? 0 : 1) - (norm(b.name).includes(q) ? 0 : 1)) : 0) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return list;
}
const thumbHTML = r => '<span class="thumb">' + (r.thumb ? '<img src="' + esc(r.thumb) + '" alt="">' : (REMOJI[r.category] || '🍽️')) + '</span>';
function recipeTags(r){
  const src = r.url ? srcOf(safeUrl(r.url)) : '';
  const md = r.made_dates || [];
  return (r.category ? '<span class="tag">' + esc(r.category) + '</span>' : '')
    + (src ? '<span class="tag src">' + esc(src) + '</span>' : '')
    + (r.made ? '<span class="tag">作った' + (md.length ? ' ' + md.length + '回' : '') + '</span>' : '<span class="tag want">作りたい</span>');
}
function recipesHTML(){
  const all = curRecipes();
  const head = '<header class="top"><div class="page-head"><h1 class="page-title">レシピ</h1><span class="count">' + all.length + '品</span><span class="sp"></span>' + spaceChipHTML() + '</div>'
    + '<div class="search"><span class="sic">' + IC.search + '</span><input class="in" id="rq" type="search" placeholder="料理名・材料で検索" value="' + esc(S.rq.text) + '" data-in="rq" enterkeyhint="search" autocomplete="off"></div>'
    + '<div class="chips" id="rq-f" style="margin-top:8px">' + [['all','すべて'],['fav','★ お気に入り'],['want','作りたい（未調理）']].map(([v, l]) => '<button class="chip" data-act="rqFilter" data-v="' + v + '" aria-pressed="' + (S.rq.filter === v) + '">' + l + '</button>').join('') + '</div>'
    + '<div class="chips" id="rq-c">' + ['all'].concat(RCATS).map(c => '<button class="chip" data-act="rqCat" data-v="' + c + '" aria-pressed="' + (S.rq.cat === c) + '">' + (c === 'all' ? 'すべてのカテゴリー' : REMOJI[c] + ' ' + c) + '</button>').join('') + '</div>'
    + '</header>';
  const fab = '<button class="fab" data-act="newRecipe" aria-label="レシピを追加">' + IC.plus + '</button>';
  if (!S.loaded) return head + '<p class="muted small" style="padding:20px 4px">レシピを読み込んでいます…</p>' + fab;
  if (!all.length) return head + '<div class="empty"><div class="em">📖</div><h2>レシピはまだありません</h2><p class="small">よく作る料理や、SNSで見つけた作りたい料理を保存しておけます。' + (hasShared() && S.cur === S.sharedId ? 'ここに保存したレシピはふたりで使えます。' : '') + '</p><div class="row"><button class="btn primary" data-act="newRecipeFull">レシピを登録</button><button class="btn" data-act="newRecipeQuick">URLだけ保存</button></div></div>' + fab;
  const list = recipeList();
  const body = list.length
    ? '<div class="rlist">' + list.map(r => '<div class="rcard" role="button" tabindex="0" data-act="openRecipe" data-id="' + esc(r.id) + '">' + thumbHTML(r)
      + '<div style="min-width:0"><div class="rname">' + esc(r.name) + '</div><div class="tags">' + recipeTags(r) + '</div></div>'
      + '<button class="star" data-act="toggleFav" data-id="' + esc(r.id) + '" aria-pressed="' + !!r.favorite + '" aria-label="お気に入り">' + (r.favorite ? '★' : '☆') + '</button></div>').join('') + '</div>'
    : '<div class="empty"><div class="em">🔍</div><h2>条件に合うレシピがありません</h2><p class="small">検索語やカテゴリーを変えてみてください。</p></div>';
  return head + body + '<div style="height:64px" aria-hidden="true"></div>' + fab;
}

/* ---------- shopping ---------- */
function shopHTML(){
  const head = '<header class="top"><div class="page-head"><h1 class="page-title">買い物リスト</h1><span class="sp"></span>' + spaceChipHTML() + '<button class="btn sm primary" data-act="openGen" data-from="shop">献立から作成</button></div></header>';
  const add = '<div class="addbar">'
    + '<div class="r1"><input class="in" id="s-name" placeholder="買うものを入力" data-in="shopName" data-enter="shopAdd" autocomplete="off" enterkeyhint="done"><button class="btn primary" data-act="shopAdd">追加</button></div>'
    + '<div class="r2"><input class="in" id="s-qty" placeholder="数量" inputmode="decimal" aria-label="数量"><input class="in" id="s-unit" placeholder="単位" list="unit-list" aria-label="単位"><select class="in" id="s-cat" data-ch="shopCat" aria-label="カテゴリー">' + SCATS.map(c => '<option value="' + c + '">' + SEMOJI[c] + ' ' + c + '</option>').join('') + '</select></div>'
    + '</div>';
  let dup = '';
  if (S.shopDup) {
    const ex = S.shop.get(S.shopDup.exId);
    if (ex) {
      const canMerge = normUnit(ex.unit) === normUnit(S.shopDup.unit) && parseQty(ex.qty) != null && parseQty(S.shopDup.qty) != null;
      dup = '<div class="dupbox" role="alert"><p>「' + esc(ex.name) + '」はすでにリストにあります（' + esc(((ex.qty || '') + (ex.unit || '')) || '数量なし') + '）。どうしますか？</p><div class="row">'
        + (canMerge ? '<button class="btn sm primary" data-act="shopDupMerge">数量をまとめる</button>' : '')
        + '<button class="btn sm" data-act="shopDupAdd">別の行で追加</button><button class="btn sm ghost" data-act="shopDupCancel">やめる</button></div></div>';
    }
  }
  if (!S.loaded) return head + add + '<p class="muted small" style="padding:20px 4px">買い物リストを読み込んでいます…</p>';
  const items = curShop();
  const todo = items.filter(i => !i.checked).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const done = items.filter(i => i.checked).sort((a, b) => String(b.checked_at || '').localeCompare(String(a.checked_at || '')));
  let body = '';
  if (!items.length) body = '<div class="empty"><div class="em">🧺</div><h2>リストは空です</h2><p class="small">上の欄から追加するか、「献立から作成」で期間の献立から材料をまとめて追加できます。' + (hasShared() && S.cur === S.sharedId ? 'ふたりのどちらが追加しても、すぐ相手の画面に出ます。' : '') + '</p></div>';
  else {
    body += '<div class="sect-h"><h2>未購入<small>' + todo.length + '件</small></h2></div>';
    if (!todo.length) body += '<p class="muted small" style="padding:4px">すべて購入済みです 🎉</p>';
    SCATS.forEach(c => {
      const g = todo.filter(i => (SCATS.includes(i.category) ? i.category : 'その他') === c);
      if (!g.length) return;
      body += '<h3 class="cat-h">' + SEMOJI[c] + ' ' + c + '</h3><div class="items">' + g.map(itemHTML).join('') + '</div>';
    });
    if (done.length) {
      body += '<div class="sect-h"><h2>購入済み<small>' + done.length + '件</small></h2><button class="btn sm ghost text-danger" data-act="clearChecked">購入済みを削除</button></div>'
        + '<div class="items">' + done.map(itemHTML).join('') + '</div>';
    }
  }
  return head + add + dup + body;
}
function itemHTML(i){
  const q = ((i.qty || '') + (i.unit || '')).trim();
  const by = i.checked && hasShared() && i.checked_by ? '<span class="checked-by">' + whoHTML(i.checked_by, 'xs') + '</span>' : '';
  return '<div class="item' + (i.checked ? ' done' : '') + '"><button class="chk" role="checkbox" aria-checked="' + !!i.checked + '" aria-label="' + esc(i.name) + 'を' + (i.checked ? '未購入に戻す' : '購入済みにする') + '" data-act="toggleItem" data-id="' + esc(i.id) + '"><span>✓</span></button>'
    + '<button class="item-main" data-act="editItem" data-id="' + esc(i.id) + '"><span class="iname">' + esc(i.name) + by + '</span>' + (q ? '<span class="iqty">' + esc(q) + '</span>' : '') + '</button></div>';
}

/* ---------- settings ---------- */
function prefsHTML(){
  const me = profileOf(S.uid);
  const email = (S.user && S.user.email) || '';
  const seg = (act, cur, opts) => '<div class="seg" role="group">' + opts.map(([v, l]) => '<button data-act="' + act + '" data-v="' + v + '" aria-pressed="' + (String(cur) === String(v)) + '">' + l + '</button>').join('') + '</div>';
  const sh = S.sharedId ? S.spaces.get(S.sharedId) : null;
  let share;
  if (!sh) {
    share = '<p class="note">ふたりのスペースを作って相手を招待すると、予定・献立・買い物リスト・レシピを一緒に使えます。相手から招待コードをもらった場合は「コードで参加」を選んでください。</p>'
      + '<div class="row-gap" style="margin-top:12px"><button class="btn primary" data-act="createShared">ふたりのスペースを作る</button><button class="btn" data-act="openJoin">コードで参加</button></div>';
  } else {
    const mem = spaceMembers(sh.id).slice().sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)));
    const owner = sh.owner_id === S.uid;
    share = '<div class="set-row" style="padding-top:0"><span><b>' + esc(sh.name) + '</b></span><button class="chip-btn" data-act="renameSpace">名前を変える</button></div>'
      + '<div class="members">' + mem.map(m => '<div class="member">' + whoHTML(m.user_id) + '<span class="nm">' + esc(nameOf(m.user_id)) + (m.user_id === S.uid ? '（あなた）' : '') + '</span>' + (m.role === 'owner' ? '<span class="tag">作成者</span>' : '')
        + (owner && m.user_id !== S.uid ? '<button class="btn sm ghost text-danger" data-act="removeMember" data-uid="' + esc(m.user_id) + '">外す</button>' : '') + '</div>').join('') + '</div>'
      + (mem.length < 2 ? '<p class="hint">まだ相手が参加していません。招待コードを送ってください。</p>' : '')
      + '<div class="row-gap" style="margin-top:10px"><button class="btn ' + (mem.length < 2 ? 'primary' : '') + '" data-act="openInvite">招待コードを発行</button>' + (mem.length > 1 ? '<button class="btn ghost text-danger" data-act="leaveSpace">ふたりのスペースから抜ける</button>' : '') + '</div>'
      + '<div class="set-row" style="margin-top:12px;border-top:1px dashed var(--line-2);padding-top:12px"><span>献立・レシピ・買い物に使う<br><small class="muted">予定はいつも両方を表示します</small></span>' + seg('setCur', S.cur === S.sharedId ? 'shared' : 'personal', [['shared','ふたり'],['personal','じぶん']]) + '</div>'
      + (S.personalId && [...S.recipes.values()].some(r => r.space_id === S.personalId) ? '<button class="btn block" style="margin-top:8px" data-act="copyRecipesShared">じぶんのレシピをふたりのスペースにコピー</button>' : '');
  }
  const mealDays = [...idx().days.values()].filter(dayHasMeals).length;
  return '<header class="top"><div class="page-head"><h1 class="page-title">設定</h1></div></header><div class="stack">'
    + '<section class="card"><div class="acct">' + whoHTML(S.uid, 'lg') + '<div style="min-width:0;flex:1"><div class="nm">' + esc(me.display_name || 'わたし') + '</div><div class="muted small" style="overflow-wrap:anywhere">' + esc(email) + '</div></div><button class="chip-btn" data-act="editProfile">変更</button></div></section>'
    + '<section class="card"><h2 class="card-h">👫 ふたりのスペース</h2>' + share + '</section>'
    + '<section class="card"><h2 class="card-h">表示</h2>'
    + '<div class="set-row"><span>週の始まり</span>' + seg('setWS', S.settings.weekStart, [[0,'日曜'],[1,'月曜']]) + '</div>'
    + '<div class="set-row"><span>月表示に出す献立</span>' + seg('setMM', S.settings.monthMeals, [['all','すべて'],['main','主菜のみ']]) + '</div></section>'
    + '<section class="card"><h2 class="card-h">勤務・予定の色</h2><div class="legend-grid">'
    + SHIFTS.map(s => '<span><i class="pill sh-' + s.k + '">' + s.label + '</i></span>').join('')
    + PLANS.map(p => '<span><i class="pd pl-' + p.k + '"></i>' + p.label + '</span>').join('')
    + '</div><p class="note" style="margin-top:10px">勤務は色つきのラベル、予定は色の点で表示します。ふたりで使うときは、だれの予定かを名前の頭文字と色で表示します（月表示ではラベルの下線の色）。🔒 は自分だけに見える予定です。</p></section>'
    + '<section class="card"><h2 class="card-h">データ</h2><dl class="stats"><div><dt>レシピ</dt><dd>' + curRecipes().length + '</dd></div><div><dt>献立のある日</dt><dd>' + mealDays + '</dd></div><div><dt>買い物</dt><dd>' + curShop().length + '</dd></div></dl>'
    + '<div class="stack" style="gap:8px"><button class="btn block" data-act="exportData">バックアップを書き出す（JSON）</button>'
    + '<label class="btn block" for="imp-file">バックアップを読み込む</label><input type="file" id="imp-file" accept="application/json,.json" data-ch="importFile" hidden></div>'
    + '<p class="note" style="margin-top:8px">claude.ai 版（v1）で書き出したバックアップも読み込めます。読み込み先は「' + esc(spaceLabel(S.cur)) + '」のスペースです。</p></section>'
    + '<section class="card"><h2 class="card-h">iPhoneのホーム画面に追加</h2><ol class="howto"><li>このページを Safari で開きます</li><li>画面下の共有ボタン（四角から上向きの矢印）をタップします</li><li>「ホーム画面に追加」を選びます</li></ol><p class="note" style="margin-top:8px">アイコンから開くとアプリのように全画面で使えます。一度ログインすれば、次からはそのまま開けます。</p></section>'
    + '<button class="btn block danger" data-act="logout">ログアウト</button>'
    + '<p class="ver">くらしの献立帖 v' + APP_VERSION + '</p></div>';
}

/* ---------- sheets ---------- */
let sheetSeq = 0;
const topSheet = () => S.sheets[S.sheets.length - 1];
function openSheet(type, props){
  const sh = Object.assign({sid: 's' + (++sheetSeq), type}, props || {});
  S.sheets.push(sh);
  renderSheets();
  return sh;
}
function closeSheet(sid){
  const i = S.sheets.findIndex(s => s.sid === sid);
  if (i < 0) return;
  const sh = S.sheets[i];
  S.sheets.splice(i, 1);
  if (sh.type === 'day' && S.adder && S.adder.ctx === 'sh') S.adder = null;
  const w = document.querySelector('#sheets [data-sid="' + sid + '"]');
  if (w) { w.classList.remove('open'); setTimeout(() => w.remove(), 280); }
  document.documentElement.classList.toggle('locked', S.sheets.length > 0);
}
function closeAllSheets(){ S.sheets.slice().forEach(s => closeSheet(s.sid)); }
function refreshSheet(sh){
  const w = document.querySelector('#sheets [data-sid="' + sh.sid + '"]');
  if (w) patch(w.querySelector('.sheet-inner'), SHEETS[sh.type](sh));
}
function renderSheets(){
  const host = $('#sheets');
  S.sheets.forEach((sh, i) => {
    let w = host.querySelector('[data-sid="' + sh.sid + '"]');
    if (!w) {
      w = document.createElement('div');
      w.className = 'sheet-wrap'; w.dataset.sid = sh.sid; w.style.zIndex = 30 + i;
      w.innerHTML = '<div class="backdrop" data-act="closeTop"></div><section class="sheet' + (sh.tall ? ' tall' : '') + '" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div><div class="sheet-inner"></div></section>';
      host.appendChild(w);
      w.querySelector('.sheet-inner').innerHTML = SHEETS[sh.type](sh);
      void w.offsetWidth;
      requestAnimationFrame(() => w.classList.add('open'));
      setTimeout(() => w.classList.add('open'), 40);
    } else if (!sh.static) {
      patch(w.querySelector('.sheet-inner'), SHEETS[sh.type](sh));
    }
  });
  document.documentElement.classList.toggle('locked', S.sheets.length > 0);
}
const head = (title, opts) => '<div class="sh-head">' + ((opts && opts.left) || '') + '<h2' + (opts && opts.hand ? ' class="hand"' : '') + '>' + title + '</h2>' + ((opts && opts.right) || '') + '<button class="icon-btn" data-act="closeTop" aria-label="閉じる">' + IC.x + '</button></div>';
const SHEETS = {};

SHEETS.day = sh => head(jp(sh.date) + (sh.date === todayS() ? '<span class="badge">今日</span>' : ''), {hand: true,
  left: '<button class="icon-btn" data-act="daySheetStep" data-n="-1" aria-label="前の日">' + IC.left + '</button>',
  right: '<button class="icon-btn" data-act="daySheetStep" data-n="1" aria-label="次の日">' + IC.right + '</button>'})
  + '<div class="sh-body" id="dsb">' + dayPanelHTML(sh.date, 'sh') + '</div>';

SHEETS.dish = sh => {
  const di = S.meals.get(sh.id);
  if (!di) return head('料理') + '<div class="sh-body"><p class="muted">この料理は削除されました。</p></div>';
  const r = resolve(di);
  const slotL = (SLOTS.find(s => s.k === di.slot) || SLOTS[3]).label;
  let body = '<p class="sub">' + jp(di.date) + '・' + slotL + '</p>';
  if (sh.mode === 'rename') {
    body += '<div class="field"><label for="dish-rn">料理名</label><input class="in" id="dish-rn" value="' + esc(di.name) + '" data-enter="dishRenameSave" autocomplete="off"></div>'
      + '<div class="row-gap" style="margin-top:12px"><button class="btn primary" data-act="dishRenameSave">保存</button><button class="btn ghost" data-act="dishMode" data-m="">やめる</button></div>';
  } else if (sh.mode === 'link') {
    body += '<p class="dish-full" style="margin-top:6px">' + esc(di.name) + '</p><div class="field"><label for="dish-lk">紐づけるレシピを検索</label><input class="in" id="dish-lk" data-in="linkQ" placeholder="レシピ名を入力" autocomplete="off"></div>'
      + '<div class="sugs" id="lk-res">' + linkSugHTML(sh.q || '') + '</div>'
      + '<button class="btn ghost" style="margin-top:10px" data-act="dishMode" data-m="">やめる</button>';
  } else {
    body += '<p class="dish-full" style="margin-top:6px">' + esc(di.name) + '</p>';
    if (r) {
      const made = (r.made_dates || []).includes(di.date);
      body += '<div class="r-actions" style="grid-template-columns:1fr 1fr">'
        + '<button class="r-act" data-act="openRecipe" data-id="' + esc(r.id) + '"><span class="ic">📖</span>レシピを開く</button>'
        + '<button class="r-act" data-act="markMade" data-id="' + esc(r.id) + '" data-date="' + di.date + '" aria-pressed="' + made + '"><span class="ic">🍳</span>' + (made ? 'この日に作った' : 'この日に作った記録') + '</button></div>'
        + recipeBodyHTML(r);
    } else {
      body += '<div class="hint" style="margin-top:14px">この料理はまだレシピに登録されていません。登録すると、材料・作り方・参考URLをここから確認でき、買い物リストにも材料を集められます。</div>'
        + '<div class="r-actions" style="grid-template-columns:1fr 1fr"><button class="r-act" data-act="dishToRecipe"><span class="ic">📝</span>レシピとして登録</button><button class="r-act" data-act="dishMode" data-m="link"><span class="ic">🔗</span>保存済みレシピと紐づけ</button></div>';
    }
  }
  return head('料理') + '<div class="sh-body" id="dish-b">' + body + '</div>'
    + (sh.mode ? '' : '<div class="sh-foot"><button class="btn danger" data-act="dishDelete">献立から削除</button><button class="btn grow" data-act="dishMode" data-m="rename">名前を変更</button></div>');
};
function linkSugHTML(q){
  const n = norm(q);
  let list = curRecipes().slice();
  if (n) list = list.filter(r => norm(r.name).includes(n));
  list = list.slice(0, 10);
  if (!list.length) return '<p class="cap">' + (curRecipes().length ? '見つかりません' : '保存済みのレシピがありません') + '</p>';
  return list.map(x => '<button class="sug" data-act="dishLinkPick" data-rid="' + esc(x.id) + '"><span>' + (REMOJI[x.category] || '🍽️') + '</span><span class="sn">' + esc(x.name) + '</span><small>' + esc(x.category || '') + '</small></button>').join('');
}
function recipeBodyHTML(r){
  const ings = (r.ingredients || []).filter(i => i.name);
  const url = safeUrl(r.url);
  const src = url ? srcOf(url) : '';
  let steps = '';
  if (r.steps && r.steps.trim()) {
    const lines = r.steps.split('\n').map(s => s.trim()).filter(Boolean);
    steps = lines.length > 1 ? '<ol>' + lines.map(l => '<li>' + esc(l.replace(/^(\d+[.)．、]\s*|[①-⑳]\s*)/, '')) + '</li>').join('') + '</ol>' : '<p>' + esc(lines[0]) + '</p>';
  }
  return (ings.length ? '<h3 class="r-h">材料' + (r.servings ? '<small>（' + esc(r.servings) + '人分）</small>' : '') + '</h3><ul class="ings">' + ings.map(i => '<li><span>' + esc(i.name) + '</span><span class="q">' + esc((i.qty || '') + (i.unit || '')) + '</span></li>').join('') + '</ul>' : '')
    + (steps ? '<h3 class="r-h">作り方</h3><div class="steps">' + steps + '</div>' : '')
    + (url ? '<h3 class="r-h">参考URL</h3><a class="url-card" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(src || 'リンク') + '</b><span class="u">' + esc(url) + '</span>' + IC.ext + '</a>' : '')
    + (r.memo ? '<h3 class="r-h">メモ</h3><p class="memo">' + esc(r.memo) + '</p>' : '')
    + (!ings.length && !steps && !url && !r.memo ? '<p class="muted small" style="margin-top:16px">材料や作り方はまだ入力されていません。「編集」から追加できます。</p>' : '');
}
SHEETS.recipe = sh => {
  const r = S.recipes.get(sh.id);
  if (!r) return head('レシピ') + '<div class="sh-body"><p class="muted">このレシピは削除されました。</p></div>';
  const photo = S.photoCache.get(r.id) || r.thumb || '';
  const md = r.made_dates || [];
  const t = todayS();
  const by = hasShared() && r.created_by && r.space_id === S.sharedId ? '<p class="made-note">' + esc(nameOf(r.created_by)) + 'が登録' + (r.updated_by && r.updated_by !== r.created_by ? '・' + esc(nameOf(r.updated_by)) + 'が最後に編集' : '') + '</p>' : '';
  return head('', {}) + '<div class="sh-body" id="rcp-b">'
    + '<div class="r-hero">' + (photo ? '<img src="' + esc(photo) + '" alt="' + esc(r.name) + 'の写真">' : (REMOJI[r.category] || '🍽️')) + '</div>'
    + '<h2 class="r-title">' + esc(r.name) + '</h2><div class="tags">' + recipeTags(r) + (r.servings ? '<span class="tag">' + esc(r.servings) + '人分</span>' : '') + '</div>'
    + '<div class="r-actions">'
    + '<button class="r-act" data-act="toggleFav" data-id="' + esc(r.id) + '" aria-pressed="' + !!r.favorite + '"><span class="ic">' + (r.favorite ? '★' : '☆') + '</span>お気に入り</button>'
    + '<button class="r-act" data-act="markMade" data-id="' + esc(r.id) + '" data-date="' + t + '" aria-pressed="' + md.includes(t) + '"><span class="ic">🍳</span>' + (md.includes(t) ? '今日作った' : '作った！') + '</button>'
    + '<button class="r-act" data-act="planRecipe" data-id="' + esc(r.id) + '"><span class="ic">📅</span>献立に追加</button></div>'
    + (md.length ? '<p class="made-note">作った記録：' + md.length + '回（最後は' + jp(md.slice().sort().pop()) + '）</p>' : '')
    + by + recipeBodyHTML(r) + '</div>'
    + '<div class="sh-foot"><button class="btn danger" data-act="deleteRecipe" data-id="' + esc(r.id) + '">削除</button><button class="btn primary grow" data-act="editRecipe" data-id="' + esc(r.id) + '">編集</button></div>';
};
SHEETS.addMenu = () => head('レシピを追加') + '<div class="sh-body">'
  + '<button class="menu-opt" data-act="newRecipeFull"><span class="em">📝</span><span><b>レシピを登録</b><small>材料・作り方・写真・参考URLまで入力</small></span></button>'
  + '<button class="menu-opt" data-act="newRecipeQuick"><span class="em">🔗</span><span><b>URLだけ保存</b><small>Instagram・TikTok・YouTube などを料理名と一緒にメモ</small></span></button></div>';

SHEETS.recipeForm = sh => {
  const d = sh.draft, quick = sh.mode === 'quick';
  const urlField = '<div class="field"><label for="rf-url">参考URL' + (quick ? '<em class="req">必須</em>' : '') + '</label><input class="in" id="rf-url" type="url" inputmode="url" value="' + esc(d.url || '') + '" placeholder="https://www.instagram.com/…" autocomplete="off"></div>';
  let html = head(sh.isNew ? (quick ? 'URLだけ保存' : 'レシピを登録') : 'レシピを編集') + '<div class="sh-body" id="rf-b">';
  if (quick) html += '<p class="hint">Instagram・TikTok・YouTube などのURLと料理名だけで保存できます。材料や作り方はあとから追加できます。</p>' + urlField;
  html += '<div class="field"><label for="rf-name">料理名<em class="req">必須</em></label><input class="in" id="rf-name" value="' + esc(d.name || '') + '" placeholder="例：鶏むね肉のレモン照り焼き" autocomplete="off"></div>'
    + '<p class="err" id="rf-err"' + (sh.err ? '' : ' hidden') + '>' + esc(sh.err || '') + '</p>'
    + '<div class="field"><span class="lbl">カテゴリー</span><div class="chips wrap">' + RCATS.map(c => '<button class="chip" data-act="rfCat" data-c="' + c + '" aria-pressed="' + (d.category === c) + '">' + REMOJI[c] + ' ' + c + '</button>').join('') + '</div></div>';
  if (!quick) {
    html += '<div class="field"><span class="lbl">写真（任意）</span><div class="photo-box">'
      + (d.thumb ? '<span class="pv"><img src="' + esc(d.thumb) + '" alt="選んだ写真"></span>' : '')
      + '<div class="row-gap"><label class="photo-add" for="rf-photo">📷 ' + (d.thumb ? '写真を変える' : '写真を追加') + '</label>' + (d.thumb ? '<button class="btn sm ghost text-danger" data-act="rfPhotoDel">写真を外す</button>' : '') + '</div>'
      + '<input type="file" id="rf-photo" accept="image/*" data-ch="rfPhoto" hidden></div>' + (sh.photoBusy ? '<p class="muted small">写真を準備しています…</p>' : '') + '</div>'
      + '<div class="field"><label for="rf-serv">何人分</label><div class="serv"><input class="in" id="rf-serv" type="number" inputmode="numeric" min="1" max="20" value="' + esc(d.servings || '') + '"><span>人分</span></div></div>'
      + '<div class="field"><span class="lbl">材料</span><div class="ing-head" aria-hidden="true"><span>材料名</span><span>数量</span><span>単位</span><span></span></div><div class="ings-edit">'
      + d.ingredients.map(g => '<div class="ing" id="ing-' + g.id + '"><input class="in" id="rf-in-' + g.id + '" value="' + esc(g.name) + '" placeholder="例：玉ねぎ" aria-label="材料名" autocomplete="off"><input class="in" id="rf-iq-' + g.id + '" value="' + esc(g.qty) + '" placeholder="1/2" aria-label="数量" autocomplete="off"><input class="in" id="rf-iu-' + g.id + '" value="' + esc(g.unit) + '" list="unit-list" placeholder="個" aria-label="単位" autocomplete="off"><button class="icon-btn sm" data-act="rfDelIng" data-k="' + g.id + '" aria-label="この材料を削除">' + IC.x + '</button></div>').join('')
      + '</div><button class="btn sm" style="justify-self:start;margin-top:4px" data-act="rfAddIng">＋ 材料を追加</button><p class="muted small">同じ材料・同じ単位は、買い物リスト作成のときに合計されます。</p></div>'
      + '<div class="field"><label for="rf-steps">作り方</label><textarea class="in" id="rf-steps" rows="6" placeholder="1行に1手順で書くと、番号つきで表示されます">' + esc(d.steps || '') + '</textarea></div>'
      + urlField;
  }
  html += '<div class="field"><label for="rf-memo">メモ</label><textarea class="in" id="rf-memo" rows="3" placeholder="味つけのコツ、アレンジなど">' + esc(d.memo || '') + '</textarea></div>'
    + '<div style="margin-top:12px">'
    + '<button class="switch" role="switch" aria-checked="' + !!d.favorite + '" data-act="rfToggle" data-f="favorite"><span>★ お気に入り</span><span class="knob"></span></button>'
    + '<button class="switch" role="switch" aria-checked="' + !!d.made + '" data-act="rfToggle" data-f="made"><span>作ったことがある<br><small class="muted">オフのままだと「作りたい」一覧に入ります</small></span><span class="knob"></span></button></div>'
    + (quick ? '<button class="link-btn" data-act="rfFull">材料・作り方・写真も入力する</button>' : '')
    + '</div><div class="sh-foot"><button class="btn primary block" data-act="rfSave"' + (sh.saving ? ' disabled' : '') + '>' + (sh.saving ? '保存中…' : '保存する') + '</button></div>';
  return html;
};

SHEETS.event = sh => {
  const e = sh.draft;
  const types = e.kind === 'shift' ? SHIFTS : PLANS;
  const needTitle = e.kind === 'plan' && e.type === 'custom';
  const ph = e.kind === 'shift' ? (e.type === 'other' ? '例：研修、日直' : '例：リーダー') : (e.type === 'custom' ? '例：歯医者、友人とランチ' : '例：駅前のスーパー');
  const pid = partnerId();
  let shareUI = '';
  if (hasShared()) {
    shareUI = '<div class="field"><span class="lbl">見える人</span><div class="seg wide" role="group"><button data-act="evSpace" data-v="shared" aria-pressed="' + (e.space === 'shared') + '">👫 ふたりで共有</button><button data-act="evSpace" data-v="personal" aria-pressed="' + (e.space === 'personal') + '">🔒 自分だけ</button></div></div>';
    if (e.space === 'shared' && pid) {
      const opts = [['me', nameOf(S.uid)], ['partner', nameOf(pid)]];
      if (e.kind === 'plan') opts.push(['both', 'ふたり']);
      shareUI += '<div class="field"><span class="lbl">だれの' + (e.kind === 'shift' ? '勤務' : '予定') + '</span><div class="seg wide" role="group">' + opts.map(([v, l]) => '<button data-act="evPerson" data-v="' + v + '" aria-pressed="' + (e.person === v) + '">' + esc(l) + '</button>').join('') + '</div></div>';
    }
  }
  return head(sh.isNew ? (e.kind === 'shift' ? '勤務を追加' : '予定を追加') : '予定を編集') + '<div class="sh-body">'
    + '<p class="sub">' + jp(sh.date) + (!sh.isNew && hasShared() && sh.createdBy ? '・' + esc(nameOf(sh.createdBy)) + 'が登録' : '') + '</p>'
    + '<div class="seg wide" style="margin-top:12px" role="group" aria-label="種類"><button data-act="evKind" data-k="shift" aria-pressed="' + (e.kind === 'shift') + '">勤務</button><button data-act="evKind" data-k="plan" aria-pressed="' + (e.kind === 'plan') + '">予定</button></div>'
    + shareUI
    + '<div class="field"><span class="lbl">' + (e.kind === 'shift' ? '勤務区分' : '予定の種類') + '</span><div class="type-grid">'
    + types.map(t => '<button class="tchip' + (e.kind === 'shift' ? ' sh-' + t.k : '') + '" data-act="evType" data-t="' + t.k + '" aria-pressed="' + (e.type === t.k) + '">' + (e.kind === 'plan' ? '<i class="pd pl-' + t.k + '"></i>' : '') + t.label + '</button>').join('')
    + '</div></div>'
    + '<div class="field"><label for="ev-title">' + (needTitle ? '内容<em class="req">必須</em>' : '内容（任意）') + '</label><input class="in" id="ev-title" value="' + esc(e.title || '') + '" placeholder="' + ph + '" autocomplete="off" maxlength="100"></div>'
    + '<div class="field two"><div style="display:grid;gap:6px"><label for="ev-start" class="lbl">開始</label><input class="in" type="time" id="ev-start" value="' + esc(e.start || '') + '" data-fresh></div><div style="display:grid;gap:6px"><label for="ev-end" class="lbl">終了</label><input class="in" type="time" id="ev-end" value="' + esc(e.end || '') + '" data-fresh></div></div>'
    + '<div class="field"><label for="ev-memo">メモ</label><textarea class="in" id="ev-memo" rows="2" maxlength="1000">' + esc(e.memo || '') + '</textarea></div>'
    + '<p class="err" id="ev-err"' + (sh.err ? '' : ' hidden') + '>' + esc(sh.err || '') + '</p>'
    + '</div><div class="sh-foot">' + (sh.isNew ? '' : '<button class="btn danger" data-act="evDelete">削除</button>') + '<button class="btn primary grow" data-act="evSave">保存</button></div>';
};

SHEETS.item = sh => {
  const d = sh.draft;
  return head('買うものを編集') + '<div class="sh-body">'
    + '<div class="field"><label for="it-name">商品名<em class="req">必須</em></label><input class="in" id="it-name" value="' + esc(d.name) + '" autocomplete="off"></div>'
    + '<div class="field two"><div style="display:grid;gap:6px"><label class="lbl" for="it-qty">数量</label><input class="in" id="it-qty" value="' + esc(d.qty || '') + '" inputmode="decimal"></div><div style="display:grid;gap:6px"><label class="lbl" for="it-unit">単位</label><input class="in" id="it-unit" value="' + esc(d.unit || '') + '" list="unit-list"></div></div>'
    + '<div class="field"><label for="it-cat">カテゴリー</label><select class="in" id="it-cat">' + SCATS.map(c => '<option value="' + c + '"' + (d.category === c ? ' selected' : '') + '>' + SEMOJI[c] + ' ' + c + '</option>').join('') + '</select></div>'
    + (hasShared() && d.created_by ? '<p class="muted small" style="margin-top:12px">' + esc(nameOf(d.created_by)) + 'が追加' + (d.checked && d.checked_by ? '・' + esc(nameOf(d.checked_by)) + 'が購入' : '') + '</p>' : '')
    + '<p class="err" id="it-err"' + (sh.err ? '' : ' hidden') + '>' + esc(sh.err || '') + '</p>'
    + '</div><div class="sh-foot"><button class="btn danger" data-act="itemDelete">削除</button><button class="btn primary grow" data-act="itemSave">保存</button></div>';
};

SHEETS.confirm = sh => head(esc(sh.title)) + '<div class="sh-body"><p style="white-space:pre-wrap">' + esc(sh.msg) + '</p></div><div class="sh-foot col">'
  + sh.btns.map((b, i) => '<button class="btn block ' + (b.cls || '') + '" data-act="cfm" data-i="' + i + '">' + esc(b.label) + '</button>').join('') + '</div>';

SHEETS.plan = sh => {
  const r = S.recipes.get(sh.id);
  return head('献立に追加') + '<div class="sh-body">'
    + '<p class="dish-full" style="font-size:17px">' + esc(r ? r.name : '') + '</p>'
    + '<div class="field"><label for="pl-date">日付</label><input class="in" type="date" id="pl-date" value="' + esc(sh.date) + '"></div>'
    + '<div class="field"><label for="pl-slot">どこに入れる？</label><select class="in" id="pl-slot">' + SLOTS.map(s => '<option value="' + s.k + '"' + (sh.slot === s.k ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select></div>'
    + '</div><div class="sh-foot"><button class="btn primary block" data-act="planSave">追加する</button></div>';
};

SHEETS.search = sh => head('献立をさがす') + '<div class="sh-body" id="srch-b">'
  + '<div class="search" style="margin-top:0"><span class="sic">' + IC.search + '</span><input class="in" id="srch" type="search" data-in="srch" placeholder="料理名で検索（例：カレー）" autocomplete="off" enterkeyhint="search"></div>'
  + '<div id="srch-res">' + searchResHTML(sh.q || '') + '</div></div>';
function searchResHTML(q){
  const n = norm(q), t = todayS();
  const days = [...idx().days.values()].filter(dayHasMeals).sort((a, b) => b.date.localeCompare(a.date));
  const out = [];
  for (const d of days) {
    if (!n && d.date > t) continue;
    const all = dayDishes(d);
    const hit = n ? all.filter(x => norm(x.name).includes(n)) : all;
    if (!hit.length) continue;
    out.push({date: d.date, hit, all});
    if (out.length >= 60) break;
  }
  if (!out.length) return '<p class="muted small" style="padding:16px 4px">' + (n ? '「' + esc(q) + '」を含む献立は見つかりませんでした。' : 'まだ過去の献立がありません。') + '</p>';
  const mark = name => {
    if (!n) return esc(name);
    const i = norm(name).indexOf(n);
    if (i < 0 || name.length !== norm(name).length) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + n.length)) + '</mark>' + esc(name.slice(i + n.length));
  };
  return '<p class="muted small" style="margin:12px 4px 0">' + (n ? out.length + '日分が見つかりました' : '最近の献立') + '</p>'
    + out.map(o => '<button class="res-day" data-act="jumpDate" data-date="' + o.date + '"><b>' + jp(o.date) + '</b><div class="rl">' + o.all.map(x => o.hit.includes(x) ? mark(x.name) : '<span class="muted">' + esc(x.name) + '</span>').join('・') + '</div></button>').join('');
}

SHEETS.gen = sh => {
  if (sh.step === 2) return genStep2HTML(sh);
  const t = todayS(), ws = weekStartOf(t);
  return head('献立から買い物リスト') + '<div class="sh-body">'
    + '<p class="sub">期間を選ぶと、その間の献立に登録したレシピの材料をまとめます。</p>'
    + '<div class="presets" style="margin-top:12px">'
    + '<button class="chip" data-act="genPreset" data-a="' + t + '" data-b="' + addD(t, 6) + '">今日から7日間</button>'
    + '<button class="chip" data-act="genPreset" data-a="' + ws + '" data-b="' + addD(ws, 6) + '">今週</button>'
    + '<button class="chip" data-act="genPreset" data-a="' + addD(ws, 7) + '" data-b="' + addD(ws, 13) + '">来週</button></div>'
    + '<div class="field two"><div style="display:grid;gap:6px"><label class="lbl" for="g-from">開始日</label><input class="in" type="date" id="g-from" value="' + sh.from + '" data-ch="genRange" data-fresh></div>'
    + '<div style="display:grid;gap:6px"><label class="lbl" for="g-to">終了日</label><input class="in" type="date" id="g-to" value="' + sh.to + '" data-ch="genRange" data-fresh></div></div>'
    + '<div class="gsum" id="g-sum">' + genSummaryHTML(sh.from, sh.to) + '</div>'
    + '</div><div class="sh-foot"><button class="btn primary block" data-act="genCollect">材料を集める</button></div>';
};
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const rangeDays = (a, b) => daysBetween(a, b) + 1;
function genSummaryHTML(a, b){
  if (!validDate(a) || !validDate(b)) return '開始日と終了日を選んでください。';
  if (a > b) return '終了日は開始日より後にしてください。';
  if (rangeDays(a, b) > 62) return '期間は62日以内で選んでください。';
  let dishes = 0, withIng = 0;
  for (let s = a; s <= b; s = addD(s, 1)) {
    dayDishes(idx().days.get(s)).forEach(di => { dishes++; const r = resolve(di); if (r && (r.ingredients || []).some(i => i.name)) withIng++; });
  }
  return '<b>' + jp(a) + ' 〜 ' + jp(b) + '</b>（' + rangeDays(a, b) + '日間）<br>料理 ' + dishes + '品のうち、材料が登録されているのは ' + withIng + '品です。';
}
function collectRange(a, b){
  const rows = new Map(), missing = new Map();
  for (let s = a; s <= b; s = addD(s, 1)) {
    for (const di of dayDishes(idx().days.get(s))) {
      const r = resolve(di);
      const ings = ((r && r.ingredients) || []).filter(i => i.name && String(i.name).trim());
      if (!ings.length) { missing.set(norm(di.name), di.name); continue; }
      for (const ig of ings) {
        const unit = normUnit(ig.unit);
        const key = normIng(ig.name) + '|' + unit;
        let row = rows.get(key);
        if (!row) { row = {name: String(ig.name).trim(), unit, nums: [], texts: [], dishes: new Set(), category: guessCat(ig.name)}; rows.set(key, row); }
        const n = parseQty(ig.qty);
        const raw = String(ig.qty || '').trim();
        if (n != null) row.nums.push(n); else if (raw && !row.texts.includes(raw)) row.texts.push(raw);
        row.dishes.add(r.name);
      }
    }
  }
  const existing = curShop().filter(i => !i.checked);
  const list = [...rows.values()].map(r => {
    const qty = [r.nums.length ? fmtNum(r.nums.reduce((x, y) => x + y, 0)) : ''].concat(r.texts).filter(Boolean).join('＋');
    const row = {name: r.name, unit: r.unit, qty, category: r.category, dishes: [...r.dishes]};
    const ex = existing.find(i => normIng(i.name) === normIng(r.name));
    if (ex) row.dup = {id: ex.id, label: (ex.name + ' ' + (ex.qty || '') + (ex.unit || '')).trim()};
    return row;
  });
  list.sort((x, y) => SCATS.indexOf(x.category) - SCATS.indexOf(y.category) || x.name.localeCompare(y.name, 'ja'));
  return {rows: list, missing: [...missing.values()]};
}
function genStep2HTML(sh){
  const rows = sh.rows;
  let body = '<p class="sub">' + jp(sh.from) + ' 〜 ' + jp(sh.to) + '</p>';
  if (!rows.length) {
    body += '<div class="empty" style="padding:24px 8px"><div class="em">🥕</div><h2>集められる材料がありません</h2><p class="small">この期間の献立に、材料が登録されたレシピがありません。</p></div>';
  } else {
    body += '<p class="muted small" style="margin-top:6px">追加しないものはチェックを外してください。数量や単位も直せます。同じ材料・同じ単位は合計済みです。</p>';
    let lastCat = '';
    rows.forEach((r, i) => {
      if (r.category !== lastCat) { body += '<h3 class="cat-h">' + SEMOJI[r.category] + ' ' + r.category + '</h3>'; lastCat = r.category; }
      body += '<div class="grow-row' + (r.off ? ' off' : '') + '" id="g-row-' + i + '"><label class="gchk"><input type="checkbox" id="g-inc-' + i + '" data-ch="genInc" data-i="' + i + '"' + (r.off ? '' : ' checked') + ' aria-label="' + esc(r.name) + 'を追加する"></label>'
        + '<div class="gf"><input class="in" id="g-name-' + i + '" value="' + esc(r.name) + '" aria-label="材料名">'
        + '<div class="gq"><input class="in" id="g-qty-' + i + '" value="' + esc(r.qty) + '" aria-label="数量" placeholder="数量"><input class="in" id="g-unit-' + i + '" value="' + esc(r.unit) + '" list="unit-list" aria-label="単位" placeholder="単位">'
        + '<select class="in" id="g-cat-' + i + '" aria-label="カテゴリー">' + SCATS.map(c => '<option value="' + c + '"' + (c === r.category ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>'
        + '<div class="gsrc">使う料理：' + esc(r.dishes.join('、')) + '</div>'
        + (r.dup ? '<div class="gdup"><span>⚠️ リストにすでにあります：' + esc(r.dup.label) + '</span><select class="in" id="g-dup-' + i + '" aria-label="重複したときの扱い"><option value="skip">追加しない</option><option value="merge">リストの数量に合算する</option><option value="add">別の行で追加する</option></select></div>' : '')
        + '</div></div>';
    });
  }
  if (sh.missing.length) body += '<div class="missing">材料が登録されていない料理：' + esc(sh.missing.join('、')) + '<br>レシピに材料を登録すると、次回から自動で集められます。</div>';
  return head('材料の確認') + '<div class="sh-body" id="gen-b">' + body + '</div><div class="sh-foot"><button class="btn" data-act="genBack">戻る</button>'
    + (rows.length ? '<button class="btn primary grow" data-act="genAdd">買い物リストに追加</button>' : '') + '</div>';
}

SHEETS.invite = sh => {
  let body;
  if (sh.busy || (!sh.code && !sh.err)) body = '<p class="muted" style="padding:24px 0;text-align:center">招待コードを発行しています…</p>';
  else if (sh.err) body = '<p class="err">' + esc(sh.err) + '</p><button class="btn block" style="margin-top:12px" data-act="openInviteRetry">もう一度試す</button>';
  else {
    const code = sh.code, shown = code.slice(0, 5) + '-' + code.slice(5);
    body = '<p class="note">相手にこのアプリのリンクと招待コードを送ってください。相手は「はじめて使う」から登録して、コードを入力すると参加できます。</p>'
      + '<div class="code-box" id="inv-code">' + esc(shown) + '</div>'
      + '<p class="muted small" style="text-align:center;margin-top:6px">3日間・1回だけ使えます</p>'
      + '<div class="row-gap" style="margin-top:14px"><button class="btn primary grow" data-act="shareInvite">LINEなどで送る</button><button class="btn grow" data-act="copyInvite">コピー</button></div>'
      + '<p class="muted small" style="margin-top:14px;overflow-wrap:anywhere">リンク：' + esc(appUrl() + '#join=' + code) + '</p>';
  }
  return head('相手を招待') + '<div class="sh-body">' + body + '</div>';
};
SHEETS.join = sh => head('招待コードで参加') + '<div class="sh-body">'
  + '<p class="note">相手から届いた10文字のコードを入力してください。参加すると、ふたりの予定・献立・買い物リスト・レシピが見られるようになります。あなたの「じぶん」のデータは共有されません。</p>'
  + '<div class="field"><label for="join-code">招待コード</label><input class="in code-in" id="join-code" value="' + esc(sh.code || '') + '" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14" placeholder="ABCDE-FGHJK" data-enter="joinSubmit"></div>'
  + '<p class="err"' + (sh.err ? '' : ' hidden') + '>' + esc(sh.err || '') + '</p>'
  + '</div><div class="sh-foot"><button class="btn primary block" data-act="joinSubmit"' + (sh.busy ? ' disabled' : '') + '>' + (sh.busy ? '参加しています…' : '参加する') + '</button></div>';
SHEETS.profile = sh => head('プロフィール') + '<div class="sh-body">'
  + '<div class="field"><label for="pf-name">表示する名前</label><input class="in" id="pf-name" value="' + esc(sh.name) + '" maxlength="40" autocomplete="nickname"></div>'
  + '<div class="field"><span class="lbl">あなたの色（カレンダーで、だれの予定かを表します）</span><div class="color-pick">' + COLORS.map(([k, l]) => '<button class="who-' + k + '" data-act="pfColor" data-c="' + k + '" aria-pressed="' + (sh.color === k) + '" aria-label="' + l + '"></button>').join('') + '</div></div>'
  + '<p class="err"' + (sh.err ? '' : ' hidden') + '>' + esc(sh.err || '') + '</p>'
  + '</div><div class="sh-foot"><button class="btn primary block" data-act="pfSave">保存</button></div>';
SHEETS.spaceName = sh => head('スペースの名前') + '<div class="sh-body">'
  + '<div class="field"><label for="sp-name">名前</label><input class="in" id="sp-name" value="' + esc(sh.name) + '" maxlength="40" data-enter="spaceNameSave"></div>'
  + '</div><div class="sh-foot"><button class="btn primary block" data-act="spaceNameSave">保存</button></div>';
SHEETS.spacePick = () => head('使うスペース') + '<div class="sh-body"><p class="note" style="margin-bottom:12px">献立・レシピ・買い物リストをどちらのスペースで使うか選びます。予定はいつも両方を表示します。</p><div class="opt-list">'
  + '<button class="opt" data-act="pickSpace" data-v="shared" aria-pressed="' + (S.cur === S.sharedId) + '"><span class="em">👫</span><span><b>ふたり</b><small>' + esc((S.spaces.get(S.sharedId) || {}).name || '') + '・相手と一緒に使う</small></span></button>'
  + '<button class="opt" data-act="pickSpace" data-v="personal" aria-pressed="' + (S.cur === S.personalId) + '"><span class="em">👤</span><span><b>じぶん</b><small>自分だけに見える</small></span></button>'
  + '</div></div>';
SHEETS.newPassword = sh => head('新しいパスワード') + '<div class="sh-body">'
  + '<div class="field"><label for="np-pass">新しいパスワード（8文字以上）</label><input class="in" id="np-pass" type="password" autocomplete="new-password" minlength="8" data-enter="npSave"></div>'
  + '<p class="err"' + (sh.err ? '' : ' hidden') + '>' + esc(sh.err || '') + '</p>'
  + '</div><div class="sh-foot"><button class="btn primary block" data-act="npSave">変更する</button></div>';

/* ---------- toast ---------- */
let toastT = null;
function toast(msg, opt){
  opt = opt || {};
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (opt.undo ? '<button data-act="undo">元に戻す</button>' : '');
  el.className = 'show' + (opt.err ? ' err' : '');
  S.undo = opt.undo || null;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.className = ''; S.undo = null; }, opt.undo ? 5000 : (opt.err ? 4500 : 2200));
}
const openConfirm = (title, msg, btns) => openSheet('confirm', {title, msg, btns, static: true});

/* ---------- helpers for actions ---------- */
function switchTab(t){
  if (t === S.tab) { window.scrollTo({top: 0, behavior: 'smooth'}); return; }
  S.scroll[S.tab] = window.scrollY;
  S.tab = t; lsSet('tab', t);
  S.adder = null; S.shopDup = null;
  render();
  window.scrollTo(0, S.scroll[t] || 0);
}
function submitDish(inp){
  if (!inp || !S.adder) return;
  const name = inp.value.trim();
  if (!name) { inp.focus(); return; }
  const r = idx().rIndex.get(norm(name));
  addDish(S.adder.date, S.adder.slot, r ? r.name : name, r ? r.id : null);
  inp.value = ''; S.adderQ = '';
  render(); focusAdder();
}
function focusAdder(){
  if (!S.adder) return;
  const n = document.getElementById('ad-' + S.adder.ctx + '-' + S.adder.slot);
  if (n) { try { n.focus({preventScroll: true}); } catch (e) {} }
}
function nextPos(date, slot){
  const list = getDay(date).meals[slot] || [];
  return list.length ? Math.max.apply(null, list.map(x => x.position || 0)) + 1 : 1;
}
function addDish(date, slot, name, recipeId){
  return insertRow('meal_items', {id: uuid(), space_id: S.cur, date, slot, name, recipe_id: recipeId || null, position: nextPos(date, slot)});
}
function openRecipeForm(opts){
  const r = opts.id ? S.recipes.get(opts.id) : null;
  const draft = r ? {name: r.name, category: r.category, ingredients: clone(r.ingredients || []), servings: r.servings || '', steps: r.steps || '', url: r.url || '', memo: r.memo || '', favorite: !!r.favorite, made: !!r.made, made_dates: (r.made_dates || []).slice(), thumb: r.thumb || '', has_photo: !!r.has_photo}
    : {name: opts.name || '', category: opts.category || '主菜', ingredients: [], servings: '', steps: '', url: '', memo: '', favorite: false, made: false, made_dates: [], thumb: '', has_photo: false};
  draft.ingredients = draft.ingredients.map(g => ({id: g.id || gid('g'), name: g.name || '', qty: g.qty == null ? '' : String(g.qty), unit: g.unit || ''}));
  if (opts.mode !== 'quick') while (draft.ingredients.length < 3) draft.ingredients.push({id: gid('g'), name: '', qty: '', unit: ''});
  openSheet('recipeForm', {tall: true, static: true, isNew: !r, id: r ? r.id : uuid(), space: r ? r.space_id : S.cur, mode: opts.mode || 'full', draft, linkTo: opts.linkTo || null, photoChanged: false, photoFull: null});
}
function collectRF(sh){
  const d = sh.draft;
  const v = id => { const n = document.getElementById(id); return n ? n.value : null; };
  if (v('rf-name') != null) d.name = v('rf-name');
  if (v('rf-url') != null) d.url = v('rf-url');
  if (v('rf-memo') != null) d.memo = v('rf-memo');
  if (v('rf-steps') != null) d.steps = v('rf-steps');
  if (v('rf-serv') != null) d.servings = v('rf-serv');
  d.ingredients.forEach(g => { if (v('rf-in-' + g.id) != null) { g.name = v('rf-in-' + g.id); g.qty = v('rf-iq-' + g.id); g.unit = v('rf-iu-' + g.id); } });
}
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
function drawScaled(img, max, q){
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
function drawSquare(img, size, q){
  const w = img.naturalWidth, h = img.naturalHeight, m = Math.min(w, h);
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
  x.drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, size, size);
  return c.toDataURL('image/jpeg', q);
}
async function processPhoto(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    let max = 1080, q = 0.8, full = drawScaled(img, max, q);
    while (full.length > 280000 && max > 360) { max -= 160; q = Math.max(0.55, q - 0.05); full = drawScaled(img, max, q); }
    let tq = 0.7, thumb = drawSquare(img, 160, tq);
    while (thumb.length > 14000 && tq > 0.4) { tq -= 0.08; thumb = drawSquare(img, 140, tq); }
    return {full, thumb};
  } finally { URL.revokeObjectURL(url); }
}
async function loadPhoto(id){
  const r = S.recipes.get(id);
  if (!r || !r.has_photo || S.photoCache.has(id) || !sb) return;
  try {
    const {data} = await sb.from('recipe_photos').select('data').eq('recipe_id', id).maybeSingle();
    if (data && data.data) { S.photoCache.set(id, data.data); scheduleRender(); }
  } catch (e) {}
}
function readEventForm(sh){
  const d = sh.draft;
  const v = id => { const n = document.getElementById(id); return n ? n.value : ''; };
  d.title = v('ev-title').trim(); d.start = v('ev-start'); d.end = v('ev-end'); d.memo = v('ev-memo').trim();
}
const shiftKey = d => (d.space === 'shared' && d.person === 'partner' ? 'p:' : '') + d.type;
function presetTimes(sh){
  const d = sh.draft;
  if (d.kind !== 'shift' || d.start || d.end) return;
  const t = (S.settings.shiftTimes || {})[shiftKey(d)];
  if (t) { d.start = t.start || ''; d.end = t.end || ''; }
}
function markMade(id, date){
  const r = S.recipes.get(id); if (!r) return;
  const md = new Set(r.made_dates || []);
  if (md.has(date)) { md.delete(date); toast(jp(date) + 'の記録を取り消しました'); }
  else { md.add(date); toast('作った記録をつけました 🍳'); }
  const list = [...md].sort().slice(-100);
  updateRow('recipes', id, {made_dates: list, made: list.length ? true : r.made});
}
function scrollDayIntoView(){
  const el = document.getElementById('day-in');
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top > window.innerHeight - 160) el.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
}
function rpcErrText(e){
  const m = String((e && e.message) || '');
  if (/invalid_code/.test(m)) return 'コードが違うか、期限が切れています。新しいコードを発行してもらってください';
  if (/already_in_shared_space/.test(m)) return 'すでに別のふたりのスペースに参加しています';
  if (/last_member/.test(m)) return '最後のメンバーは抜けられません';
  if (/not_owner/.test(m)) return 'メンバーを外せるのはスペースを作った人だけです';
  if (/Could not find the function|PGRST202|does not exist/i.test(m)) return 'この機能はまだ準備中です。Supabase で schema.sql の「オプション」を実行すると使えます';
  if (isNetErr(e)) return '通信できませんでした。電波のよいところでもう一度お試しください';
  return 'うまくいきませんでした。もう一度お試しください';
}
async function copyText(text){
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}
async function startInvite(sh){
  sh.busy = true; sh.err = ''; refreshSheet(sh);
  const {data, error} = await sb.rpc('create_invite', {p_space: S.sharedId});
  sh.busy = false;
  if (error) sh.err = rpcErrText(error); else sh.code = data;
  if (S.sheets.includes(sh)) refreshSheet(sh);
}
async function afterJoinOrCreate(){
  await refreshAll();
  if (S.sharedId) saveSettings({curSpace: S.sharedId});
  S.hideInviteCard = false; lsSet('hideInvite', null);
  render();
}
async function copyRecipesToShared(){
  const target = S.sharedId; if (!target) return;
  const have = new Set([...S.recipes.values()].filter(r => r.space_id === target).map(r => norm(r.name)));
  const src = [...S.recipes.values()].filter(r => r.space_id === S.personalId && !have.has(norm(r.name)));
  if (!src.length) { toast('コピーするレシピはありません（同じ名前のレシピはふたりのスペースにあります）'); return; }
  toast(src.length + '品をコピーしています…');
  const pairs = src.map(r => [r, Object.assign(strip(r), {id: uuid(), space_id: target})]);
  const ok = await insertRows('recipes', pairs.map(p => p[1]));
  if (!ok) return;
  for (const [old, neo] of pairs) {
    if (!old.has_photo) continue;
    try {
      const {data} = await sb.from('recipe_photos').select('data').eq('recipe_id', old.id).maybeSingle();
      if (data && data.data) await savePhoto(neo.id, target, data.data);
    } catch (e) {}
  }
  toast(src.length + '品のレシピをふたりのスペースにコピーしました');
}

/* ---------- import / export ---------- */
function buildImport(json){
  const target = S.cur;
  const idMap = new Map();
  const recipes = [], photos = [], meals = [], events = [], shop = [];
  const RC = c => RCATS.includes(c) ? c : 'その他';
  const SC = c => SCATS.includes(c) ? c : guessCat('');
  const okTime = t => /^[0-2]\d:[0-5]\d$/.test(t || '') ? t : '';
  const v1 = !json.version || json.version === 1 || Array.isArray(json.days);
  (json.recipes || []).forEach(r => {
    if (!r || !r.name) return;
    const nid = uuid(); idMap.set(r.id, nid);
    const md = (r.made_dates || r.madeDates || []).filter(validDate);
    const serv = parseInt(r.servings, 10);
    recipes.push({id: nid, space_id: target, name: String(r.name).slice(0, 200), category: RC(r.category),
      ingredients: (r.ingredients || []).filter(g => g && g.name).map(g => ({id: g.id || gid('g'), name: String(g.name), qty: String(g.qty == null ? '' : g.qty), unit: String(g.unit || '')})),
      servings: serv > 0 && serv < 100 ? serv : null, steps: String(r.steps || '').slice(0, 20000), url: safeUrl(r.url), memo: String(r.memo || '').slice(0, 5000),
      favorite: !!r.favorite, made: !!r.made || md.length > 0, made_dates: md, thumb: (r.thumb && String(r.thumb).length <= 60000) ? r.thumb : '', has_photo: false});
  });
  const ph = json.recipePhotos || json.photos || {};
  Object.keys(ph).forEach(oid => { const nid = idMap.get(oid); if (nid && ph[oid] && String(ph[oid]).length <= 400000) photos.push({recipe_id: nid, data: ph[oid]}); });
  photos.forEach(p => { const r = recipes.find(x => x.id === p.recipe_id); if (r) r.has_photo = true; });
  const pushMeal = (date, slot, m) => { if (!validDate(date) || !m || !m.name) return; meals.push({id: uuid(), space_id: target, date, slot: SLOTS.some(s => s.k === slot) ? slot : 'other', name: String(m.name).slice(0, 200), recipe_id: idMap.get(m.recipeId || m.recipe_id) || null, position: meals.length + 1}); };
  const pushEvent = (date, e) => {
    if (!validDate(date) || !e) return;
    const kind = e.kind === 'shift' ? 'shift' : 'plan';
    const okType = kind === 'shift' ? SHIFTS.some(s => s.k === e.type) : PLANS.some(p => p.k === e.type);
    events.push({id: uuid(), space_id: target, date, kind, type: okType ? e.type : (kind === 'shift' ? 'other' : 'custom'), title: String(e.title || '').slice(0, 100) || (okType ? '' : '予定'),
      start_time: okTime(e.start || e.start_time), end_time: okTime(e.end || e.end_time), memo: String(e.memo || '').slice(0, 1000), person_id: S.uid});
  };
  if (v1) {
    (json.days || []).forEach(d => {
      SLOTS.forEach(s => ((d.meals && d.meals[s.k]) || []).forEach(m => pushMeal(d.date, s.k, m)));
      (d.events || []).forEach(e => pushEvent(d.date, e));
    });
  } else {
    (json.meals || []).forEach(m => pushMeal(m.date, m.slot, m));
    (json.events || []).forEach(e => pushEvent(e.date, e));
  }
  (json.shopping || []).forEach(i => { if (i && i.name) shop.push({id: uuid(), space_id: target, name: String(i.name).slice(0, 200), qty: String(i.qty || '').slice(0, 40), unit: String(i.unit || '').slice(0, 20), category: SCATS.includes(i.category) ? i.category : guessCat(i.name), checked: !!i.checked}); });
  return {recipes, photos, meals, events, shop, target};
}
async function runImport(pkg){
  toast('読み込んでいます…');
  const ok1 = await insertRows('recipes', pkg.recipes);
  if (!ok1) return;
  for (const p of pkg.photos) await savePhoto(p.recipe_id, pkg.target, p.data);
  const ok2 = await insertRows('meal_items', pkg.meals);
  const ok3 = await insertRows('events', pkg.events);
  const ok4 = await insertRows('shopping_items', pkg.shop);
  if (ok2 && ok3 && ok4) toast('バックアップを読み込みました');
}
async function exportData(){
  toast('書き出しの準備をしています…');
  let photos = {};
  try { (await fetchAll('recipe_photos', 'recipe_id,data', 'recipe_id')).forEach(p => { photos[p.recipe_id] = p.data; }); } catch (e) {}
  const data = {app: 'くらしの献立帖', version: 2, exportedAt: nowISO(), spaces: [...S.spaces.values()].map(s => ({id: s.id, kind: s.kind, name: s.name})),
    recipes: [...S.recipes.values()], meals: [...S.meals.values()], events: [...S.events.values()], shopping: [...S.shop.values()], photos};
  const blob = new Blob([JSON.stringify(data, null, 1)], {type: 'application/json'});
  const name = 'kondatecho-backup-' + todayS() + '.json';
  try {
    const file = new File([blob], name, {type: 'application/json'});
    if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: name}); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('バックアップを書き出しました');
}

/* ---------- actions ---------- */
const A = {
  tab: el => switchTab(el.dataset.tab),
  closeTop: () => { const sh = topSheet(); if (sh) closeSheet(sh.sid); },
  undo: () => { const f = S.undo; S.undo = null; $('#toast').className = ''; if (f) f(); },
  reload: () => location.reload(),

  authMode: el => { S.authMode = el.dataset.m; S.authErr = ''; S.authMsg = ''; render(); const f = $('#au-name') || $('#au-email'); if (f) f.focus(); },
  authSubmit: async () => {
    if (S.authBusy) return;
    const email = ($('#au-email') && $('#au-email').value || '').trim();
    const pass = $('#au-pass') ? $('#au-pass').value : '';
    S.authErr = ''; S.authMsg = '';
    if (!email) { S.authErr = 'メールアドレスを入力してください'; render(); return; }
    if (S.authMode !== 'reset' && !pass) { S.authErr = 'パスワードを入力してください'; render(); return; }
    if (S.authMode === 'signup' && pass.length < 8) { S.authErr = 'パスワードは8文字以上にしてください'; render(); return; }
    S.authBusy = true; render();
    try {
      if (S.authMode === 'login') {
        const {error} = await sb.auth.signInWithPassword({email, password: pass});
        if (error) S.authErr = authErrorText(error);
      } else if (S.authMode === 'signup') {
        const name = ($('#au-name') && $('#au-name').value || '').trim();
        const {data, error} = await sb.auth.signUp({email, password: pass, options: {data: {display_name: name}, emailRedirectTo: appUrl()}});
        if (error) S.authErr = authErrorText(error);
        else if (!data.session) { S.authMode = 'login'; S.authMsg = email + ' に確認メールを送りました。メールのリンクを開いてから、ここでログインしてください。'; }
      } else {
        const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: appUrl()});
        if (error) S.authErr = authErrorText(error);
        else S.authMsg = '再設定用のメールを送りました。メールのリンクから新しいパスワードを決めてください。';
      }
    } catch (e) { S.authErr = authErrorText(e); }
    S.authBusy = false; render();
  },
  logout: () => openConfirm('ログアウト', 'この端末からログアウトします。データはサーバーに残っているので、もう一度ログインすれば使えます。', [
    {label: 'ログアウトする', cls: 'danger', fn: async () => { try { await sb.auth.signOut(); } catch (e) {} endSession(); }},
    {label: 'やめる', cls: 'ghost'}]),
  npSave: async () => {
    const sh = topSheet(); const v = ($('#np-pass') || {}).value || '';
    if (v.length < 8) { sh.err = 'パスワードは8文字以上にしてください'; refreshSheet(sh); return; }
    const {error} = await sb.auth.updateUser({password: v});
    if (error) { sh.err = authErrorText(error); refreshSheet(sh); return; }
    closeSheet(sh.sid); toast('パスワードを変更しました');
  },

  calNav: el => {
    const n = +el.dataset.n;
    if (S.cal.view === 'month') {
      const d = pd(S.cal.sel), nd = new Date(d.getFullYear(), d.getMonth() + n, 1), t = pd(todayS());
      S.cal.sel = (t.getFullYear() === nd.getFullYear() && t.getMonth() === nd.getMonth()) ? todayS() : ds(nd);
    } else S.cal.sel = addD(S.cal.sel, 7 * n);
    S.adder = null; render();
  },
  calView: el => { S.cal.view = el.dataset.v; lsSet('calView', S.cal.view); S.adder = null; render(); },
  calToday: () => { S.cal.sel = todayS(); S.adder = null; render(); },
  pickDate: el => { const s = el.dataset.date; if (S.cal.sel === s) { scrollDayIntoView(); return; } S.cal.sel = s; S.adder = null; render(); },
  dayStep: el => { S.cal.sel = addD(S.cal.sel, +el.dataset.n); S.adder = null; render(); },
  openDay: el => { S.cal.sel = el.dataset.date; S.adder = null; openSheet('day', {date: el.dataset.date, tall: true}); render(); },
  daySheetStep: el => { const sh = topSheet(); if (!sh || sh.type !== 'day') return; sh.date = addD(sh.date, +el.dataset.n); S.cal.sel = sh.date; S.adder = null; render(); },
  openAdder: el => { S.adder = {ctx: el.dataset.ctx, date: el.dataset.date, slot: el.dataset.slot}; S.adderQ = ''; render(); focusAdder(); },
  closeAdder: () => { S.adder = null; S.adderQ = ''; render(); },
  addDishBtn: () => { if (S.adder) submitDish(document.getElementById('ad-' + S.adder.ctx + '-' + S.adder.slot)); },
  addDishEnter: el => submitDish(el),
  pickSug: el => {
    const r = S.recipes.get(el.dataset.rid);
    if (!r || !S.adder) return;
    addDish(S.adder.date, S.adder.slot, r.name, r.id);
    const inp = document.getElementById('ad-' + S.adder.ctx + '-' + S.adder.slot);
    if (inp) inp.value = '';
    S.adderQ = ''; render(); focusAdder();
  },
  openDish: el => openSheet('dish', {id: el.dataset.id, mode: ''}),
  dishMode: el => {
    const sh = topSheet(); sh.mode = el.dataset.m || ''; sh.q = '';
    refreshSheet(sh);
    const f = document.getElementById(sh.mode === 'rename' ? 'dish-rn' : 'dish-lk');
    if (f) { f.focus(); if (sh.mode === 'rename') f.select(); }
  },
  dishRenameSave: () => {
    const sh = topSheet(); const di = S.meals.get(sh.id); if (!di) return;
    const n = document.getElementById('dish-rn'); const v = n ? n.value.trim() : '';
    if (!v) { n && n.focus(); return; }
    const cur = di.recipe_id ? S.recipes.get(di.recipe_id) : null;
    let rid = di.recipe_id;
    if (!cur || norm(cur.name) !== norm(v)) { const m = idx().rIndex.get(norm(v)); rid = m ? m.id : null; }
    sh.mode = ''; updateRow('meal_items', di.id, {name: v, recipe_id: rid}); toast('名前を変更しました');
  },
  dishLinkPick: el => { const sh = topSheet(); const di = S.meals.get(sh.id); if (!di) return; sh.mode = ''; updateRow('meal_items', di.id, {recipe_id: el.dataset.rid}); toast('レシピと紐づけました'); },
  dishDelete: () => {
    const sh = topSheet(); const di = S.meals.get(sh.id); if (!di) return;
    const before = strip(di);
    closeSheet(sh.sid); deleteRows('meal_items', [di.id]);
    toast('「' + di.name + '」を削除しました', {undo: () => insertRow('meal_items', before)});
  },
  dishToRecipe: () => { const sh = topSheet(); const di = S.meals.get(sh.id); if (!di) return; openRecipeForm({mode: 'full', name: di.name, category: slotToCat(di.slot), linkTo: di.id}); },
  copyDay: el => {
    const from = el.dataset.date, to = addD(from, +el.dataset.n);
    const src = getDay(from);
    if (!dayHasMeals(src)) return;
    const doCopy = mode => {
      const dest = getDay(to);
      if (mode === 'replace') deleteRows('meal_items', dayDishes(dest).map(x => x.id));
      let pos = mode === 'replace' ? 0 : Math.max(0, ...dayDishes(dest).map(x => x.position || 0));
      insertRows('meal_items', dayDishes(src).map(x => ({id: uuid(), space_id: S.cur, date: to, slot: x.slot, name: x.name, recipe_id: x.recipe_id || null, position: ++pos})));
      toast(jp(to) + 'に献立をコピーしました');
    };
    if (dayHasMeals(getDay(to))) openConfirm('献立をコピー', jp(to) + 'にはすでに献立があります。どうしますか？', [
      {label: '上書きする', cls: 'primary', fn: () => doCopy('replace')},
      {label: '今ある献立に追加する', fn: () => doCopy('append')},
      {label: 'やめる', cls: 'ghost'}]);
    else doCopy('replace');
  },
  clearMeals: el => {
    const date = el.dataset.date;
    const before = dayDishes(getDay(date)).map(x => { const o = strip(x); delete o.slot; return Object.assign(o, {slot: x.slot}); });
    deleteRows('meal_items', before.map(x => x.id));
    toast(jp(date) + 'の献立を消去しました', {undo: () => insertRows('meal_items', before)});
  },
  cfm: el => { const sh = topSheet(); const b = sh && sh.btns[+el.dataset.i]; closeSheet(sh.sid); if (b && b.fn) b.fn(); },

  newEvent: el => {
    const kind = el.dataset.kind;
    const draft = {id: uuid(), kind, type: kind === 'shift' ? 'day' : 'out', title: '', start: '', end: '', memo: '', space: hasShared() ? 'shared' : 'personal', person: 'me'};
    const sh = openSheet('event', {static: true, isNew: true, date: el.dataset.date, draft});
    presetTimes(sh); refreshSheet(sh);
  },
  editEvent: el => {
    const e = S.events.get(el.dataset.id); if (!e) return;
    const draft = {id: e.id, kind: e.kind, type: e.type, title: e.title || '', start: e.start_time || '', end: e.end_time || '', memo: e.memo || '',
      space: e.space_id === S.sharedId ? 'shared' : 'personal', person: e.person_id === S.uid ? 'me' : e.person_id == null ? 'both' : 'partner', origSpace: e.space_id};
    openSheet('event', {static: true, isNew: false, date: e.date, draft, createdBy: e.created_by});
  },
  evKind: el => {
    const sh = topSheet(); readEventForm(sh);
    if (sh.draft.kind === el.dataset.k) return;
    sh.draft.kind = el.dataset.k; sh.draft.type = el.dataset.k === 'shift' ? 'day' : 'out';
    if (sh.draft.kind === 'shift' && sh.draft.person === 'both') sh.draft.person = 'me';
    sh.draft.start = ''; sh.draft.end = ''; presetTimes(sh); sh.err = '';
    refreshSheet(sh);
  },
  evType: el => {
    const sh = topSheet(); readEventForm(sh);
    const d = sh.draft;
    const old = (S.settings.shiftTimes || {})[shiftKey(d)];
    d.type = el.dataset.t;
    if (d.kind === 'shift') {
      const same = old && old.start === d.start && old.end === d.end;
      if (same || (!d.start && !d.end)) { d.start = ''; d.end = ''; presetTimes(sh); }
    }
    sh.err = ''; refreshSheet(sh);
  },
  evSpace: el => { const sh = topSheet(); readEventForm(sh); sh.draft.space = el.dataset.v; if (sh.draft.space === 'personal') sh.draft.person = 'me'; refreshSheet(sh); },
  evPerson: el => {
    const sh = topSheet(); readEventForm(sh);
    const d = sh.draft;
    const old = (S.settings.shiftTimes || {})[shiftKey(d)];
    d.person = el.dataset.v;
    if (d.kind === 'shift') { const same = old && old.start === d.start && old.end === d.end; if (same || (!d.start && !d.end)) { d.start = ''; d.end = ''; presetTimes(sh); } }
    refreshSheet(sh);
  },
  evSave: () => {
    const sh = topSheet(); readEventForm(sh);
    const e = sh.draft;
    if (e.kind === 'plan' && e.type === 'custom' && !e.title) { sh.err = '内容を入力してください'; refreshSheet(sh); const n = document.getElementById('ev-title'); n && n.focus(); return; }
    if (e.start && e.end && e.kind === 'plan' && e.end < e.start) { sh.err = '終了時刻は開始時刻より後にしてください'; refreshSheet(sh); return; }
    const spaceId = e.space === 'shared' && S.sharedId ? S.sharedId : S.personalId;
    const pid = partnerId();
    const person = spaceId === S.sharedId ? (e.person === 'partner' && pid ? pid : e.person === 'both' && e.kind === 'plan' ? null : S.uid) : S.uid;
    const row = {id: e.id, space_id: spaceId, date: sh.date, kind: e.kind, type: e.type, title: e.title, start_time: e.start, end_time: e.end, memo: e.memo, person_id: person};
    closeSheet(sh.sid);
    if (sh.isNew) insertRow('events', row);
    else if (e.origSpace && e.origSpace !== spaceId) {
      const nid = uuid();
      deleteRows('events', [e.id]).then(() => insertRow('events', Object.assign({}, row, {id: nid})));
    } else { const p = Object.assign({}, row); delete p.id; delete p.space_id; updateRow('events', e.id, p); }
    if (e.kind === 'shift' && (e.start || e.end)) {
      const st = Object.assign({}, S.settings.shiftTimes || {});
      const k = shiftKey(e), cur = st[k];
      if (!cur || cur.start !== e.start || cur.end !== e.end) { st[k] = {start: e.start, end: e.end}; saveSettings({shiftTimes: st}); }
    }
    toast(sh.isNew ? '追加しました' : '保存しました');
  },
  evDelete: () => {
    const sh = topSheet(); const e = S.events.get(sh.draft.id);
    closeSheet(sh.sid);
    if (!e) return;
    const before = strip(e);
    deleteRows('events', [e.id]);
    toast('予定を削除しました', {undo: () => insertRow('events', before)});
  },

  openSearch: () => { openSheet('search', {tall: true, q: ''}); const n = document.getElementById('srch'); if (n) n.focus({preventScroll: true}); },
  jumpDate: el => { S.cal.sel = el.dataset.date; S.cal.view = 'month'; lsSet('calView', 'month'); S.tab = 'cal'; lsSet('tab', 'cal'); S.adder = null; closeAllSheets(); render(); setTimeout(() => { const d = document.getElementById('day-in'); if (d) d.scrollIntoView({block: 'start'}); }, 60); },

  rqFilter: el => { S.rq.filter = el.dataset.v; render(); },
  rqCat: el => { S.rq.cat = el.dataset.v; render(); },
  openRecipe: el => { const id = el.dataset.id; if (!S.recipes.has(id)) return; openSheet('recipe', {id, tall: true}); loadPhoto(id); },
  toggleFav: el => { const r = S.recipes.get(el.dataset.id); if (!r) return; const f = !r.favorite; updateRow('recipes', r.id, {favorite: f}); toast(f ? 'お気に入りに追加しました' : 'お気に入りから外しました'); },
  markMade: el => markMade(el.dataset.id, el.dataset.date),
  planRecipe: el => { const r = S.recipes.get(el.dataset.id); if (!r) return; openSheet('plan', {static: true, id: r.id, date: S.cal.sel || todayS(), slot: catToSlot(r.category)}); },
  planSave: () => {
    const sh = topSheet(); const r = S.recipes.get(sh.id); if (!r) return;
    const date = $('#pl-date').value, slot = $('#pl-slot').value;
    if (!validDate(date)) return;
    insertRow('meal_items', {id: uuid(), space_id: r.space_id, date, slot, name: r.name, recipe_id: r.id, position: nextPos(date, slot)});
    closeSheet(sh.sid);
    toast(jp(date) + 'の' + SLOTS.find(s => s.k === slot).label + 'に追加しました');
  },
  newRecipe: () => openSheet('addMenu'),
  newRecipeFull: () => { const sh = topSheet(); if (sh && sh.type === 'addMenu') closeSheet(sh.sid); openRecipeForm({mode: 'full'}); },
  newRecipeQuick: () => { const sh = topSheet(); if (sh && sh.type === 'addMenu') closeSheet(sh.sid); openRecipeForm({mode: 'quick', category: 'その他'}); },
  editRecipe: el => openRecipeForm({id: el.dataset.id, mode: 'full'}),
  deleteRecipe: el => {
    const r = S.recipes.get(el.dataset.id); if (!r) return;
    openConfirm('レシピを削除', '「' + r.name + '」を削除します。元には戻せません。献立に入れた料理名は残ります。' + (hasShared() && r.space_id === S.sharedId ? '\n相手の画面からも消えます。' : ''), [
      {label: '削除する', cls: 'danger', fn: () => {
        S.sheets.filter(s => s.type === 'recipe' && s.id === r.id).forEach(s => closeSheet(s.sid));
        S.meals.forEach((m, id) => { if (m.recipe_id === r.id) S.meals.set(id, Object.assign({}, m, {recipe_id: null})); });
        S.photoCache.delete(r.id);
        deleteRows('recipes', [r.id]); toast('レシピを削除しました');
      }},
      {label: 'やめる', cls: 'ghost'}]);
  },
  rfCat: el => { const sh = topSheet(); collectRF(sh); sh.draft.category = el.dataset.c; refreshSheet(sh); },
  rfToggle: el => { const sh = topSheet(); collectRF(sh); const f = el.dataset.f; sh.draft[f] = !sh.draft[f]; refreshSheet(sh); },
  rfAddIng: () => { const sh = topSheet(); collectRF(sh); const g = {id: gid('g'), name: '', qty: '', unit: ''}; sh.draft.ingredients.push(g); refreshSheet(sh); const n = document.getElementById('rf-in-' + g.id); if (n) n.focus(); },
  rfDelIng: el => { const sh = topSheet(); collectRF(sh); sh.draft.ingredients = sh.draft.ingredients.filter(g => g.id !== el.dataset.k); refreshSheet(sh); },
  rfPhotoDel: () => { const sh = topSheet(); collectRF(sh); sh.draft.thumb = ''; sh.photoFull = null; sh.photoChanged = true; refreshSheet(sh); },
  rfFull: () => { const sh = topSheet(); collectRF(sh); sh.mode = 'full'; while (sh.draft.ingredients.length < 3) sh.draft.ingredients.push({id: gid('g'), name: '', qty: '', unit: ''}); refreshSheet(sh); },
  rfSave: async () => {
    const sh = topSheet(); collectRF(sh);
    if (sh.saving) return;
    const d = sh.draft;
    const name = (d.name || '').trim();
    const url = safeUrl(d.url);
    const bad = msg => { sh.err = msg; refreshSheet(sh); };
    if (!name) { bad('料理名を入力してください'); const n = document.getElementById('rf-name'); n && n.focus(); return; }
    if (sh.mode === 'quick' && !url) return bad((d.url || '').trim() ? 'URLの形が正しくないようです（https:// から始まるURLを貼り付けてください）' : 'URLを入力してください');
    if ((d.url || '').trim() && !url) return bad('URLの形が正しくないようです（https:// から始まるURLを貼り付けてください）');
    if (sh.photoBusy) return bad('写真の準備が終わるまでお待ちください');
    const serv = parseInt(String(d.servings || '').normalize('NFKC'), 10);
    const made = !!d.made || (d.made_dates || []).length > 0;
    const rec = {
      id: sh.id, space_id: sh.space, name: name.slice(0, 200), category: RCATS.includes(d.category) ? d.category : 'その他',
      ingredients: d.ingredients.filter(g => (g.name || '').trim()).map(g => ({id: g.id, name: g.name.trim(), qty: String(g.qty || '').trim(), unit: String(g.unit || '').trim()})),
      servings: serv > 0 && serv < 100 ? serv : null, steps: (d.steps || '').trim(), url, memo: (d.memo || '').trim(),
      favorite: !!d.favorite, made: !!d.made, made_dates: d.made ? (d.made_dates || []) : [],
      thumb: d.thumb || '', has_photo: sh.photoChanged ? !!sh.photoFull : !!(d.has_photo && d.thumb)
    };
    if (!d.made && made) rec.made_dates = [];
    sh.saving = true; refreshSheet(sh);
    let ok;
    if (sh.isNew) ok = await insertRow('recipes', rec);
    else { const p = Object.assign({}, rec); delete p.id; delete p.space_id; ok = await updateRow('recipes', sh.id, p); }
    sh.saving = false;
    if (!ok) { if (S.sheets.includes(sh)) refreshSheet(sh); return; }
    if (sh.photoChanged) savePhoto(rec.id, rec.space_id, sh.photoFull);
    if (sh.linkTo && S.meals.has(sh.linkTo)) updateRow('meal_items', sh.linkTo, {recipe_id: rec.id});
    closeSheet(sh.sid);
    toast(sh.isNew ? 'レシピを保存しました' : '変更を保存しました');
  },

  shopAdd: () => {
    const name = ($('#s-name').value || '').trim();
    if (!name) { $('#s-name').focus(); return; }
    const o = {name, qty: $('#s-qty').value.trim(), unit: $('#s-unit').value.trim(), category: $('#s-cat').value};
    const ex = curShop().find(i => !i.checked && normIng(i.name) === normIng(name));
    if (ex) { S.shopDup = Object.assign({exId: ex.id}, o); render(); return; }
    addShopItem(o);
  },
  shopDupMerge: () => {
    const d = S.shopDup; const ex = d && S.shop.get(d.exId);
    if (!ex) { S.shopDup = null; render(); return; }
    updateRow('shopping_items', ex.id, {qty: fmtNum(parseQty(ex.qty) + parseQty(d.qty))});
    S.shopDup = null; clearShopForm(); toast('「' + ex.name + '」の数量をまとめました');
  },
  shopDupAdd: () => { const d = S.shopDup; if (!d) return; S.shopDup = null; addShopItem(d); },
  shopDupCancel: () => { S.shopDup = null; render(); },
  toggleItem: el => {
    const it = S.shop.get(el.dataset.id); if (!it) return;
    const c = !it.checked;
    S.shop.set(it.id, Object.assign({}, it, {checked_by: c ? S.uid : null, checked_at: c ? nowISO() : null}));
    updateRow('shopping_items', it.id, {checked: c});
  },
  editItem: el => { const it = S.shop.get(el.dataset.id); if (!it) return; openSheet('item', {static: true, id: it.id, draft: clone(it)}); },
  itemSave: () => {
    const sh = topSheet(); const it = S.shop.get(sh.id);
    if (!it) { closeSheet(sh.sid); return; }
    const name = $('#it-name').value.trim();
    if (!name) { sh.err = '商品名を入力してください'; refreshSheet(sh); return; }
    updateRow('shopping_items', it.id, {name, qty: $('#it-qty').value.trim(), unit: normUnit($('#it-unit').value), category: $('#it-cat').value});
    closeSheet(sh.sid); toast('保存しました');
  },
  itemDelete: () => {
    const sh = topSheet(); const it = S.shop.get(sh.id);
    closeSheet(sh.sid);
    if (!it) return;
    const before = strip(it);
    deleteRows('shopping_items', [it.id]);
    toast('「' + it.name + '」を削除しました', {undo: () => insertRow('shopping_items', before)});
  },
  clearChecked: () => {
    const done = curShop().filter(i => i.checked);
    if (!done.length) return;
    openConfirm('購入済みを削除', '購入済みの' + done.length + '件をリストから削除します。', [
      {label: done.length + '件を削除する', cls: 'danger', fn: () => { const before = done.map(strip); deleteRows('shopping_items', done.map(i => i.id)); toast(done.length + '件を削除しました', {undo: () => insertRows('shopping_items', before)}); }},
      {label: 'やめる', cls: 'ghost'}]);
  },
  openGen: el => {
    let from = todayS(), to = addD(from, 6);
    if (el.dataset.from === 'cal') { from = S.cal.view === 'week' ? weekStartOf(S.cal.sel) : S.cal.sel; to = addD(from, 6); }
    openSheet('gen', {static: true, tall: true, step: 1, from, to});
  },
  genPreset: el => { const sh = topSheet(); sh.from = el.dataset.a; sh.to = el.dataset.b; $('#g-from').value = sh.from; $('#g-to').value = sh.to; $('#g-sum').innerHTML = genSummaryHTML(sh.from, sh.to); },
  genCollect: () => {
    const sh = topSheet();
    sh.from = $('#g-from').value; sh.to = $('#g-to').value;
    if (!validDate(sh.from) || !validDate(sh.to) || sh.from > sh.to || rangeDays(sh.from, sh.to) > 62) { $('#g-sum').innerHTML = genSummaryHTML(sh.from, sh.to); return; }
    const res = collectRange(sh.from, sh.to);
    sh.rows = res.rows; sh.missing = res.missing; sh.step = 2;
    const w = document.querySelector('#sheets [data-sid="' + sh.sid + '"] .sheet-inner');
    if (w) w.innerHTML = SHEETS.gen(sh);
  },
  genBack: () => { const sh = topSheet(); sh.step = 1; const w = document.querySelector('#sheets [data-sid="' + sh.sid + '"] .sheet-inner'); if (w) w.innerHTML = SHEETS.gen(sh); },
  genAdd: () => {
    const sh = topSheet();
    let merged = 0;
    const adds = [];
    sh.rows.forEach((r, i) => {
      const inc = document.getElementById('g-inc-' + i);
      if (!inc || !inc.checked) return;
      const name = document.getElementById('g-name-' + i).value.trim();
      if (!name) return;
      const qty = document.getElementById('g-qty-' + i).value.trim();
      const unit = normUnit(document.getElementById('g-unit-' + i).value);
      const category = document.getElementById('g-cat-' + i).value;
      const dupSel = document.getElementById('g-dup-' + i);
      const act = dupSel ? dupSel.value : 'add';
      if (r.dup && act === 'skip') return;
      if (r.dup && act === 'merge') {
        const ex = S.shop.get(r.dup.id);
        if (ex) {
          const a = parseQty(ex.qty), b = parseQty(qty), sameUnit = normUnit(ex.unit) === unit;
          let p;
          if (sameUnit && a != null && b != null) p = {qty: fmtNum(a + b)};
          else if (qty) p = {qty: [ex.qty ? ex.qty + (ex.unit && !sameUnit ? ex.unit : '') : '', qty + (!sameUnit ? unit : '')].filter(Boolean).join('＋').slice(0, 40), unit: sameUnit ? ex.unit : ''};
          if (p) updateRow('shopping_items', ex.id, p);
          merged++; return;
        }
      }
      adds.push({id: uuid(), space_id: S.cur, name, qty: qty.slice(0, 40), unit: unit.slice(0, 20), category: SCATS.includes(category) ? category : guessCat(name), checked: false, source: {type: 'meals', from: sh.from, to: sh.to}});
    });
    insertRows('shopping_items', adds);
    closeSheet(sh.sid);
    if (S.tab !== 'shop') switchTab('shop'); else render();
    const added = adds.length;
    toast(added + merged ? (added ? added + '件を追加' : '') + (added && merged ? '、' : '') + (merged ? merged + '件を合算' : '') + 'しました' : '追加するものはありませんでした');
  },

  openSpacePick: () => openSheet('spacePick'),
  pickSpace: el => { const id = el.dataset.v === 'shared' ? S.sharedId : S.personalId; closeAllSheets(); if (id && id !== S.cur) { saveSettings({curSpace: id}); toast((el.dataset.v === 'shared' ? 'ふたり' : 'じぶん') + 'のスペースに切り替えました'); } },
  setCur: el => { const id = el.dataset.v === 'shared' ? S.sharedId : S.personalId; if (id && id !== S.cur) saveSettings({curSpace: id}); },
  goShare: () => { switchTab('prefs'); },
  hideInvite: () => { S.hideInviteCard = true; lsSet('hideInvite', '1'); render(); },
  createShared: async el => {
    el.disabled = true;
    const {error} = await sb.rpc('create_shared_space', {p_name: 'ふたりの献立帖'});
    el.disabled = false;
    if (error) { toast(rpcErrText(error), {err: true}); return; }
    await afterJoinOrCreate();
    toast('ふたりのスペースを作りました');
    const sh = openSheet('invite', {static: true}); startInvite(sh);
  },
  openInvite: () => { if (!S.sharedId) { switchTab('prefs'); return; } const sh = openSheet('invite', {static: true}); startInvite(sh); },
  openInviteRetry: () => { const sh = topSheet(); startInvite(sh); },
  shareInvite: async () => {
    const sh = topSheet(); if (!sh || !sh.code) return;
    const link = appUrl() + '#join=' + sh.code;
    const text = 'くらしの献立帖に招待します。\nリンクを開いて「はじめて使う」から登録してください。\n招待コード：' + sh.code.slice(0, 5) + '-' + sh.code.slice(5) + '（3日間有効）';
    try { if (navigator.share) { await navigator.share({title: 'くらしの献立帖', text, url: link}); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    if (await copyText(text + '\n' + link)) toast('招待メッセージをコピーしました'); else toast('コピーできませんでした。コードを長押ししてコピーしてください', {err: true});
  },
  copyInvite: async () => {
    const sh = topSheet(); if (!sh || !sh.code) return;
    if (await copyText(sh.code.slice(0, 5) + '-' + sh.code.slice(5) + '\n' + appUrl() + '#join=' + sh.code)) toast('コードとリンクをコピーしました');
    else toast('コピーできませんでした。コードを長押ししてコピーしてください', {err: true});
  },
  openJoin: () => openSheet('join', {static: true, code: ''}),
  joinSubmit: async () => {
    const sh = topSheet(); if (!sh || sh.busy) return;
    const code = ($('#join-code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 10) { sh.err = '10文字のコードを入力してください'; refreshSheet(sh); return; }
    sh.busy = true; sh.err = ''; refreshSheet(sh);
    const {error} = await sb.rpc('accept_invite', {p_code: code});
    sh.busy = false;
    if (error) { sh.err = rpcErrText(error); refreshSheet(sh); return; }
    lsSet('pendingJoin', null);
    closeSheet(sh.sid);
    await afterJoinOrCreate();
    const pid = partnerId();
    if (pid && colorOf(pid) === colorOf(S.uid)) { const alt = COLORS.map(c => c[0]).find(c => c !== colorOf(pid)); updateRow('profiles', S.uid, {color: alt}); }
    toast('ふたりのスペースに参加しました 🎉');
  },
  leaveSpace: () => openConfirm('ふたりのスペースから抜ける', '抜けると、ふたりの予定・献立・買い物リスト・レシピが見られなくなります。データはスペースに残り、相手はそのまま使えます。', [
    {label: '抜ける', cls: 'danger', fn: async () => { const {error} = await sb.rpc('leave_space', {p_space: S.sharedId}); if (error) { toast(rpcErrText(error), {err: true}); return; } saveSettings({curSpace: S.personalId}); await refreshAll(); toast('ふたりのスペースから抜けました'); }},
    {label: 'やめる', cls: 'ghost'}]),
  removeMember: el => {
    const uid = el.dataset.uid;
    openConfirm('メンバーを外す', nameOf(uid) + 'をふたりのスペースから外します。外された人は、ふたりのデータが見られなくなります。', [
      {label: '外す', cls: 'danger', fn: async () => { const {error} = await sb.rpc('remove_member', {p_space: S.sharedId, p_user: uid}); if (error) { toast(rpcErrText(error), {err: true}); return; } await refreshAll(); toast('外しました'); }},
      {label: 'やめる', cls: 'ghost'}]);
  },
  renameSpace: () => { const sp = S.spaces.get(S.sharedId); if (sp) openSheet('spaceName', {static: true, name: sp.name}); },
  spaceNameSave: async () => {
    const sh = topSheet(); const v = ($('#sp-name').value || '').trim().slice(0, 40);
    if (!v) return;
    const sp = S.spaces.get(S.sharedId);
    if (sp) S.spaces.set(sp.id, Object.assign({}, sp, {name: v}));
    closeSheet(sh.sid); render();
    const {error} = await sb.from('spaces').update({name: v}).eq('id', S.sharedId);
    if (error) onWriteError(error); else toast('名前を変更しました');
  },
  copyRecipesShared: () => openConfirm('レシピをコピー', 'じぶんのスペースのレシピを、ふたりのスペースにコピーします。同じ名前のレシピがすでにある場合はコピーしません。元のレシピはそのまま残ります。', [
    {label: 'コピーする', cls: 'primary', fn: copyRecipesToShared}, {label: 'やめる', cls: 'ghost'}]),
  editProfile: () => { const p = profileOf(S.uid); openSheet('profile', {static: true, name: p.display_name || '', color: colorOf(S.uid)}); },
  pfColor: el => { const sh = topSheet(); sh.name = ($('#pf-name') || {}).value || sh.name; sh.color = el.dataset.c; refreshSheet(sh); },
  pfSave: () => {
    const sh = topSheet(); const name = (($('#pf-name') || {}).value || '').trim().slice(0, 40);
    if (!name) { sh.err = '名前を入力してください'; refreshSheet(sh); return; }
    if (!S.profiles.has(S.uid)) S.profiles.set(S.uid, {id: S.uid, display_name: name, color: sh.color});
    updateRow('profiles', S.uid, {display_name: name, color: sh.color});
    closeSheet(sh.sid); toast('保存しました');
  },
  setWS: el => saveSettings({weekStart: +el.dataset.v}),
  setMM: el => saveSettings({monthMeals: el.dataset.v}),
  exportData: () => exportData()
};
function addShopItem(o){
  insertRow('shopping_items', {id: uuid(), space_id: S.cur, name: o.name.slice(0, 200), qty: (o.qty || '').slice(0, 40), unit: normUnit(o.unit).slice(0, 20), category: SCATS.includes(o.category) ? o.category : guessCat(o.name), checked: false});
  clearShopForm();
  toast('「' + o.name + '」を追加しました');
}
function clearShopForm(){
  ['#s-name', '#s-qty', '#s-unit'].forEach(s => { const n = $(s); if (n) n.value = ''; });
  const c = $('#s-cat'); if (c) c.value = SCATS[0];
  S.shopCatTouched = false;
  render();
  const n = $('#s-name'); if (n) { try { n.focus({preventScroll: true}); } catch (e) {} }
}

/* input handlers */
const I = {
  dishQ: el => { S.adderQ = el.value; if (!S.adder) return; const box = document.getElementById('sg-' + S.adder.ctx); if (box) box.innerHTML = sugHTML(S.adder.slot, S.adderQ); },
  rq: el => { S.rq.text = el.value; render(); },
  srch: el => { const sh = topSheet(); if (sh) sh.q = el.value; const box = $('#srch-res'); if (box) box.innerHTML = searchResHTML(el.value); },
  linkQ: el => { const sh = topSheet(); if (sh) sh.q = el.value; const box = $('#lk-res'); if (box) box.innerHTML = linkSugHTML(el.value); },
  shopName: el => { if (!S.shopCatTouched) { const c = $('#s-cat'); if (c) c.value = guessCat(el.value); } }
};
const C = {
  shopCat: () => { S.shopCatTouched = true; },
  genRange: () => { const sh = topSheet(); if (!sh) return; sh.from = $('#g-from').value; sh.to = $('#g-to').value; $('#g-sum').innerHTML = genSummaryHTML(sh.from, sh.to); },
  genInc: el => { const sh = topSheet(); const i = +el.dataset.i; if (sh && sh.rows[i]) sh.rows[i].off = !el.checked; const row = document.getElementById('g-row-' + i); if (row) row.classList.toggle('off', !el.checked); },
  rfPhoto: async el => {
    const f = el.files && el.files[0];
    if (!f) return;
    const sh = topSheet(); collectRF(sh);
    sh.photoBusy = true; refreshSheet(sh);
    try { const p = await processPhoto(f); sh.draft.thumb = p.thumb; sh.photoFull = p.full; sh.photoChanged = true; }
    catch (e) { toast('写真を読み込めませんでした。別の写真を選んでください', {err: true}); }
    sh.photoBusy = false;
    el.value = '';
    if (S.sheets.includes(sh)) { collectRF(sh); refreshSheet(sh); }
  },
  importFile: async el => {
    const f = el.files && el.files[0];
    el.value = '';
    if (!f) return;
    let json;
    try { json = JSON.parse(await f.text()); } catch (e) { toast('JSONファイルを読み込めませんでした', {err: true}); return; }
    if (!json || (!json.recipes && !json.days && !json.meals)) { toast('くらしの献立帖のバックアップではないようです', {err: true}); return; }
    const pkg = buildImport(json);
    openConfirm('バックアップを読み込む', '「' + spaceLabel(pkg.target) + '」のスペースに次の内容を追加します。\nレシピ ' + pkg.recipes.length + '件（写真 ' + pkg.photos.length + '枚）\n献立 ' + pkg.meals.length + '品\n予定 ' + pkg.events.length + '件\n買い物 ' + pkg.shop.length + '件\n今あるデータは消えません。', [
      {label: '読み込む', cls: 'primary', fn: () => runImport(pkg)}, {label: 'やめる', cls: 'ghost'}]);
  }
};

/* ---------- event wiring ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const fn = A[t.dataset.act];
  if (fn) fn(t, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheets.length) { A.closeTop(); return; }
  const t = e.target;
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && t.dataset && t.dataset.enter) { e.preventDefault(); const fn = A[t.dataset.enter]; if (fn) fn(t, e); return; }
  if ((e.key === 'Enter' || e.key === ' ') && t.getAttribute && t.getAttribute('role') === 'button' && t.dataset.act) { e.preventDefault(); t.click(); }
});
document.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.in && I[t.dataset.in]) I[t.dataset.in](t, e); });
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.ch && C[t.dataset.ch]) C[t.dataset.ch](t, e); });
let tx = null;
document.addEventListener('touchstart', e => {
  if (S.sheets.length || S.tab !== 'cal' || !e.target.closest('.swipe')) { tx = null; return; }
  const p = e.touches[0]; tx = {x: p.clientX, y: p.clientY, t: Date.now()};
}, {passive: true});
document.addEventListener('touchend', e => {
  if (!tx) return;
  const p = e.changedTouches[0], dx = p.clientX - tx.x, dy = p.clientY - tx.y;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 45 && Date.now() - tx.t < 700) A.calNav({dataset: {n: dx < 0 ? 1 : -1}});
  tx = null;
}, {passive: true});
let lastDay = todayS();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (todayS() !== lastDay) { lastDay = todayS(); render(); }
  if (S.status === 'ready' && (!S.lastFetch || Date.now() - S.lastFetch > 20000)) refreshAll();
});
window.addEventListener('online', () => { if (S.status === 'ready') refreshAll(); });
window.addEventListener('offline', () => { S.offline = true; scheduleRender(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

window.__kk = {S, refreshAll};
boot();
})();
