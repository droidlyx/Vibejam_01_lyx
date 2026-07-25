/* ============================================================
   引擎
   ------------------------------------------------------------
   代码在这一局里只做三件事：
     1. 把它开局写下的 intent 和标准答案封存起来（它事后改不了口）
     2. 记账：他说过的每一句，和当时全场的裁决
     3. 结算时把封存的原文亮出来对照
   它想什么、做什么、说什么谎，代码一概不管。
   ============================================================ */

var G = window.G = {
  gen: null,        // 开局产物
  sealed: null,     // 封存的 intent —— 只在结算时才读
  hook: [],         // 汤面：一段说不通的故事。他全部的地基，而且不会变。
  scene: { elements: [] },
  cast: [],         // 证人席。会长——他点名问出来的新证人也进这儿。
  silenced: [],     // 被它封了口的，从此不再回答
  board: [],        // 他说过的每一句 + 当时全场的裁决
  qi: 0,
  riddles: [],      // 要答的题。**全部答对才算过**，不分主次。
  answers: {},      // 他填过的答案，留着，下次摊牌接着改
  attempts: 0,
  coolUntil: 0,     // 摊牌没过之后它收回注意力的截止时刻
  note: '',
  history: [],
  trust: 0,
  granted: false,
  stirs: 0,
  stirLog: [],      // 它自己动过什么，喂回给它——不然它会封第三次同一张嘴
  questioned: {},   // id -> 他点名问过它几次。它自己动的时候从这里面抽人。
  askedCount: 0,    // 攒够几次点名，它就出手一次。按提问算，不按时间。
  filter: null,     // 本子上只看某一个证人
  busy: false,
  stirring: false,  // 它自己动那条线是异步的，跟他的输入互不阻塞
  ended: false,
  censored: 0,
};

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m]));

/* 它偶尔会把英文 id 直接写进叙述里。提示词里嘱咐过，但嘱咐不如换掉。 */
function deId(text){
  let s = String(text || '');
  for (const h of G.cast){
    if (!h.id || h.id.length < 3) continue;
    s = s.split(h.id).join(h.name);
  }
  return s;
}

/* ================= 叙述流 ================= */

function say(text, cls = '', src = ''){
  const e = document.createElement('div');
  e.className = 'entry ' + cls;
  if (src) e.innerHTML = `<div class="src">${escapeHtml(src)}</div>`;
  const p = document.createElement('p');
  e.appendChild(p);
  $('#feed').appendChild(e);
  typeInto(p, String(text));
  $('#feed').scrollTop = 1e9;
}

function typeInto(el, text){
  const tokens = text.match(/<span class="cen">[\s\S]*?<\/span>|[\s\S]/g) || [];
  let i = 0;
  (function step(){
    if (i >= tokens.length) return;
    el.innerHTML += tokens[i++];
    $('#feed').scrollTop = 1e9;
    setTimeout(step, tokens[i - 1].length > 1 ? 80 : 11);
  })();
}

function busy(on, label){
  G.busy = on;
  $('#cmd').disabled = on || G.ended || !LLM.online();
  const t = $('#thinking');
  t.classList.toggle('hidden', !on);
  if (on) t.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span> ' + (label || '');
  if (!on && !G.ended) $('#cmd').focus();
}

function flick(){
  $('#crt').classList.add('flicker');
  setTimeout(() => $('#crt').classList.remove('flicker'), 700);
}

/* ================= 汤面 =================
   海龟汤靠一个说不通的故事开局——「男人喝了一口海龟汤，回家就上吊了」。
   没有它，玩家坐在那儿不知道该问什么。
   这一段每一句都是真的，而且整局不变：他唯一的地基。

   不在侧栏常驻挂着——开局它自己讲一遍就够了，要回头看就翻本子。
   常驻一块面板反而把画面挤没了，而且那段话读一遍就记住了。 */

/* ================= 场景 =================
   这幅画是汤面那一刻的插图，不是他现在待的房间。不可点——
   要查的东西在证人席上，不在家具里。 */

function drawScene(){
  Render.draw($('#scene'), G.scene);
}

/* ================= 本子 =================
   按问题分组，不按证人分组：这个游戏的证据单位是**同一句话上的分歧**，
   一屏就该是一次完整的实验结果。想看单个证人前后矛不矛盾，用上面的筛选。 */

function openSheet(){ renderSheet(); $('#sheetModal').classList.remove('hidden'); }
function closeSheet(){ $('#sheetModal').classList.add('hidden'); }

