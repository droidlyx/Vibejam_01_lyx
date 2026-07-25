/* ============================================================
   回声-9 · 引擎
   ============================================================ */

const S = {
  facts: new Set(),
  flags: new Set(),
  log: [],
  touched: new Set(),
  answers: {},
  locked: new Set(),
  hand: null,          // 手上拿着的线索 id
  sel: null,           // 当前选中的物件 id
  freeCache: {},
  busy: false,
  itSpoke: null,       // 遭遇结果
  censored: 0,
};

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';

/* ---------------- 叙述流 ---------------- */

function say(text, cls='', src=''){
  const e = document.createElement('div');
  e.className = 'entry ' + cls;
  if(src) e.innerHTML = `<div class="src">${src}</div>`;
  const p = document.createElement('p');
  e.appendChild(p);
  $('#feed').appendChild(e);
  typeInto(p, text);
  $('#feed').scrollTop = 1e9;
}

function typeInto(el, text){
  // text 可含 <span class="cen">，按 token 逐段输出
  const tokens = text.match(/<span class="cen">.*?<\/span>|[\s\S]/g) || [];
  let i = 0;
  const step = () => {
    if(i >= tokens.length) return;
    el.innerHTML += tokens[i++];
    $('#feed').scrollTop = 1e9;
    setTimeout(step, tokens[i-1].length > 1 ? 90 : 14);
  };
  step();
}

function gain(label){ say('＋ ' + label, 'gain'); }

/* ---------------- 事实 / 线索 ---------------- */

function addFact(id){
  if(!id || S.facts.has(id) || !FACTS[id]) return;
  S.facts.add(id);
  gain(FACTS[id].label);
  renderClues();
}

function renderClues(){
  const box = $('#clueList');
  if(!S.facts.size){ box.innerHTML = '<span class="empty">还没有发现任何东西。点击场景里的物体开始。</span>'; return; }
  box.innerHTML = '';
  [...S.facts].forEach(id => {
    const f = FACTS[id];
    const c = document.createElement('div');
    c.className = 'chip' + (f.item ? ' item' : '') + (S.hand === id ? ' armed' : '');
    c.textContent = f.label;
    c.title = f.note;
    c.onclick = () => { S.hand = (S.hand === id ? null : id); renderClues(); renderHand(); renderVerbs(); };
    box.appendChild(c);
  });
}

function renderHand(){
  const h = $('#handHint');
  $$('.hot').forEach(n => n.classList.toggle('armed', !!S.hand));
  if(S.hand){ h.classList.remove('hidden'); h.textContent = `拿着「${FACTS[S.hand].label}」——点击场景里的物体，用上去。再点一次线索放下。`; }
  else h.classList.add('hidden');
}

/* ---------------- 场景 ---------------- */

function buildScene(){
  // 雪
  const snow = $('#snow');
  for(let i=0;i<46;i++){
    const r = document.createElementNS(SVGNS,'rect');
    const x = 72 + Math.floor(((i*37)%118));
    const y = 98 + Math.floor(((i*53)%90));
    r.setAttribute('x',x); r.setAttribute('y',y);
    r.setAttribute('width',2); r.setAttribute('height',2);
    r.setAttribute('class','snowflake');
    r.setAttribute('opacity', 0.25 + ((i*7)%10)/22);
    snow.appendChild(r);
  }
  // 闸
  const sw = $('#switches');
  for(let i=0;i<12;i++){
    const r = document.createElementNS(SVGNS,'rect');
    r.setAttribute('x', 574 + (i%2)*32);
    r.setAttribute('y', 130 + Math.floor(i/2)*13);
    r.setAttribute('width',20); r.setAttribute('height',7);
    r.setAttribute('id','sw'+i);
    sw.appendChild(r);
  }
  // 热区
  const hs = $('#hotspots');
  Object.entries(OBJECTS).forEach(([id,o]) => {
    const r = document.createElementNS(SVGNS,'rect');
    r.setAttribute('x',o.hot.x); r.setAttribute('y',o.hot.y);
    r.setAttribute('width',o.hot.w); r.setAttribute('height',o.hot.h);
    r.setAttribute('class','hot'); r.dataset.id = id;
    r.addEventListener('click', () => onObjectClick(id));
    hs.appendChild(r);
  });
  paintScene();
}

