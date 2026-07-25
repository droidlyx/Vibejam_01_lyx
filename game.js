/* ============================================================
   引擎
   ------------------------------------------------------------
   代码在这一局里只做三件事：
     1. 把它开局写下的 intent 封存起来（它事后改不了口）
     2. 记流水账
     3. 结算时把封存的原文亮出来对照
   它想什么、做什么、说什么谎，代码一概不管。
   ============================================================ */

var G = window.G = {
  gen: null,        // 开局产物
  sealed: null,     // 封存的 intent —— 只在结算时才读
  scene: { elements: [] },
  hotspots: {},
  cast: [],         // 场上有想法的东西，按顺序。表的列就是它们。
  board: [],        // 真值表。每一行 = 他说过的一句话 + 全场的裁决
  qi: 0,            // 他说到第几句了
  ledger: [],       // 代码记的流水账。见证者的裁决只能依据它——它没有编造的余地。
  sinceStir: 0,
  history: [],
  note: '',
  acts: [],         // 它做过的事，给玩家看的流水
  attempts: [],     // 猜过几次
  riddles: [],      // 这一局它出的题。第 0 道是核心题（它想要什么）
  pick: 0,          // 当前选中哪一道
  coolUntil: 0,     // 猜错后的冷却截止时间戳。冷却期间游戏照常，玩家继续查。
  trust: 0,         // 它对你的戒备松了多少。0=完全提防
  granted: false,   // 它是否已经把那件事让出来了（一局一次）
  stirs: 0,         // 它自己动过几次
  lastAct: 0,       // 玩家上一次有动作的时间戳
  focus: null,
  busy: false,
  stirLog: [],      // 它自己动过什么，喂回给它——不然它会推第三次同一扇门
  stirring: false,  // 它自己动那条线是异步的，跟他的输入互不阻塞
  ended: false,
  censored: 0,
};

/* 代码记账。这份记录是见证者唯一的依据——它答话时代码把这个原样喂给模型，
   所以它没有编造的余地。它就是这本账本，站在场上。 */
function ledger(text){
  G.ledger.push(text);
  if (G.ledger.length > 40) G.ledger.shift();
}

/* 它偶尔会把图元的英文 id 直接写进叙述里（"那盏叫 __witness__ 的灯"）。
   提示词里嘱咐过了，但嘱咐不如换掉——凡是 id 一律换成玩家看得懂的名字。 */
function deId(text){
  let s = String(text || '');
  for (const h of G.cast){
    if (!h.id || h.id.length < 3) continue;
    s = s.split(h.id).join(h.name);
  }
  return s;
}

/* 见证者不归它管。它的图元代码不许它碰——它想熄掉那盏灯、想把它挪走、
   想让它消失，一律拦下。第一次拦的时候当着玩家的面说出来。 */
let denied = false;
function guardWitness(patch){
  const bad = (patch || []).filter(p => p && p.id === WITNESS_ID);
  if (!bad.length) return patch || [];
  if (!denied){
    denied = true;
    const nm = G.hotspots[WITNESS_ID]?.name || '那件东西';
    say(`它伸手去动「${nm}」了。动不了——那一件不归它管。`, 'sys deny');
    ledger(`它想动「${nm}」，没动成`);
  }
  return (patch || []).filter(p => p && p.id !== WITNESS_ID);
}

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= 叙述流 ================= */