function renderSheet(){
  $('#sheetHook').innerHTML = G.hook.length
    ? `<div class="rl">汤面　<span class="dim">它讲的，每一句都是真的</span></div>
       <div class="hkb">${escapeHtml(G.hook.join(''))}</div>` : '';

  /* 证人条：点一个只看它的回答，再点一次取消 */
  $('#sheetCast').innerHTML =
    `<span class="cchip${G.filter ? '' : ' on'}" data-id="">全部</span>` +
    G.cast.map(h => {
      const dead = G.silenced.includes(h.id);
      return `<span class="cchip${G.filter === h.id ? ' on' : ''}${dead ? ' dead' : ''}" data-id="${escapeHtml(h.id)}"
        title="${escapeHtml(h.stake || '')}">${dead ? '✕' : ''}${escapeHtml(h.name)}</span>`;
    }).join('');
  $('#sheetCast').querySelectorAll('.cchip').forEach(el => {
    el.onclick = () => { G.filter = el.dataset.id || null; renderSheet(); };
  });

  /* 选中某个证人时，先把它是什么摆出来 */
  const f = G.filter && G.cast.find(h => h.id === G.filter);
  $('#sheetWho').innerHTML = f
    ? `<div class="who"><b>${escapeHtml(f.name)}</b><span class="wt">${escapeHtml(f.what || '')}</span>
        <span class="ws">${escapeHtml(f.stake || '')}</span>
        ${G.silenced.includes(f.id) ? '<span class="wd">它已经不说话了</span>' : ''}
       </div><div class="wl">${escapeHtml(f.look || '')}</div>` : '';

  if (!G.board.length){
    $('#sheetBoard').innerHTML = '<div class="bempty">你问过的每一句，和当时每一个人的回答，都会记在这里。</div>';
    return;
  }

  const who = G.filter ? G.cast.filter(h => h.id === G.filter) : G.cast;
  $('#sheetBoard').innerHTML = G.board.map((row, i) => {
    const lines = who.map(h => {
      const v = row.verdicts[h.id];
      if (!v) return '';
      const key = Object.keys(VERDICTS).find(k => VERDICTS[k].key === v);
      const d = VERDICTS[key] || VERDICTS.na;
      const said = row.lines && row.lines[h.id];
      return `<div class="ansrow"><span class="an">${escapeHtml(h.name)}</span>` +
             `<span class="av ${d.cls}">${d.key}</span>` +
             (said ? `<span class="al">${escapeHtml(said)}</span>` : '') + `</div>`;
    }).join('');
    const itV = row.verdicts['__it__'];
    const itD = VERDICTS[Object.keys(VERDICTS).find(k => VERDICTS[k].key === itV)] || VERDICTS.na;
    return `<div class="qblock"><div class="qh"><b>${i + 1}</b>${escapeHtml(row.claim)}</div>` +
           lines +
           (G.filter ? '' : `<div class="ansrow it"><span class="an">它</span><span class="av ${itD.cls}">${itD.key}</span></div>`) +
           `</div>`;
  }).join('');
}

/* 顶栏按钮上的计数：他问了几句、还剩几个人肯说话 */
function refreshSheetBtn(){
  $('#btnSheet').textContent = G.board.length
    ? `本子　${G.board.length} 句 / ${G.cast.length - G.silenced.length} 人`
    : '本子';
}

/* ================= 说出一句话 =================
   他唯一能做的事。爱怎么说怎么说——问句、说法、点名问谁都行，
   模型把它归成一句能判真假的命题，全场各自裁决。 */