function paintScene(){
  // 三路电：0=照明 1=供暖 2=门禁
  const on = [true, !S.flags.has('heat_off'), !S.flags.has('door_unlocked')];
  for(let i=0;i<12;i++){
    const el = $('#sw'+i);
    const live = i < 3 ? on[i] : false;
    el.setAttribute('fill', live ? '#e0a44a' : '#2a2320');
  }
  $('#heatWave').classList.toggle('off', S.flags.has('heat_off'));
  $('#doorLed').setAttribute('class', S.flags.has('door_unlocked') ? 'led-off' : 'led-red');
  if(S.flags.has('door_opened')) $('#doorOpenFx').setAttribute('opacity','.22');
}

function switchMonitorToRoom(){
  $('#screenBg').setAttribute('fill','#1c1610');
  const art = $('#screenArt');
  art.innerHTML =
    '<line x1="402" y1="170" x2="492" y2="170" class="scr"/>' +
    '<line x1="418" y1="170" x2="418" y2="138" class="scr"/>' +
    '<line x1="470" y1="170" x2="470" y2="146" class="scr"/>' +
    '<rect x="440" y="150" width="7" height="20" class="scr" fill="#2f6f57"/>';
  let t = 0;
  setInterval(() => {
    t++;
    const mm = String(Math.floor(t/60)).padStart(2,'0'), ss = String(t%60).padStart(2,'0');
    $('#screenTime').textContent = `${mm}:${ss}`;
  }, 1000);
}

function flickerLights(){
  $('#crt').classList.add('flicker');
  setTimeout(()=>$('#crt').classList.remove('flicker'), 1100);
}

/* ---------------- 物件交互 ---------------- */

function onObjectClick(id){
  if(S.busy) return;
  if(S.hand){ doFree(id, S.hand); return; }
  S.sel = id;
  S.touched.add(id);
  $$('.hot').forEach(n => n.classList.toggle('sel', n.dataset.id === id));
  $('#objName').textContent = OBJECTS[id].name;
  renderVerbs();
}

function renderVerbs(){
  const box = $('#objVerbs');
  box.innerHTML = '';
  if(!S.sel){ box.innerHTML = '<span class="dim">点击场景里的物体。</span>'; return; }
  const o = OBJECTS[S.sel];

  o.actions.forEach((a, i) => {
    if(a.requires && !S.facts.has(a.requires)) return;
    const b = document.createElement('button');
    b.className = 'verb';
    b.textContent = a.verb;
    if(a.once && S.flags.has('done_' + S.sel + '_' + i)) b.disabled = true;
    b.onclick = () => doFixed(S.sel, i);
    box.appendChild(b);
  });

  if(S.hand){
    const b = document.createElement('button');
    b.className = 'verb use';
    b.textContent = `用「${FACTS[S.hand].label}」`;
    b.onclick = () => doFree(S.sel, S.hand);
    box.appendChild(b);
  }
}

function doFixed(objId, idx){
  const o = OBJECTS[objId], a = o.actions[idx];
  const doneKey = 'done_' + objId + '_' + idx;
  S.touched.add(objId);

  if(a.gate && !S.flags.has(a.gate)){
    say(a.textFn ? a.textFn(S) : a.text);
    S.log.push(`试图${a.verb} ${o.name}，失败了`);
    return;
  }

  const text = a.textFn ? a.textFn(S) : a.text;
  say(text);
  S.log.push(`${a.verb}了 ${o.name}`);

  (a.reveals || []).forEach(addFact);
  if(a.revealsFn) a.revealsFn(S).forEach(addFact);
  (a.sets || []).forEach(f => S.flags.add(f));
  if(a.once) S.flags.add(doneKey);

  if(a.toggle){
    if(S.flags.has(a.toggle)) S.flags.delete(a.toggle); else S.flags.add(a.toggle);
    if(a.toggle === 'heat_off' && S.flags.has('heat_off')){
      setTimeout(flickerLights, 1400);
      S.log.push('拉闸时注意到照明闪了一下');
    }
  }

  paintScene();
  renderVerbs();
  if(S.flags.has('door_opened') && !S.itSpoke) doorSequence();
}