function say(text, cls = '', src = ''){
  const e = document.createElement('div');
  e.className = 'entry ' + cls;
  if (src) e.innerHTML = `<div class="src">${src}</div>`;
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

/* ================= 场景 ================= */

function drawScene(){
  const hs = Render.draw($('#scene'), G.scene);
  const byId = Object.fromEntries(G.scene.elements.map(e => [e.id, e]));
  for (const h of Object.values(G.hotspots)){
    const e = byId[h.id];
    if (!e) continue;
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const pad = 6;
    r.setAttribute('x', Math.max(0, e.x - pad));
    r.setAttribute('y', Math.max(0, e.y - pad));
    r.setAttribute('width', e.w + pad * 2);
    r.setAttribute('height', e.h + pad * 2);
    r.setAttribute('class', 'hot' + (G.focus === h.id ? ' sel' : ''));
    r.dataset.id = h.id;
    r.addEventListener('click', () => observe(h.id));
    hs.appendChild(r);
  }
}

/* 观察：零延迟，读的是开局就写好的文本。
   看不是目的——看是为了想出一句可以拿去问的话。 */
function observe(id){
  const h = G.hotspots[id];
  if (!h) return;
  G.focus = id;
  $('#objName').textContent = h.name + (h.witness ? '　（它不归它管）' : '');
  $('#focusTag').classList.remove('hidden');
  $('#focusTag').textContent = '◉ ' + h.name + ' ×';
  say(h.look, '', '看 ' + h.name);
  G.history.push('看了 ' + h.name);
  ledger(`他走到「${h.name}」跟前看了一会儿`);
  drawScene();
  touch();
  if (!G.ended) $('#cmd').focus();
}

function clearFocus(){
  G.focus = null;
  $('#focusTag').classList.add('hidden');
  drawScene();
}

function logAct(text){
  G.acts.push(text);
  const box = $('#clueList');
  if (G.acts.length === 1) box.innerHTML = '';
  const c = document.createElement('div');
  c.className = 'chip';
  c.textContent = text;
  box.appendChild(c);
  box.scrollTop = 1e9;
}

/* 冷却：猜错之后它收回注意力一段时间。
   这段时间里游戏照常——观察、行动、翻线索都不受影响，
   所以玩家没有理由去刷无意义的动作，只管接着查。 */
const COOL_BASE = 60, COOL_STEP = 30;   // 秒：60 / 90 / 120 …

function coolLeft(){ return Math.max(0, Math.ceil((G.coolUntil - Date.now()) / 1000)); }

function refreshGuessBtn(){
  const b = $('#btnGuess');
  if (G.ended){ b.disabled = true; b.textContent = '这一局结束了'; return; }
  const n = coolLeft();
  if (n > 0){
    b.disabled = true;
    b.textContent = `它不听了　${String(Math.floor(n / 60))}:${String(n % 60).padStart(2, '0')}`;
  } else {
    b.disabled = !G.gen;
    const k = G.attempts.length;
    b.textContent = k ? `说出你的判断（第 ${k + 1} 次）` : '说出你的判断';
  }
}

/* 每秒刷一次按钮上的倒计时；归零时它会说一句 */
let coolTicking = false;
setInterval(() => {
  if (G.ended) return;
  const n = coolLeft();
  if (n > 0){ coolTicking = true; refreshGuessBtn(); }
  else if (coolTicking){
    coolTicking = false;
    G.coolUntil = 0;
    refreshGuessBtn();
    say('它又开始听了。', 'sys');
  }
}, 1000);

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
  logAct('它让你看了一眼');
  renderTrust();
}

/* ================= 它自己动 ================= */

let idleTimer = null;
const IDLE_STEPS = [32000, 45000, 62000];     // 连续无操作时，间隔逐次拉长

function scheduleStir(){
  clearTimeout(idleTimer);
  if (G.ended || !G.gen || !LLM.online()) return;
  const wait = IDLE_STEPS[Math.min(G.stirs, IDLE_STEPS.length - 1)];
  idleTimer = setTimeout(() => doStir({ idle:true }), wait);
}

function touch(){                              // 玩家有动作了，重排下一次
  G.lastAct = Date.now();
  G.stirs = 0;
  scheduleStir();
}

/* 它自己动。**不占用他的输入**——他往前查一步，它就往前推一步，
   两条线同时走。所以这里不碰 G.busy，只在角落点一盏灯。 */
async function doStir(opts){
  if (G.stirring || G.ended || !G.gen) { scheduleStir(); return; }
  G.stirring = true;
  $('#itMoving').classList.remove('hidden');

  let r;
  try{
    r = await LLM.stir(G.gen, {
      scene: G.scene.elements, note: G.note, board: boardForPrompt(),
      trust: G.trust, granted: G.granted, stirs: G.stirs, stirLog: G.stirLog,
      idleSec: opts?.idle ? Math.round((Date.now() - G.lastAct) / 1000) : null,
    });
  }catch(err){
    console.warn('[stir] 失败', err.message);
    G.stirring = false; $('#itMoving').classList.add('hidden'); scheduleStir(); return;
  }
  G.stirring = false;
  $('#itMoving').classList.add('hidden');
  if (G.ended) return;

  G.stirs++;
  G.stirLog.push(deId(r.narration).slice(0, 60));
  if (G.stirLog.length > 4) G.stirLog.shift();
  G.note = r.note || G.note;
  say(deId(r.narration), 'stir');
  G.history.push(`（它自己动了：${r.narration.slice(0, 30)}）`);
  ledger('它自己动了：' + deId(r.narration).slice(0, 34));

  r.scene = guardWitness(r.scene);
  if (r.scene?.length){
    Render.patch(G.scene, r.scene);
    drawScene();
    logAct('▸ ' + describePatch(r.scene));
  }
  if (r.it_line && r.it_line.trim()){
    await sleep(400);
    const c = LLM.censor(r.it_line.trim());
    G.censored += c.count;
    say(c.html, 'it', G.gen.place.slice(0, 12));
  }
  flick();
  scheduleStir();
}