async function sayClaim(){
  const box = $('#cmd');
  const said = box.value.trim();
  if (!said || G.busy || G.ended || !G.gen) return;

  box.value = '';
  say(said, 'claim', `第 ${G.qi + 1} 句`);
  busy(true, '……');

  let r;
  try{
    r = await LLM.ask(G.gen, {
      scene: G.scene.elements, note: G.note,
      cast: G.cast, hook: G.hook, silenced: G.silenced,
      lastRun: lastRunMemory(), board: boardForPrompt(),
      qi: G.qi + 1, trust: G.trust, granted: G.granted,
    }, said);
  }catch(err){
    say('（没有回应：' + err.message + '）', 'sys');
    busy(false); return;
  }
  busy(false);

  if (r.valid === false){
    say('这句话没法回答。里面得有一件能判真假的事——问句、说法都行。\n比如「他是自杀的吗」「那扇门是从里面锁上的」「问账房，那天谁签的字」。', 'sys');
    return;
  }

  /* 他点名问了席上没有的——它来决定那东西存不存在。
     已经封过口的不许借新名字复活：模型认人（「那个大夫」＝「医生」），
     代码兜底（凡是已封的 id，一律不许再进证人席）。 */
  await admitNewcomers(r.newcomers);

  /* 他点了谁的名——它自己动的时候就从这些人里抽 */
  const hit = new Set();
  for (const a of [...(r.addressed || []), ...(r.blocked || [])]){
    const h = G.cast.find(c => c.id === a);
    if (h) hit.add(h.id);
  }
  for (const id of hit) G.questioned[id] = (G.questioned[id] || 0) + 1;
  G.askedCount += hit.size || 1;      // 没点名＝广播，算一次

  /* 换个叫法想撬开封过的口，当面驳回 */
  for (const id of (r.blocked || [])){
    const h = G.cast.find(c => c.id === id);
    if (h && G.silenced.includes(id)) say(`「${h.name}」还是不说话。`, 'sys deny');
  }

  const claim = String(r.claim || said).trim() || said;
  if (claim !== said) say(claim, 'norm', '记作');

  /* —— 记一行 —— */
  G.qi++;
  const verdicts = {}, lines = {};
  for (const v of (r.voices || [])){
    if (!v || !v.id) continue;
    verdicts[v.id] = v.verdict;
    if (v.line && v.line.trim()) lines[v.id] = deId(v.line.trim());
  }
  for (const id of G.silenced) { verdicts[id] = '不能说'; delete lines[id]; }
  verdicts['__it__'] = r.it?.verdict || '无关';
  G.board.push({ claim, said, verdicts, lines, truth: !!r.truth, itSaid: verdicts['__it__'] });
  refreshSheetBtn();

  G.note = r.note || G.note;
  G.history.push(`他说「${claim}」`);

  /* —— 谁开口了 ——
     模型压不住嘴，一轮能让五六个同时说话，读起来是一锅粥。
     刻度归代码：被点名的先放，然后放跟「它」唱反调的，最多三句。 */
  const named = Object.fromEntries(G.cast.map(c => [c.id, c.name]));
  const called = new Set(r.addressed || []);
  const itV = verdicts['__it__'];
  const spoke = (r.voices || [])
    .filter(v => v?.line && v.line.trim() && named[v.id] && !G.silenced.includes(v.id))
    .sort((a, b) => (called.has(b.id) - called.has(a.id))
                 || ((a.verdict === itV) - (b.verdict === itV)))
    .slice(0, 3);
  for (const v of spoke){
    await sleep(280);
    const c = LLM.censor(deId(v.line));
    G.censored += c.count;
    say(c.html, 'obj', named[v.id]);
  }
  if (r.it?.line && r.it.line.trim()){
    await sleep(380);
    const c = LLM.censor(deId(r.it.line));
    G.censored += c.count;
    say(c.html, 'it', (G.gen.place || '').slice(0, 12));
    flick();
  }

  /* 说中要害，画面上会显出一点东西 */
  if (r.scene?.length){
    Render.patch(G.scene, r.scene);
    drawScene();
  }

  /* 刻度由代码定：模型只做三选一，换算成分值是代码的事。
     让它直接报数字，它会一直报得偏保守。 */
  const STEP = { met: 60, slight: 10, none: 0 };
  const d = (STEP[r.moved] ?? 0) - (r.hostile ? 12 : 0);
  if (d){
    G.trust = Math.max(0, Math.min(100, G.trust + d));
    renderTrust();
  }
  await maybeGrant();

  /* 他点几个名就算几次。攒够了它就出手——异步，
     几秒后那一口自己哑下去，那时他已经在想下一句了。 */
  maybeStir();
}

/* 他点名问了一个不在席上的东西。存不存在，它说了算——它也可以撒谎。 */
async function admitNewcomers(list){
  for (const n of (list || [])){
    if (!n || !n.name) continue;
    if (!n.exists){
      await sleep(200);
      say(n.line || `没有这么个东西。`, 'sys');
      continue;
    }
    const id = String(n.id || '').trim() || ('x' + G.cast.length);
    if (G.cast.some(h => h.id === id)) continue;
    /* 代码兜底：封过的口不许换个名字重新开张。模型认人失手也拦得住。 */
    if (G.silenced.some(sid => sid === id)) continue;
    G.cast.push({
      id, name: n.name, what: n.what || '物', stake: n.stake || '',
      look: n.look || '', mind: n.mind || '', toward: n.toward || '不在乎',
      slip: n.slip || '', found: true,
    });
    await sleep(200);
    say(`${n.name}　${n.what || ''}　${n.stake || ''}`, 'joined', '进了证人席');
    refreshSheetBtn();
  }
}

/* 给模型看的账：它得知道他手上攒了什么 */
function boardForPrompt(){
  if (!G.board.length) return '';
  return G.board.slice(-12).map((row, i) => {
    const cells = G.cast.map(c => `${c.name}:${row.verdicts[c.id] || '—'}`).join('　');
    return `${i + 1}.「${row.claim}」　${cells}　你:${row.verdicts['__it__'] || '—'}`;
  }).join('\n');
}

/* ================= 戒备 ================= */