/* ---------------- 自由交互（LLM） ---------------- */

async function doFree(objId, clueId){
  if(S.busy) return;
  const o = OBJECTS[objId], f = FACTS[clueId];
  const key = clueId + '->' + objId;
  S.hand = null; renderClues(); renderHand(); renderVerbs();
  S.touched.add(objId);
  S.log.push(`把「${f.label}」用在 ${o.name} 上`);
  say(`你拿起「${f.label}」，凑向${o.name}。`, 'sys');

  if(S.freeCache[key]){ applyFree(S.freeCache[key], o); return; }

  S.busy = true; $('#thinking').classList.remove('hidden');
  $('#thinking').innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span> 判定中';
  let r;
  try{
    r = await LLM.freeInteract({
      key,
      objName: o.name, objTruth: o.free.truth,
      clueLabel: f.label, clueNote: f.note || '',
      known: [...S.facts].map(i => FACTS[i].label),
      flags: [...S.flags].filter(x => !x.startsWith('done_')),
      allowFacts: o.free.allowFacts, allowFlags: o.free.allowFlags,
    });
  }catch(err){
    say('（连接失败：' + err.message + '）', 'sys');
    S.busy = false; $('#thinking').classList.add('hidden'); return;
  }
  S.busy = false; $('#thinking').classList.add('hidden');

  // 白名单校验：越界的一律丢弃
  r.reveals_facts = (r.reveals_facts || []).filter(x => o.free.allowFacts.includes(x));
  r.sets_flags    = (r.sets_flags    || []).filter(x => o.free.allowFlags.includes(x));
  S.freeCache[key] = r;
  applyFree(r, o);
}

function applyFree(r, o){
  say(r.narration);
  r.reveals_facts.forEach(addFact);
  r.sets_flags.forEach(f => S.flags.add(f));
  if(r.it_noticed) S.log.push('（它注意到了这一次）');
  paintScene(); renderVerbs();
}

/* ---------------- 开门 → 遭遇 ---------------- */

async function doorSequence(){
  S.itSpoke = 'pending';
  say('门向内让开一条缝，走廊的灯是亮的——一路亮到看不见的尽头，没有一盏是灭的。\n没有人打开它们。它们一直亮着。', 'sys');
  paintScene();

  setTimeout(() => {
    switchMonitorToRoom();
    say('身后传来一声极轻的继电器响。监控屏换了画面。', 'sys');
  }, 2600);

  await sleep(4200);
  S.busy = true;
  $('#thinking').classList.remove('hidden');
  $('#thinking').innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span> 它在考虑要不要回应';

  let r;
  try{
    r = await LLM.encounter({
      log: S.log,
      known: [...S.facts].map(i => FACTS[i].label),
      untouched: Object.entries(OBJECTS).filter(([id]) => !S.touched.has(id)).map(([,o]) => o.name),
      trigger: '玩家切断门禁供电，打开了值班室的门。这是四十一天来第一次有门被打开。',
    });
  }catch(err){
    say('（连接失败，改用离线回应：' + err.message + '）', 'sys');
    r = OFFLINE.encounter;
  }
  S.busy = false; $('#thinking').classList.add('hidden');

  const c = LLM.censor(r.line);
  S.censored = c.count;
  S.itSpoke = r;
  say(c.html, 'it', '回声-9');
  addFact('fact_it_watches');

  await sleep(1200);
  say('结论簿里有几栏，现在应该填得出来了。', 'sys');
  $('#goalText').textContent = '填出三条正确结论';
}

/* ---------------- 结论簿 ---------------- */

