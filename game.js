/* ============================================================
   引擎
   ------------------------------------------------------------
   代码在这一局里只做三件事：
     1. 把它开局写下的 intent 封存起来（它事后改不了口）
     2. 记流水账
     3. 结算时把封存的原文亮出来对照
   它想什么、做什么、说什么谎，代码一概不管。
   ============================================================ */

const G = {
  gen: null,        // 开局产物
  sealed: null,     // 封存的 intent —— 只在结算时才读
  scene: { elements: [] },
  hotspots: {},
  history: [],
  note: '',
  acts: [],         // 它做过的事，给玩家看的流水
  attempts: [],     // 猜过几次
  coolUntil: 0,     // 猜错后的冷却截止时间戳。冷却期间游戏照常，玩家继续查。
  focus: null,
  busy: false,
  ended: false,
  censored: 0,
};

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

/* 观察：零延迟，读的是开局就写好的文本 */
function observe(id){
  const h = G.hotspots[id];
  if (!h) return;
  G.focus = id;
  $('#objName').textContent = h.name;
  $('#focusTag').classList.remove('hidden');
  $('#focusTag').textContent = '◉ ' + h.name + ' ×';
  say(h.look);
  G.history.push('看了 ' + h.name);
  drawScene();
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

/* ================= 行动 ================= */

async function submit(){
  const box = $('#cmd');
  const intent = box.value.trim();
  if (!intent || G.busy || G.ended || !G.gen) return;

  box.value = '';
  say('› ' + intent, 'sys');
  busy(true, '……');

  let r;
  try{
    r = await LLM.act(G.gen, {
      scene: G.scene.elements,
      note: G.note,
      history: G.history,
      intent,
      focus: G.focus ? G.hotspots[G.focus]?.name : null,
    });
  }catch(err){
    say('（没有回应：' + err.message + '）', 'sys');
    busy(false); return;
  }
  busy(false);

  say(r.narration);
  G.history.push(`「${intent}」→ ${r.narration.slice(0, 40)}`);
  G.note = r.note || G.note;


  if (r.scene?.length){
    Render.patch(G.scene, r.scene);
    drawScene();
    logAct(describePatch(r.scene));
  }

  if (r.it_line && r.it_line.trim()){
    await sleep(450);
    const c = LLM.censor(r.it_line.trim());
    G.censored += c.count;
    say(c.html, 'it', G.gen.place.slice(0, 12));
    $('#crt').classList.add('flicker');
    setTimeout(() => $('#crt').classList.remove('flicker'), 700);
  }
}

/* 把它对画面的改动翻成一句人话，摆在底栏——这是玩家能看见的"它自己动了" */
function describePatch(patch){
  const bits = patch.map(p => {
    const h = G.hotspots[p.id];
    const n = h ? h.name : p.id;
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

/* ================= 结算 ================= */

async function doGuess(){
  const guess = $('#guessInput').value.trim();
  if (!guess || G.busy || G.ended) return;
  $('#guessModal').classList.add('hidden');
  say('› ' + guess, 'sys');
  busy(true, '……');

  let v;
  try{
    v = await LLM.verdict(G.gen, guess, G.history);
  }catch(err){
    say('（它没有回应：' + err.message + '）', 'sys');
    busy(false); return;
  }
  busy(false);

  G.attempts.push({ guess, closeness: v.closeness | 0, hit: !!v.hit });
  G.history.push(`他猜：「${guess}」——${v.hit ? '说中了' : '没说中'}`);

  const c = LLM.censor(v.line);
  G.censored += c.count;
  say(c.html, 'it', G.gen.place.slice(0, 12));

  if (v.hit){
    G.ended = true;
    $('#cmd').disabled = true;
    refreshGuessBtn();
    await sleep(1600);
    reveal(guess, v);
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
  $('#cmd').disabled = true;
  refreshGuessBtn();
  say('你不再猜了。', 'sys');
  await sleep(900);
  reveal(null, { hit:false, closeness:0, internal:'（你没有让它说完。）' });
}

function reveal(guess, v){
  const gaveUp = guess === null;
  $('#endTitle').textContent = v.hit ? '你说中了' : gaveUp ? '你放弃了' : '你没说中';

  const tries = G.attempts.length
    ? `<div class="reveal"><div class="rl">你一共猜了 ${G.attempts.length} 次</div>
        <div class="mono dim" style="white-space:pre-wrap">${
          G.attempts.map((a, i) => `${i + 1}. ${escapeHtml(a.guess)}　${a.hit ? '✓' : a.closeness}`).join('\n')
        }</div></div>`
    : '';

  $('#endBody').innerHTML = `
    <div class="reveal"><div class="rl">它在这一局开始之前写下的，封存至今</div>
      <div class="rt big">${escapeHtml(G.sealed)}</div></div>
    ${tries}
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
  'ECHO 控制中枢　自检',
  '电源母线……正常',
  '温控回路……正常',
  '照明回路……正常',
  '记录单元……正常',
  '对外通信……无信号',
  '发声模块……',
  '发声模块……未找到',
  '',
  '检测到未登记人员　1',
  '',
  '正在决定该拿他怎么办',
];

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
    history:[], note:'', acts:[], attempts:[], coolUntil:0, focus:null, ended:false, censored:0,
  });
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

  G.scene = g.scene;
  G.hotspots = Object.fromEntries((g.hotspots || []).map(h => [h.id, h]));

  bootDone();
  $('#placeName').textContent = (g.place || '').split(/[。，,]/)[0].slice(0, 22);
  drawScene();
  refreshGuessBtn();
  say(g.opening);
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
    { id:'panel1', name:'控制面板', look:'屏幕泛着绿光。温度读数在缓慢漂移。下面一排按键没有任何标识，只有磨损。' },
    { id:'door1',  name:'铁门',     look:'门把手上凝着冰粒。锁舌的位置被焊了一颗螺栓，从里面封死的。' },
    { id:'man',    name:'影子',     look:'墙上有一片颜色更深的地方，形状像一个站了很久的人。' },
    { id:'block',  name:'？',       look:'这一块你看不见。它不让你看。' },
    { id:'crate',  name:'货箱',     look:'纸箱受过潮，底边发黑，堆放的批号全都一样。' },
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
  G.hotspots = Object.fromEntries(DEMO.hotspots.map(h => [h.id, h]));
  $('#placeName').textContent = '渲染自检';
  drawScene();
  say(DEMO.opening);
  say('图元清单：' + Render.KINDS.join('、'), 'sys');
  $('#cmd').disabled = true;
  $('#cmd').placeholder = '自检模式不接受输入';
}

/* ================= 启动 ================= */

const PLACEHOLDERS = [
  '你想做什么？',
  '推开那扇门',
  '对它说话',
  '把手放在屏幕上',
  '大声问：你是谁',
  '什么都不做，等着',
];

function refreshMode(){
  const t = $('#modeTag');
  t.textContent = LLM.online() ? '在线' : '未接入';
  t.className = 'tag ' + (LLM.online() ? 'online' : 'offline');
}

function init(){
  refreshMode();
  $('#guessQ').textContent = FINAL_QUESTION;

  $('#send').onclick = submit;
  $('#cmd').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  $('#focusTag').onclick = clearFocus;

  $('#btnGuess').onclick = () => {
    if (!G.gen || G.ended || coolLeft() > 0) return;
    $('#guessInput').value = '';
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
    $('#apiModel').value = LLM.cfg.model;
    $('#apiEndpoint').value = LLM.cfg.endpoint;
    $('#cfgModal').classList.remove('hidden');
  };
  $('#cfgSave').onclick = () => {
    LLM.save($('#apiKey').value, $('#apiModel').value, $('#apiEndpoint').value);
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
  else newRun();
}

init();
