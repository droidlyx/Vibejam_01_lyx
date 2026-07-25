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
  if (!guess || G.busy) return;
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
  G.ended = true;
  $('#cmd').disabled = true;

  const c = LLM.censor(v.line);
  G.censored += c.count;
  say(c.html, 'it', G.gen.place.slice(0, 12));

  await sleep(1500);
  reveal(guess, v);
}

function reveal(guess, v){
  $('#endTitle').textContent = v.hit ? '你说中了' : '你没说中';
  $('#endBody').innerHTML = `
    <div class="reveal"><div class="rl">它在这一局开始之前写下的，封存至今</div>
      <div class="rt big">${G.sealed}</div></div>
    <div class="reveal"><div class="rl">你说的</div><div class="rt">${escapeHtml(guess)}</div></div>
    <div class="reveal"><div class="rl">接近度</div>
      <div class="bar"><i style="width:${Math.max(0, Math.min(100, v.closeness | 0))}%"></i></div></div>
    <div class="reveal"><div class="rl">它为什么说不出口</div><div class="rt">${G.gen.why_silent}</div></div>
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

async function bootAnim(){
  const b = $('#boot');
  b.classList.remove('hidden');
  b.innerHTML = '';
  for (const line of BOOT_LINES){
    const d = document.createElement('div');
    d.textContent = line;
    b.appendChild(d);
    await sleep(line ? 320 + line.length * 22 : 200);
  }
  const d = document.createElement('div');
  d.className = 'blink';
  d.textContent = '…';
  b.appendChild(d);
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
    history:[], note:'', acts:[], focus:null, ended:false, censored:0,
  });
  $('#feed').innerHTML = '';
  $('#scene').innerHTML = '';
  $('#clueList').innerHTML = '<span class="empty">—</span>';
  $('#objName').textContent = '—';
  $('#placeName').textContent = '正在生成';
  $('#focusTag').classList.add('hidden');
  $('#cmd').disabled = true;

  const anim = bootAnim();
  const seed = Math.floor(Math.random() * 1e6) + '-' + Date.now().toString(36);

  let g;
  try{
    g = await LLM.genesis(seed);
  }catch(err){
    $('#boot').classList.add('hidden');
    say('（生成失败：' + err.message + '）', 'sys');
    return;
  }
  await anim;
  await sleep(400);

  /* —— 代码唯一的强制力：把它写下的东西封存 —— */
  G.gen = g;
  G.sealed = g.intent;
  Object.freeze(G.sealed);

  G.scene = g.scene;
  G.hotspots = Object.fromEntries((g.hotspots || []).map(h => [h.id, h]));

  $('#boot').classList.add('hidden');
  $('#placeName').textContent = (g.place || '').split(/[。，,]/)[0].slice(0, 22);
  drawScene();
  say(g.opening);
  $('#cmd').disabled = false;
  $('#cmd').focus();
  console.log('[封存]', G.sealed, '\n[往事]', g.past);
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
    if (!G.gen || G.ended) return;
    $('#guessInput').value = '';
    $('#guessModal').classList.remove('hidden');
    $('#guessInput').focus();
  };
  $('#guessGo').onclick = doGuess;
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

  newRun();
}

init();