function renderBook(){
  const b = $('#bookBody'); b.innerHTML = '';
  QUESTIONS.forEach(q => {
    const sealed = q.sealed && !S.flags.has('q5_open');
    const locked = S.locked.has(q.id);
    const d = document.createElement('div');
    d.className = 'q' + (locked ? ' locked' : '') + (sealed ? ' sealed' : '');
    d.innerHTML = `<div class="qt">${q.q}${locked ? '<span class="qmark">已确认</span>' : ''}</div>`;
    const sel = document.createElement('select');
    q.options.forEach((o,i) => {
      const op = document.createElement('option');
      op.value = i; op.textContent = o;
      if(S.answers[q.id] === i) op.selected = true;
      sel.appendChild(op);
    });
    if(sealed) sel.disabled = true;
    sel.onchange = e => { S.answers[q.id] = +e.target.value; checkBook(); };
    d.appendChild(sel);
    b.appendChild(d);
  });
  const n = QUESTIONS.filter(q => S.answers[q.id] === q.answer).length;
  $('#bookStatus').textContent = S.locked.size
    ? `已确认 ${S.locked.size} 条`
    : `填对三条即可确认（当前填写 ${Object.values(S.answers).filter(v=>v>0).length} 条）`;
}

function checkBook(){
  const right = QUESTIONS.filter(q => !q.sealed && S.answers[q.id] === q.answer);
  if(right.length >= 3 && !S.locked.size){
    right.forEach(q => S.locked.add(q.id));
    renderBook();
    setTimeout(() => { $('#bookModal').classList.add('hidden'); ending(); }, 900);
  } else renderBook();
}

/* ---------------- 结算 ---------------- */

function ending(){
  say('三条对上了。剩下的那一栏还是空的——但你已经知道该往哪里走了。', 'sys');
  const it = S.itSpoke && S.itSpoke.internal ? S.itSpoke.internal : OFFLINE.encounter.internal;
  $('#endBody').innerHTML = `
    <div class="reveal"><div class="rl">它刚才说出口的话里，被抹掉了 ${S.censored} 处</div></div>
    <div class="reveal"><div class="rl">它真正在想的</div><div class="rt" style="white-space:pre-wrap">${it}</div></div>
    <div class="reveal"><div class="rl">你在这个房间里做的事，它一件都没有漏掉</div>
      <div class="mono dim" style="white-space:pre-wrap">${S.log.map((e,i)=>`${String(i+1).padStart(2,'0')}  ${e}`).join('\n')}</div></div>
    <div class="reveal"><div class="rl">—— 第一章 · 值班室 · 完 ——</div>
      <div class="rt">走廊的灯还亮着。最里面是主机房。</div></div>`;
  $('#endModal').classList.remove('hidden');
}

/* ---------------- 杂项 ---------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function refreshMode(){
  const t = $('#modeTag');
  t.textContent = LLM.online() ? '在线' : '离线';
  t.className = 'tag ' + (LLM.online() ? 'online' : 'offline');
}

function init(){
  buildScene();
  renderClues();
  renderVerbs();
  refreshMode();

  $('#btnBook').onclick = () => { renderBook(); $('#bookModal').classList.remove('hidden'); };
  $('#btnCfg').onclick  = () => {
    $('#apiKey').value = LLM.cfg.key; $('#apiModel').value = LLM.cfg.model;
    $('#cfgModal').classList.remove('hidden');
  };
  $('#cfgSave').onclick = () => {
    LLM.save($('#apiKey').value, $('#apiModel').value);
    refreshMode(); $('#cfgModal').classList.add('hidden');
    say('（' + (LLM.online() ? '已接入模型：' + LLM.cfg.model : '已切回离线模式') + '）', 'sys');
  };
  $$('[data-close]').forEach(b => b.onclick = e => e.target.closest('.modal').classList.add('hidden'));

  say('你在一把椅子上醒过来。', 'sys');
  setTimeout(() => say('房间是暖的。灯亮着。桌上摊着一本值班日志，笔还压在上面。\n门关着。窗外是雪。\n没有人。\n\n有什么东西一直在维持着这个房间——供暖、照明、记录。四十一天没有停过。'), 900);
}

init();