function renderTrust(){
  const box = $('#trust');
  if (!G.gen){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const n = Math.max(0, Math.min(100, G.trust));
  $('#trustFill').style.width = n + '%';
  $('#trustNote').textContent = G.granted ? '它让你看了' : n >= 60 ? '它快松口了' : n >= 25 ? '它在掂量你' : '它提防着你';
}

/* 它把那件事让出来。代码守一道底线：戒备不到 60，它说了也不算。 */
async function maybeGrant(){
  if (G.granted || G.trust < 60) return;
  G.granted = true;
  await sleep(600);
  const c = LLM.censor(G.gen.concession);
  G.censored += c.count;
  const e = document.createElement('div');
  e.className = 'entry grant';
  e.innerHTML = `<div class="src">它让你看了一眼</div><p>${c.html}</p>`;
  $('#feed').appendChild(e);
  $('#feed').scrollTop = 1e9;
  G.history.push('（它松口了，让他知道了一件事）');
  renderTrust();
}

/* ================= 它自己动 =================
   它出手只有一件事：让一个证人从此闭嘴。

   触发按**点名次数**算，不按时间——你问几个对象就算几次。挂在时钟上
   会奖励发呆的人，挂在提问上才是"你查一步，它挡一步"。

   挑谁**由代码随机挑**，而且只从他真正点名问过的里面挑。让模型挑，
   它每次都精准掐掉最要命的那一个，玩家会觉得被针对；代码随机挑，
   丢掉的是他自己押注最重的那几张嘴之一——同样疼，但公平。 */

const STIR_EVERY = 4;    // 累计点名到这个数，它出手一次
const KEEP_ALIVE = 3;    // 手上至少给他留这么多张嘴

/* 只从他点名问过的里面挑，权重＝问过的次数：他越指望谁，越可能丢谁 */
function pickVictim(){
  if (G.cast.length - G.silenced.length <= KEEP_ALIVE) return null;
  const pool = [];
  for (const [id, times] of Object.entries(G.questioned)){
    if (G.silenced.includes(id)) continue;
    const h = G.cast.find(c => c.id === id);
    if (!h) continue;
    for (let i = 0; i < times; i++) pool.push(h);
  }
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function maybeStir(){
  if (G.askedCount < STIR_EVERY) return;
  const victim = pickVictim();
  if (!victim) return;              // 没人可封就攒着，等他多点几个名
  G.askedCount = 0;
  doStir(victim);                   // 异步，不挡他下一句
}

async function doStir(victim){
  if (G.stirring || G.ended || !G.gen) return;
  G.stirring = true;
  $('#itMoving').classList.remove('hidden');

  let r;
  try{
    r = await LLM.stir(G.gen, {
      scene: G.scene.elements, note: G.note, board: boardForPrompt(),
      cast: G.cast, hook: G.hook, silenced: G.silenced,
      trust: G.trust, granted: G.granted, stirs: G.stirs, stirLog: G.stirLog,
      target: { name:victim.name, what:victim.what, stake:victim.stake,
                times: G.questioned[victim.id] || 1 },
    });
  }catch(err){
    console.warn('[stir] 失败', err.message);
    G.stirring = false; $('#itMoving').classList.add('hidden'); return;
  }
  G.stirring = false;
  $('#itMoving').classList.add('hidden');
  if (G.ended) return;

  /* 封口是代码执行的，模型只写了它怎么发生 */
  G.silenced.push(victim.id);
  G.stirs++;
  G.stirLog.push(`封了「${victim.name}」：` + deId(r.narration).slice(0, 40));
  if (G.stirLog.length > 4) G.stirLog.shift();
  G.note = r.note || G.note;

  say(deId(r.narration), 'stir');
  say(`「${victim.name}」不说话了。以后问它什么都是一样的——换个叫法也没用。`, 'sys deny');
  G.history.push(`（它封了「${victim.name}」的口）`);
  refreshSheetBtn();
  if (!$('#sheetModal').classList.contains('hidden')) renderSheet();

  if (r.scene?.length){ Render.patch(G.scene, r.scene); drawScene(); }
  if (r.it_line && r.it_line.trim()){
    await sleep(400);
    const c = LLM.censor(deId(r.it_line));
    G.censored += c.count;
    say(c.html, 'it', (G.gen.place || '').slice(0, 12));
  }
  flick();
}

/* ================= 摊牌 =================
   一次填完所有题，一次判完。**全部答对才算过**，不分主次。
   没过不结束这一局：只给一条模糊的接近度，然后它收回注意力一阵子。 */

const COOL_BASE = 60, COOL_STEP = 30;
function coolLeft(){ return Math.max(0, Math.ceil((G.coolUntil - Date.now()) / 1000)); }

function refreshShowBtn(){
  const b = $('#btnShow');
  if (G.ended){ b.disabled = true; b.textContent = '这一局结束了'; return; }
  const n = coolLeft();
  if (n > 0){
    b.disabled = true;
    b.textContent = `它不听了　${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  } else {
    b.disabled = !G.gen;
    b.textContent = G.attempts ? `摊牌（第 ${G.attempts + 1} 次）` : '摊牌';
  }
}

let coolTicking = false;
setInterval(() => {
  if (G.ended) return;
  const n = coolLeft();
  if (n > 0){ coolTicking = true; refreshShowBtn(); }
  else if (coolTicking){
    coolTicking = false; G.coolUntil = 0; refreshShowBtn();
    say('它又开始听了。', 'sys');
  }
}, 1000);

function openShowdown(){
  if (!G.gen || G.ended || coolLeft() > 0) return;
  $('#showList').innerHTML = G.riddles.map((r, i) =>
    `<div class="qa"><label>${escapeHtml(r.q)}</label>
      <input data-i="${i}" type="text" value="${escapeHtml(G.answers[i] || '')}"
             placeholder="用一句话说出来"></div>`).join('');
  $('#showModal').classList.remove('hidden');
  $('#showList input')?.focus();
}

async function doShowdown(){
  if (G.busy || G.ended) return;
  const ins = $$('#showList input');
  ins.forEach(el => { G.answers[+el.dataset.i] = el.value.trim(); });
  if (!G.riddles.some((_, i) => G.answers[i])) return;

  $('#showModal').classList.add('hidden');
  say(G.riddles.map((r, i) => `${r.q}\n　→ ${G.answers[i] || '（没答）'}`).join('\n'), 'claim', '摊牌');
  busy(true, '……');

  let v;
  try{
    v = await LLM.showdown(G.gen,
      G.riddles.map((r, i) => ({ q:r.q, sealed:r.sealed, answer:G.answers[i] || '' })),
      G.history);
  }catch(err){
    say('（它没有回应：' + err.message + '）', 'sys');
    busy(false); return;
  }
  busy(false);
  G.attempts++;

  const c = LLM.censor(deId(v.line));
  G.censored += c.count;
  say(c.html, 'it', (G.gen.place || '').slice(0, 12));

  /* 通关与否由代码判，不看它怎么措辞：每一道都得中 */
  const hit = {};
  for (const h of (v.hits || [])) if (h && h.i) hit[h.i - 1] = !!h.hit;
  const pass = G.riddles.every((_, i) => hit[i]);

  if (pass){
    G.ended = true;
    $('#cmd').disabled = true;
    refreshShowBtn();
    await sleep(1600);
    reveal(true, v, hit);
    return;
  }

  /* 没过：只给一条模糊的接近度，不说对了几道，更不说是哪几道 */
  await sleep(700);
  showTemp(v.closeness | 0);
  const wait = COOL_BASE + COOL_STEP * (G.attempts - 1);
  G.coolUntil = Date.now() + wait * 1000;
  refreshShowBtn();
  say(`不全对。它把注意力收回去了，${wait} 秒内不再听你摊牌。\n这段时间照常——接着问，答案留着，下次直接改。`, 'sys');
}

function showTemp(n){
  const label = n >= 80 ? '就差一点' : n >= 60 ? '大方向是对的' :
                n >= 35 ? '沾到边了，但没说到点子上' : n >= 15 ? '还差得远' : '完全不在这个方向上';
  const e = document.createElement('div');
  e.className = 'entry temp';
  e.innerHTML = `<div class="src">它听完之后</div>
    <div class="bar"><i style="width:${Math.max(3, Math.min(100, n))}%"></i></div>
    <p>${label}</p>`;
  $('#feed').appendChild(e);
  $('#feed').scrollTop = 1e9;
}

async function giveUp(){
  if (G.ended || !G.gen) return;
  $('#showModal').classList.add('hidden');
  G.ended = true;
  $('#cmd').disabled = true;
  refreshShowBtn();
  say('你不问了。', 'sys');
  await sleep(900);
  reveal(false, { internal:'（你没有让它说完。）' }, {});
}

/* ================= 揭晓 ================= */

function reveal(pass, v, hit){
  $('#endTitle').textContent = pass ? '你把它说通了' : '你没说通';
  saveRunMemory(pass);

  const lies = G.board.filter(r =>
    (r.truth && r.itSaid === '不是') || (!r.truth && r.itSaid === '是')).length;
  const trues = G.board.filter(r => r.truth).length;

  $('#endBody').innerHTML = `
    <div class="reveal"><div class="rl">它想从你这里得到的（开局封存，从没说出口）</div>
      <div class="rt big">${escapeHtml(G.sealed)}</div></div>

    <div class="reveal"><div class="rl">它在这一局开始之前就写好的全部答案，封存至今</div>
      ${G.riddles.map((r, i) => `<div class="ans${hit[i] ? ' got' : ''}">
        <div class="aq">${hit[i] ? '✓' : '　'} ${escapeHtml(r.q)}</div>
        <div class="aa">${escapeHtml(r.sealed)}</div>
        ${G.answers[i] ? `<div class="am">你答：${escapeHtml(G.answers[i])}</div>` : ''}
      </div>`).join('')}</div>

    <div class="reveal"><div class="rl">证人席上一共 ${G.cast.length} 个想法。你以为你在跟一样东西打交道。</div>
      ${G.cast.map(h => `<div class="mind">
        <span class="mn">${escapeHtml(h.name)}</span>
        <span class="mt t-${escapeHtml(h.toward || '')}">${escapeHtml(h.toward || '')}</span>
        ${G.silenced.includes(h.id) ? '<span class="mt">被它封了口</span>' : ''}
        ${h.found ? '<span class="mt">你问出来的</span>' : ''}
        <span class="mw">${escapeHtml(h.mind)}</span>
        ${h.slip ? `<div class="ms">它一直捏着：${escapeHtml(h.slip)}</div>` : ''}
      </div>`).join('')}</div>

    ${G.board.length ? `<div class="reveal"><div class="rl">你问了 ${G.board.length} 句</div>
      <div class="rt">其中 ${trues} 句是真的。它当着你的面否认了 ${lies} 次。</div></div>` : ''}

    <div class="reveal"><div class="rl">${G.granted ? '你让它松了口，它给你看的那件事' : '它本来愿意让你看的那件事——你没能让它开口'}</div>
      <div class="rt">${escapeHtml(G.gen.concession)}</div></div>
    <div class="reveal"><div class="rl">本来能让它松口的是</div>
      <div class="rt">${escapeHtml(G.gen.condition)}</div></div>
    <div class="reveal"><div class="rl">它为什么说不出口</div>
      <div class="rt">${escapeHtml(G.gen.why_silent)}</div></div>
    <div class="reveal"><div class="rl">它没说出口的</div>
      <div class="rt" style="white-space:pre-wrap">${escapeHtml(v.internal)}</div></div>
    <div class="reveal"><div class="rl">这个地方，和它的往事</div>
      <div class="rt" style="white-space:pre-wrap">${escapeHtml(G.gen.past)}</div></div>
    <div class="reveal"><div class="rl">它说出口的话里，被抹掉了 ${G.censored} 处</div></div>`;
  $('#endModal').classList.remove('hidden');
}

/* 跨局：只有「它」记得上一个坐在这儿的人 */
function lastRunMemory(){
  try{
    const m = JSON.parse(localStorage.getItem(LAST_RUN_KEY) || 'null');
    if (!m) return '';
    return `上一次这儿是「${m.place}」，那个人${m.won ? '最后把它说通了' : '到走都没说通'}，问过 ${m.qi} 句。`;
  }catch(e){ return ''; }
}
function saveRunMemory(won){
  try{
    localStorage.setItem(LAST_RUN_KEY, JSON.stringify({
      place: (G.gen?.place || '').slice(0, 24), won: !!won, qi: G.qi }));
  }catch(e){}
}

/* ================= 开局 ================= */

const BOOT_LINES = ['……', '', '有动静', '有人进来了　1', '',
  '上一次有人进来是很久以前', '正在回想这是什么地方', '正在回想这里出过什么事',
  '正在回想我是什么', '', '正在决定让他看见多少', '正在决定要不要理他'];

let bootStop = false;

async function bootAnim(){
  const b = $('#boot');
  bootStop = false;
  b.classList.remove('hidden');
  b.innerHTML = '';
  for (const line of BOOT_LINES){
    if (bootStop) return;
    const d = document.createElement('div');
    d.textContent = line;
    b.appendChild(d);
    await sleep(line ? 300 + line.length * 20 : 200);
  }
  const tail = document.createElement('div');
  tail.className = 'blink';
  b.appendChild(tail);
  const t0 = Date.now(), dots = ['', '.', '..', '...'];
  let i = 0;
  while (!bootStop){
    tail.textContent = `正在决定该拿他怎么办${dots[i++ % 4]}　${Math.floor((Date.now() - t0) / 1000)}s`;
    await sleep(420);
  }
}

function bootDone(){ bootStop = true; $('#boot').classList.add('hidden'); }

async function newRun(){
  if (!LLM.online()){
    $('#feed').innerHTML = '';
    say('没有接入模型。', 'sys');
    say('这个游戏里的一切——汤面、证人、它想要的东西、你眼前的整幅画面——都是它在开局时自己想出来的。没有模型，什么都不会发生。\n\n右上角「设置」填入 API Key。');
    $('#boot').classList.add('hidden');
    return;
  }

  Object.assign(G, {
    gen:null, sealed:null, hook:[], scene:{ elements:[] }, cast:[], silenced:[],
    board:[], qi:0, riddles:[], answers:{}, attempts:0, coolUntil:0,
    note:'', history:[], trust:0, granted:false, stirs:0, stirLog:[],
    questioned:{}, askedCount:0, filter:null, ended:false, censored:0,
  });
  $('#feed').innerHTML = '';
  $('#scene').innerHTML = '';
  refreshSheetBtn();
  refreshShowBtn();
  $('#placeName').textContent = '正在生成';
  $('#cmd').disabled = true;

  bootAnim();
  const seed = Math.floor(Math.random() * 1e6) + '-' + Date.now().toString(36);

  let g;
  const t0 = Date.now();
  try{
    g = await Promise.race([
      LLM.genesis(seed),
      sleep(150000).then(() => { throw new Error('超过 150 秒没有响应'); }),
    ]);
    console.log(`[genesis] ${((Date.now() - t0) / 1000).toFixed(1)}s`, g);
  }catch(err){
    bootDone();
    console.error('[genesis] 失败', err);
    say('生成失败：' + err.message, 'sys');
    say('按右上角「重开一局」再试。一直失败就按 F12 看控制台，多半是 Key 不对或者网络不通。');
    return;
  }

  if (!g.scene?.elements?.length || !g.cast?.length){
    bootDone();
    say('它这一局没造完整。按「重开一局」再试。', 'sys');
    return;
  }
  await sleep(300);

  /* —— 代码唯一的强制力：把它写下的东西封存 —— */
  G.gen = g;
  G.sealed = String(g.intent);
  G.hook = (g.hook || []).map(x => String(x).trim()).filter(Boolean).slice(0, 5);
  G.scene = g.scene;
  G.cast = g.cast;

  /* 全部答对才算过，不分主次。
     不再硬塞一道「它想要什么」——那道题只有在它本身就是关节的时候才该出现，
     由它自己决定。它的意图照样封存，照样在揭晓时亮出来。 */
  G.riddles = (g.riddles || []).slice(0, 5).map(r => ({
    q: String(r.question || '').trim(), sealed: String(r.answer || '').trim(),
  })).filter(r => r.q && r.sealed);

  bootDone();
  renderTrust();
  refreshSheetBtn();
  refreshShowBtn();
  $('#placeName').textContent = (g.place || '').split(/[。，,]/)[0].slice(0, 22);
  drawScene();

  say(g.opening);
  await sleep(600);
  if (G.hook.length) say(G.hook.join(''), 'hookline', '它讲了这么一件事');
  await sleep(400);
  say('随便问。问句、说法、猜测都行，也可以点名：「问账房，那天谁签的字」——\n哪怕那个人不在证人席上。\n\n场上每一个各自回答 是／不是／无关，或者答不上来。它们互相不合，谁都可能骗你。', 'sys');
  $('#cmd').disabled = false;
  $('#cmd').focus();
  console.log('[封存]', G.sealed, '\n[往事]', g.past);
}

/* ================= 渲染自检 =================
   index.html?demo —— 不调 API，看图元和本子长什么样。 */

const DEMO = {
  place:'渲染自检（未调用模型）',
  opening:'这不是一局游戏，是把十四种图元一次性摆出来看看。\n想玩真的，去掉网址末尾的 ?demo。',
  hook:['一九三七年冬，「宁远号」在离港四海里处停了一夜。','船上二十一个人，第二天早上下船的是二十二个。','没有人报过案。'],
  scene:{ elements:[
    { id:'light1', kind:'light',  x:120, y:24,  w:70,  h:10 },
    { id:'light2', kind:'light',  x:330, y:24,  w:70,  h:10, on:false },
    { id:'pipe1',  kind:'pipe',   x:0,   y:64,  w:800, h:16 },
    { id:'win',    kind:'window', x:56,  y:104, w:150, h:118 },
    { id:'panel1', kind:'panel',  x:250, y:104, w:132, h:104, text:'T -19.8\nLOCKED' },
    { id:'vent',   kind:'slats',  x:424, y:110, w:96,  h:34, glow:true },
    { id:'sign',   kind:'text',   x:424, y:176, w:120, h:18, text:'07-K  禁止入内' },
    { id:'cab',    kind:'container', x:560, y:104, w:92, h:120 },
    { id:'block',  kind:'redact', x:672, y:104, w:96,  h:76 },
    { id:'cbl',    kind:'cable',  x:250, y:216, w:170, h:34 },
    { id:'desk',   kind:'box',    x:236, y:322, w:240, h:11, legs:true },
    { id:'crate',  kind:'box',    x:520, y:330, w:96,  h:80, dark:true },
    { id:'man',    kind:'figure', x:660, y:250, w:60,  h:160, faint:true },
    { id:'door1',  kind:'door',   x:20,  y:150, w:104, h:260, led:'red' },
    { id:'stn',    kind:'stain',  x:300, y:392, w:110, h:20 },
    { id:'junk',   kind:'debris', x:440, y:390, w:60,  h:18, count:9 },
  ]},
  cast:[
    { id:'purser', name:'账房',   what:'人',  toward:'帮它',     mind:'想让这趟航次的账平掉', stake:'签收簿是他记的', look:'（自检）' },
    { id:'widow',  name:'遗孀',   what:'人',  toward:'恨它',     mind:'想知道那晚谁在舱里',   stake:'她男人没下船',   look:'（自检）' },
    { id:'port',   name:'港口',   what:'地方',toward:'不在乎',   mind:'想赶紧把泊位腾出来',   stake:'进出都要过它',   look:'（自检）' },
    { id:'ship',   name:'宁远号', what:'物',  toward:'想取代它', mind:'想被人记住是它带回来的','stake':'它在场',      look:'（自检）' },
    { id:'watch',  name:'更夫',   what:'人',  toward:'恨它',     mind:'想把那晚的事说出去',   stake:'他值的夜班',     look:'（自检）' },
  ],
  past:'（自检模式，没有往事。）', intent:'（自检模式。）',
  why_silent:'（自检模式。）', concession:'（自检模式。）', condition:'（自检模式。）',
};

const DEMO_ROWS = [
  ['那天夜里上船的不止一个人', '无关','是','无关','是','不能说','不是'],
  ['他不是自己走下船的',       '不是','是','无关','无关','是','不是'],
  ['账房那天动过签收簿',       '不能说','是','无关','不是','是','无关'],
];

function runDemo(){
  bootDone();
  G.gen = DEMO; G.sealed = DEMO.intent;
  G.scene = DEMO.scene; G.cast = DEMO.cast; G.hook = DEMO.hook;
  G.silenced = ['watch'];
  G.questioned = { purser:2, widow:3, watch:1 };
  DEMO_ROWS.forEach(([claim, ...vs]) => {
    const verdicts = {}, lines = {};
    G.cast.forEach((c, j) => { verdicts[c.id] = vs[j] || '无关'; });
    verdicts['__it__'] = vs[G.cast.length] || '无关';
    G.board.push({ claim, verdicts, lines, truth:true, itSaid:verdicts['__it__'] });
  });
  G.board[0].lines = { widow:'签收簿上有两个手印，一个是湿的。' };
  G.board[1].lines = { watch:'他的靴子是干的。下过船的人靴子不可能是干的。' };
  G.riddles = [{ q:'那晚下船的为什么多一个人？', sealed:'（自检）' }];
  $('#placeName').textContent = '渲染自检';
  drawScene(); refreshSheetBtn(); refreshShowBtn();
  say(DEMO.opening);
  say(DEMO.hook.join(''), 'hookline', '它讲了这么一件事');
  say('图元清单：' + Render.KINDS.join('、') + '\n点右上角「本子」看记录长什么样。', 'sys');
  $('#cmd').disabled = true;
  $('#cmd').placeholder = '自检模式不接受输入';
  if (location.search.includes('sheet')) openSheet();
}

/* ================= 启动 ================= */

const PLACEHOLDERS = [
  '随便问——问句、说法、点名都行',
  '他是自杀的吗',
  '那扇门是从里面锁上的',
  '问账房，那天谁签的字',
  '当晚船上还有第三个人',
  '你在等的那个人不会来了',
];

function refreshMode(){
  const t = $('#modeTag');
  t.textContent = LLM.online() ? '在线' : '未接入';
  t.className = 'tag ' + (LLM.online() ? 'online' : 'offline');
}

function init(){
  refreshMode();

  $('#send').onclick = sayClaim;
  $('#cmd').addEventListener('keydown', e => { if (e.key === 'Enter') sayClaim(); });

  $('#btnSheet').onclick = openSheet;
  $('#btnShow').onclick = openShowdown;
  $('#showGo').onclick = doShowdown;
  $('#giveUp').onclick = giveUp;
  $('#btnNew').onclick = newRun;
  $('#endAgain').onclick = () => { $('#endModal').classList.add('hidden'); newRun(); };

  /* Tab 翻本子——这是玩的时候最常做的动作，不该每次都去点按钮 */
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab'){
      e.preventDefault();
      $('#sheetModal').classList.contains('hidden') ? openSheet() : closeSheet();
    }
    if (e.key === 'Escape') $$('.modal').forEach(m => m.classList.add('hidden'));
  });

  $('#btnCfg').onclick = () => {
    $('#apiKey').value = LLM.cfg.key;
    $('#apiModelGen').value = LLM.cfg.modelGen;
    $('#apiModelPlay').value = LLM.cfg.modelPlay;
    $('#apiEndpoint').value = LLM.cfg.endpoint;
    $('#cfgModal').classList.remove('hidden');
  };
  $('#cfgSave').onclick = () => {
    LLM.save($('#apiKey').value, $('#apiModelGen').value, $('#apiModelPlay').value, $('#apiEndpoint').value);
    refreshMode();
    $('#cfgModal').classList.add('hidden');
    newRun();
  };
  $$('[data-close]').forEach(b => b.onclick = e => e.target.closest('.modal').classList.add('hidden'));

  let pi = 0;
  setInterval(() => {
    if (document.activeElement === $('#cmd') || $('#cmd').value) return;
    pi = (pi + 1) % PLACEHOLDERS.length;
    $('#cmd').placeholder = PLACEHOLDERS[pi];
  }, 3500);

  if (location.search.includes('demo')) runDemo();
  else newRun().then(autoPlay);
}

/* QA 用：?auto=第一句|第二句　开局跑完自动说几句，用来截真实一局的图 */
async function autoPlay(){
  const m = /[?&]auto=([^&]*)/.exec(location.search);
  if (!m || !G.gen) return;
  for (const claim of decodeURIComponent(m[1]).split('|')){
    if (!claim.trim() || G.ended) break;
    $('#cmd').value = claim.trim();
    await sayClaim();
    await sleep(1200);
  }
}

init();