/* ================= 真值表 =================
   行 = 他说过的一句话，列 = 场上一件东西。
   格子里是那件东西对那句话的裁决。
   这张表是他推理的骨架，也是他唯一能看见的"信息增量"。 */

function renderBoard(){
  const wrap = $('#board');
  if (!G.board.length){
    wrap.innerHTML = '<div class="bempty">你说的每一句话都会记在这里，<br>' +
      '连同场上每一件东西当时的回答。<br><br>' +
      '<span class="v-yes">是</span>　<span class="v-no">否</span>　' +
      '<span class="v-na">—</span> 与我无关　<span class="v-mute">▓</span> 答不上来</div>';
    return;
  }

  const cols = [...G.cast, { id:'__it__', name:'它', self:true }];

  const head = cols.map(c =>
    `<th class="${c.self ? 'cit' : c.witness ? 'cwit' : ''}"><span>${escapeHtml(c.name)}</span></th>`
  ).join('');

  /* 每一句占两行：上面一整行是那句话，下面是各自的裁决，对齐在名字底下。
     挤在一行里读不出来——这张表是给他推理用的，不是装饰。 */
  const rows = G.board.map((row, i) => {
    const cells = cols.map(c => {
      if (row.gone && row.gone[c.id]) return `<td class="v-gone" title="它把这一格涂掉了">▓</td>`;
      const key = Object.keys(VERDICTS).find(k => VERDICTS[k].key === row.verdicts[c.id]);
      const d = VERDICTS[key];
      return d ? `<td class="${d.cls}" title="${d.key}">${d.mark}</td>` : `<td class="v-na">—</td>`;
    }).join('');
    return `<tr class="cr"><td class="claim" colspan="${cols.length + 1}">` +
           `<b>${i + 1}</b>${escapeHtml(row.claim)}</td></tr>` +
           `<tr class="vr"><th class="rn"></th>${cells}</tr>`;
  }).join('');

  wrap.innerHTML =
    `<table id="btab"><thead><tr><th class="rn"></th>${head}</tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
  wrap.scrollTop = 1e9;
}

/* ================= 说出一句话 =================
   他唯一能做的事。不是"操作"，是**下判断**——
   每一次输入都必须是一个他已经推出来的命题，所以没有无效交互。 */

async function sayClaim(){
  const box = $('#cmd');
  const claim = box.value.trim();
  if (!claim || G.busy || G.ended || !G.gen) return;

  box.value = '';
  clearTimeout(idleTimer);
  say('「' + claim + '」', 'claim', `第 ${G.qi + 1} 句`);
  busy(true, '……');

  let r;
  try{
    r = await LLM.ask(G.gen, {
      scene: G.scene.elements,
      note: G.note,
      cast: G.cast,
      ledger: G.ledger,
      lastRun: lastRunMemory(),
      board: boardForPrompt(),
      qi: G.qi + 1,
      trust: G.trust, granted: G.granted,
    }, claim);
  }catch(err){
    say('（没有回应：' + err.message + '）', 'sys');
    busy(false); touch(); return;
  }
  busy(false);

  /* 不是一句能判真假的话 —— 这一轮不算数，也不推进它 */
  if (r.valid === false){
    say('这不是一句能判真假的话。说一件你认为是真的事，别问，也别下命令。\n比如：「那扇门是从里面锁上的」。', 'sys');
    touch();
    return;
  }

  /* —— 记一行 —— */
  G.qi++;
  const verdicts = {};
  for (const v of (r.voices || [])){
    if (v && v.id) verdicts[v.id] = v.verdict;
  }
  verdicts['__it__'] = r.it?.verdict || '无关';
  const row = { claim, verdicts, gone:{}, truth: !!r.truth, itSaid: verdicts['__it__'] };
  G.board.push(row);
  renderBoard();

  G.note = r.note || G.note;
  G.history.push(`他说「${claim}」`);
  ledger(`第 ${G.qi} 句，他说：${claim}`);

  /* —— 谁开口了 ——
     模型压不住嘴，一轮能让五六件东西同时说话，读起来是一锅粥。
     刻度归代码：最多放三句，先放跟「它」唱反调的那几句——
     异口同声不含信息，分歧才含。 */
  const named = Object.fromEntries(G.cast.map(c => [c.id, c.name]));
  const itV = verdicts['__it__'];
  const spoke = (r.voices || [])
    .filter(v => v?.line && v.line.trim() && named[v.id])
    .sort((a, b) => (a.verdict === itV) - (b.verdict === itV))
    .slice(0, 3);
  for (const v of spoke){
    await sleep(280);
    const c = LLM.censor(deId(v.line));
    G.censored += c.count;
    say(c.html, 'obj' + (v.id === WITNESS_ID ? ' wit' : ''), named[v.id]);
  }
  if (r.it?.line && r.it.line.trim()){
    await sleep(380);
    const c = LLM.censor(deId(r.it.line));
    G.censored += c.count;
    say(c.html, 'it', G.gen.place.slice(0, 12));
    flick();
  }

  /* —— 说中要害，画面会因此显形 —— */
  r.scene = guardWitness(r.scene);
  if (r.scene?.length){
    Render.patch(G.scene, r.scene);
    drawScene();
    logAct(describePatch(r.scene));
    ledger('场上变了：' + describePatch(r.scene));
  }

  /* —— 它涂掉他表上已有的一格 —— */
  await applyRetract(r.retract);

  /* 刻度由代码定：模型只做三选一的判断，换算成分值是代码的事。
     让它直接报数字，它会一直报得偏保守。 */
  const STEP = { met: 60, slight: 10, none: 0 };
  const d = (STEP[r.moved] ?? 0) - (r.hostile ? 12 : 0);
  if (d){
    G.trust = Math.max(0, Math.min(100, G.trust + d));
    renderTrust();
  }
  await maybeGrant();

  /* 他往前查一步，它就往前推一步。不等他——异步推进，
     几秒后它的动作会自己落到侧栏里，那时他已经在想下一句了。 */
  G.sinceStir++;
  if (G.sinceStir >= 2){ G.sinceStir = 0; doStir(); }
  touch();
}

/* 它把某一格涂掉。代码真的改那一格，并且当着他的面改。 */
async function applyRetract(rt){
  if (!rt || !rt.qi || rt.qi < 1 || rt.qi > G.board.length) return;
  const row = G.board[rt.qi - 1];
  const id = rt.id;
  if (!(id in row.verdicts)) return;

  /* 见证者不归它管——代码拒绝，而且当着他的面拒绝 */
  if (id === WITNESS_ID){
    await sleep(500);
    say(`它想涂掉第 ${rt.qi} 句里${G.hotspots[WITNESS_ID]?.name || '那件东西'}的回答。它做不到——那一件不归它管。`, 'sys deny');
    ledger('它试过涂掉见证者的回答，没成功');
    return;
  }

  await sleep(500);
  row.gone[id] = true;
  renderBoard();
  const nm = G.hotspots[id]?.name || '某件东西';
  if (rt.line && rt.line.trim()){
    const c = LLM.censor(deId(rt.line));
    G.censored += c.count;
    say(c.html, 'it', G.gen.place.slice(0, 12));
  }
  say(`第 ${rt.qi} 句里「${nm}」的那一格被涂黑了。`, 'sys deny');
  logAct('涂掉了第 ' + rt.qi + ' 句的一格');
  ledger(`它涂掉了第 ${rt.qi} 句里「${nm}」的回答`);
  flick();
}

/* 给模型看的表：它得知道他手上攒了什么，才知道该涂哪一格 */
function boardForPrompt(){
  if (!G.board.length) return '';
  return G.board.map((row, i) => {
    const cells = G.cast.map(c => {
      const v = row.gone[c.id] ? '已涂黑' : (row.verdicts[c.id] || '—');
      return `${c.name}:${v}`;
    }).join('　');
    return `${i + 1}.「${row.claim}」　${cells}　你:${row.verdicts['__it__'] || '—'}`;
  }).join('\n');
}

function flick(){
  $('#crt').classList.add('flicker');
  setTimeout(() => $('#crt').classList.remove('flicker'), 700);
}

/* 跨局：见证者是唯一记得上一次的东西 */
function lastRunMemory(){
  try{
    const s = localStorage.getItem(WITNESS_MEMORY_KEY);
    if (!s) return '';
    const m = JSON.parse(s);
    return `上一次这里是「${m.place}」，那个人${m.won ? '最后说中了' : '到走都没说中'}。他说过 ${m.qi} 句话。`;
  }catch(e){ return ''; }
}

function saveRunMemory(won){
  try{
    localStorage.setItem(WITNESS_MEMORY_KEY, JSON.stringify({
      place: (G.gen?.place || '').slice(0, 24), won: !!won, qi: G.qi,
    }));
  }catch(e){}
}

/* 把它对画面的改动翻成一句人话，摆在底栏——这是玩家能看见的"它自己动了" */
function describePatch(patch){
  const bits = patch.map(p => {
    const h = G.hotspots[p.id];
    // 没有热区的图元不要把英文 id 摊给玩家看
    const n = h ? h.name : '有什么';
    if (p.remove) return n + ' 不见了';
    if (p.kind === 'redact') return n + ' 被盖住了';
    if (p.on === false) return n + ' 灭了';
    if (p.on === true) return n + ' 亮了';
    if (p.open === true) return n + ' 开了';
    if (p.open === false) return n + ' 关上了';
    if (p.text != null) return n + ' 显示：' + String(p.text).replace(/\n/g, ' ').slice(0, 16);
    return n + ' 变了';
  });
  return bits.slice(0, 3).join('，');
}

/* ================= 它出的题 ================= */

function renderRiddles(){
  const box = $('#riddleList');
  box.innerHTML = '';
  G.riddles.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'riddle' + (G.pick === i ? ' on' : '') + (r.solved ? ' done' : '') + (r.core ? ' core' : '');
    d.innerHTML = `<span class="rq">${escapeHtml(r.q)}</span>` +
      (r.solved ? `<span class="rtag">已答对</span>`
                : r.core ? `<span class="rtag core">答对即通关</span>` : '');
    if (!r.solved) d.onclick = () => { G.pick = i; renderRiddles(); $('#guessInput').focus(); };
    box.appendChild(d);
  });
  const r = G.riddles[G.pick];
  $('#guessInput').placeholder = r ? '回答：' + r.q : '用一句话说出来';
  $('#guessInput').disabled = !r || r.solved;
}

/* ================= 结算 ================= */

async function doGuess(){
  const guess = $('#guessInput').value.trim();
  if (!guess || G.busy || G.ended) return;
  $('#guessModal').classList.add('hidden');
  say('› ' + guess, 'sys');
  busy(true, '……');

  const rid = G.riddles[G.pick];
  if (!rid || rid.solved) return;

  let v;
  try{
    v = await LLM.verdict(G.gen, { question: rid.q, answer: rid.sealed }, guess, G.history);
  }catch(err){
    say('（它没有回应：' + err.message + '）', 'sys');
    busy(false); return;
  }
  busy(false);

  G.attempts.push({ q: rid.q, guess, closeness: v.closeness | 0, hit: !!v.hit });
  G.history.push(`他答「${rid.q}」：${guess}——${v.hit ? '对了' : '没对'}`);

  const c = LLM.censor(deId(v.line));
  G.censored += c.count;
  say(c.html, 'it', G.gen.place.slice(0, 12));

  if (v.hit){
    rid.solved = true;

    if (rid.core){                       // 核心题答对 → 这一局结束
      G.ended = true;
      clearTimeout(idleTimer);
      $('#cmd').disabled = true;
      refreshGuessBtn();
      await sleep(1600);
      reveal(guess, v);
      return;
    }

    /* 次要题答对 → 撬开它一点。这是次要题存在的意义。 */
    logAct('答对了：' + rid.q);
    G.trust = Math.min(100, G.trust + 25);
    renderTrust();
    await maybeGrant();
    await sleep(500);
    say(`你答对了。它对你松了一点。（还剩 ${G.riddles.filter(x => !x.solved).length} 道没答）`, 'sys');
    busy(false);
    return;
  }

  /* 没说中：它收回注意力一段时间。这一局继续，你接着查就是了。 */
  await sleep(700);
  showTemp(v.closeness | 0);
  const wait = COOL_BASE + COOL_STEP * (G.attempts.length - 1);
  G.coolUntil = Date.now() + wait * 1000;
  refreshGuessBtn();
  say(`它把注意力收回去了，${wait} 秒内不会再听你说话。这段时间它照样在这儿——接着查。`, 'sys');
  busy(false);
}

/* 冷热提示：不给答案，只给方向 */
function showTemp(n){
  const label = n >= 75 ? '很近了' : n >= 50 ? '沾到边了' : n >= 25 ? '还差得远' : '完全不在这个方向上';
  const e = document.createElement('div');
  e.className = 'entry temp';
  e.innerHTML = `<div class="src">你的判断</div>
    <div class="bar"><i style="width:${Math.max(3, Math.min(100, n))}%"></i></div>
    <p>${label}</p>`;
  $('#feed').appendChild(e);
  $('#feed').scrollTop = 1e9;
}

/* 放弃：直接揭晓，不判定 */
async function giveUp(){
  if (G.ended || !G.gen) return;
  $('#guessModal').classList.add('hidden');
  G.ended = true;
  clearTimeout(idleTimer);
  $('#cmd').disabled = true;
  refreshGuessBtn();
  say('你不再猜了。', 'sys');
  await sleep(900);
  reveal(null, { hit:false, closeness:0, internal:'（你没有让它说完。）' });
}

function reveal(guess, v){
  const gaveUp = guess === null;
  $('#endTitle').textContent = v.hit ? '你说中了' : gaveUp ? '你放弃了' : '你没说中';
  saveRunMemory(!!v.hit);

  /* 它对你撒过几次谎：拿它当时那一票，跟它自己封存的实情对。 */
  const lies = G.board.filter(r =>
    (r.truth && r.itSaid === '不是') || (!r.truth && r.itSaid === '是')).length;
  const trues = G.board.filter(r => r.truth).length;

  /* 场上每一件东西的算盘，开局就封存了，现在一起摊开。
     玩家回头看自己那张表，才知道哪几行是被谁骗的。 */
  const minds = G.cast.length ? `<div class="reveal">
    <div class="rl">场上一共有 ${G.cast.length} 个想法。你以为你在跟一样东西打交道。</div>
    ${G.cast.map(h => `<div class="mind${h.witness ? ' wit' : ''}">
      <span class="mn">${escapeHtml(h.name)}</span>
      <span class="mt t-${escapeHtml(h.toward || '')}">${escapeHtml(h.witness ? '不归它管' : h.toward || '')}</span>
      <span class="mw">${escapeHtml(h.mind || '')}</span>
      ${h.slip ? `<div class="ms">它一直捏着：${escapeHtml(h.slip)}</div>` : ''}
    </div>`).join('')}</div>` : '';

  const stats = G.board.length ? `<div class="reveal">
    <div class="rl">你说过 ${G.board.length} 句话</div>
    <div class="rt">其中 ${trues} 句是真的。它当着你的面否认了 ${lies} 次。</div></div>` : '';

  const tries = G.attempts.length
    ? `<div class="reveal"><div class="rl">你一共猜了 ${G.attempts.length} 次</div>
        <div class="mono dim" style="white-space:pre-wrap">${
          G.attempts.map((a, i) => `${i + 1}. [${escapeHtml((a.q || '').slice(0, 12))}] ${escapeHtml(a.guess)}　${a.hit ? '✓' : a.closeness}`).join('\n')
        }</div></div>`
    : '';

  $('#endBody').innerHTML = `
    <div class="reveal"><div class="rl">它在这一局开始之前就写好的全部答案，封存至今</div>
      ${G.riddles.map(r => `<div class="ans${r.core ? ' core' : ''}${r.solved ? ' got' : ''}">
        <div class="aq">${r.solved ? '✓' : '　'} ${escapeHtml(r.q)}</div>
        <div class="aa">${escapeHtml(r.sealed)}</div></div>`).join('')}</div>
    ${minds}
    ${stats}
    ${tries}
    <div class="reveal"><div class="rl">${G.granted ? '你让它松了口，它给你看的那件事' : '它本来愿意让你看的那件事——你没能让它开口'}</div>
      <div class="rt">${escapeHtml(G.gen.concession || '')}</div></div>
    <div class="reveal"><div class="rl">本来能让它松口的是</div>
      <div class="rt">${escapeHtml(G.gen.condition || '')}</div></div>
    <div class="reveal"><div class="rl">它为什么说不出口</div>
      <div class="rt">${escapeHtml(G.gen.why_silent)}</div></div>
    <div class="reveal"><div class="rl">它没说出口的</div>
      <div class="rt" style="white-space:pre-wrap">${escapeHtml(v.internal)}</div></div>
    <div class="reveal"><div class="rl">这个地方，和它的往事</div>
      <div class="rt" style="white-space:pre-wrap">${escapeHtml(G.gen.past)}</div></div>
    <div class="reveal"><div class="rl">它说出口的话里，被抹掉了 ${G.censored} 处</div></div>`;
  $('#endModal').classList.remove('hidden');
}

const escapeHtml = s => String(s).replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m]));

/* ================= 开局 ================= */

const BOOT_LINES = [
  '……',
  '',
  '有动静',
  '有人进来了　1',
  '',
  '上一次有人进来是很久以前',
  '正在回想这是什么地方',
  '正在回想这里出过什么事',
  '正在回想我是什么',
  '',
  '正在决定让他看见多少',
  '正在决定要不要理他',
]

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
  // 自检播完之后继续走秒——生成要二十秒，不能让画面看起来像死了
  const tail = document.createElement('div');
  tail.className = 'blink';
  b.appendChild(tail);
  const t0 = Date.now();
  const dots = ['', '.', '..', '...'];
  let i = 0;
  while (!bootStop){
    const s = Math.floor((Date.now() - t0) / 1000);
    tail.textContent = `正在决定该拿他怎么办${dots[i++ % 4]}　${s}s`;
    await sleep(420);
  }
}

function bootDone(){
  bootStop = true;
  $('#boot').classList.add('hidden');
}

async function newRun(){
  if (!LLM.online()){
    $('#feed').innerHTML = '';
    say('没有接入模型。', 'sys');
    say('这个游戏里的一切——这是什么地方、发生过什么、它想要什么、你眼前的整幅画面——都是它在开局时自己想出来的。没有模型，什么都不会发生。\n\n右上角「设置」填入 API Key。');
    $('#boot').classList.add('hidden');
    return;
  }

  Object.assign(G, {
    gen:null, sealed:null, scene:{ elements:[] }, hotspots:{},
    cast:[], board:[], qi:0, ledger:[], sinceStir:0, stirring:false, stirLog:[],
    history:[], note:'', acts:[], attempts:[], riddles:[], pick:0, coolUntil:0,
    trust:0, granted:false, stirs:0, lastAct:Date.now(), focus:null, ended:false, censored:0,
  });
  renderBoard();
  $('#feed').innerHTML = '';
  $('#scene').innerHTML = '';
  $('#clueList').innerHTML = '<span class="empty">—</span>';
  $('#objName').textContent = '—';
  refreshGuessBtn();
  $('#placeName').textContent = '正在生成';
  $('#focusTag').classList.add('hidden');
  $('#cmd').disabled = true;

  bootAnim();
  const seed = Math.floor(Math.random() * 1e6) + '-' + Date.now().toString(36);

  let g;
  const t0 = Date.now();
  try{
    console.log('[genesis] 开始', LLM.cfg.model, LLM.cfg.endpoint);
    g = await Promise.race([
      LLM.genesis(seed),
      sleep(120000).then(() => { throw new Error('超过 120 秒没有响应'); }),
    ]);
    console.log(`[genesis] 完成 ${((Date.now()-t0)/1000).toFixed(1)}s`, g);
  }catch(err){
    bootDone();
    console.error('[genesis] 失败', err);
    say('生成失败：' + err.message, 'sys');
    say('按右上角「重开一局」再试一次。如果一直失败，打开浏览器控制台（F12）看红色报错，多半是 Key 不对或者网络不通。');
    return;
  }

  if (!g.scene?.elements?.length){
    bootDone();
    console.warn('[genesis] 没有图元', g);
    say('它这一局没有画出画面。按「重开一局」再试。', 'sys');
    return;
  }
  await sleep(300);

  /* —— 代码唯一的强制力：把它写下的东西封存 —— */
  G.gen = g;
  G.sealed = String(g.intent);   // 封存：拷贝一份，之后只在结算时读

  /* 核心题永远在第一位；其余是它这一局自己出的 */
  G.riddles = [
    { q: FINAL_QUESTION, sealed: String(g.intent), core: true, solved: false },
    ...(g.riddles || []).slice(0, 3).map(r => ({
      q: String(r.question || '').trim(),
      sealed: String(r.answer || '').trim(),
      core: false, solved: false,
    })).filter(r => r.q && r.sealed),
  ];
  G.pick = 0;

  G.scene = g.scene;
  /* 只保留真的画在场上的那些——模型偶尔会给一个不存在的 id */
  const drawn = new Set(g.scene.elements.map(e => e.id));
  G.cast = (g.hotspots || []).filter(h => drawn.has(h.id));
  G.hotspots = Object.fromEntries(G.cast.map(h => [h.id, h]));
  ledger('他进来了。场上有：' + G.cast.map(h => h.name).join('、'));

  bootDone();
  G.lastAct = Date.now();
  denied = false;
  renderTrust();
  renderBoard();
  $('#placeName').textContent = (g.place || '').split(/[。，,]/)[0].slice(0, 22);
  drawScene();
  refreshGuessBtn();
  say(g.opening);
  await sleep(400);
  say('你只能做一件事：说出一句你认为是真的话。\n场上每一件东西会各自回答 是／不是／无关，或者答不上来。\n它们互相不合，谁都可能骗你——只有角落里那一件不会。', 'sys');
  scheduleStir();
  $('#cmd').disabled = false;
  $('#cmd').focus();
  console.log('[封存]', G.sealed, '\n[往事]', g.past);
}


/* ================= 渲染自检 =================
   打开 index.html?demo 直接看图元长什么样，不调 API、不等生成。
   用来单独验证画面这一层。 */

const DEMO = {
  place:'渲染自检（未调用模型）',
  opening:'这不是一局游戏，是把十四种图元一次性摆出来看看。\n点画面上的东西可以观察。想玩真的，去掉网址末尾的 ?demo。',
  scene:{ elements:[
    { id:'light1', kind:'light',  x:120, y:24,  w:70,  h:10 },
    { id:'light2', kind:'light',  x:330, y:24,  w:70,  h:10, on:false },
    { id:'light3', kind:'light',  x:540, y:24,  w:70,  h:10 },
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
  hotspots:[
    { id:'panel1', name:'控制面板', toward:'帮它',   mind:'想让读数一直好看', slip:'（自检）',
      look:'屏幕泛着绿光。温度读数在缓慢漂移。下面一排按键没有任何标识，只有磨损。' },
    { id:'door1',  name:'铁门',     toward:'恨它',   mind:'想被人从外面打开', slip:'（自检）',
      look:'门把手上凝着冰粒。锁舌的位置被焊了一颗螺栓，从里面封死的。' },
    { id:'man',    name:'影子',     toward:'不在乎', mind:'想等到天亮',       slip:'（自检）',
      look:'墙上有一片颜色更深的地方，形状像一个站了很久的人。' },
    { id:'block',  name:'？',       toward:'想取代它', mind:'想让人以为它才是这里说了算的', slip:'（自检）',
      look:'这一块你看不见。它不让你看。' },
    { id:'crate',  name:'货箱',     toward:'不在乎', mind:'想被搬走',         slip:'（自检）',
      look:'纸箱受过潮，底边发黑，堆放的批号全都一样。' },
    { id:'stn',    name:'地上那摊', witness:true, toward:'不在乎', mind:WITNESS_MIND, slip:'',
      look:'一摊干掉很久的东西。边缘一圈更深的印子，说明它以前更大。没人擦过它。' },
  ],
  past:'（自检模式，没有往事。）',
  intent:'（自检模式，没有封存内容。）',
  why_silent:'（自检模式。）',
};

function runDemo(){
  bootDone();
  G.gen = DEMO;
  G.sealed = DEMO.intent;
  G.scene = DEMO.scene;
  G.cast = DEMO.hotspots;
  G.hotspots = Object.fromEntries(DEMO.hotspots.map(h => [h.id, h]));
  $('#placeName').textContent = '渲染自检';
  drawScene();

  /* 顺便把真值表也摆出来看看 —— 不调 API。
     分布照实战来：大半是「无关」，「不能说」很稀有。 */
  DEMO_CLAIMS.forEach(([claim, ...vs]) => {
    const verdicts = {};
    G.cast.forEach((c, j) => { verdicts[c.id] = vs[j] || '无关'; });
    verdicts['__it__'] = vs[G.cast.length] || '无关';
    G.board.push({ claim, verdicts, gone:{}, truth:true, itSaid: verdicts['__it__'] });
  });
  G.board[2].gone['door1'] = true;      // 它涂掉过一格
  renderBoard();

  say(DEMO.opening);
  say('图元清单：' + Render.KINDS.join('、'), 'sys');
  $('#cmd').disabled = true;
  $('#cmd').placeholder = '自检模式不接受输入';
}

/* 一句话 + 每一件东西的裁决（顺序照 DEMO.hotspots，最后一个是「它」） */
const DEMO_CLAIMS = [
  ['这扇门是从里面焊死的',        '无关','是','无关','无关','无关','是','不是'],
  ['这里的温度从来没到过标称值',  '不是','无关','无关','无关','是','是','不是'],
  ['货箱里装的不是货',            '无关','不是','无关','不能说','是','无关','不是'],
  ['墙上那个影子是有人站出来的',  '无关','无关','不能说','无关','无关','是','无关'],
  ['那天夜里这里只来过一个人',    '无关','是','无关','不是','无关','是','是'],
];

/* ================= 启动 ================= */

/* 全是陈述句。玩家第一眼就得知道这里要填什么。 */
const PLACEHOLDERS = [
  '说出一句你认为是真的话',
  '那扇门是从里面锁上的',
  '这里以前不是干这个的',
  '你在等的那个人不会来了',
  '它们当中有一件在替你撒谎',
  '这件事发生的时候，你在场',
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
  $('#focusTag').onclick = clearFocus;

  $('#btnGuess').onclick = () => {
    if (!G.gen || G.ended || coolLeft() > 0) return;
    $('#guessInput').value = '';
    renderRiddles();
    $('#guessModal').classList.remove('hidden');
    $('#guessInput').focus();
  };
  $('#guessGo').onclick = doGuess;
  $('#giveUp').onclick = giveUp;
  $('#guessInput').addEventListener('keydown', e => { if (e.key === 'Enter') doGuess(); });

  $('#btnNew').onclick = newRun;
  $('#endAgain').onclick = () => { $('#endModal').classList.add('hidden'); newRun(); };

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

/* QA 用：?auto=第一句|第二句　开局跑完之后自动说几句，
   用来截真实一局的图，不用手打。 */
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
