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
  note: '',
  history: [],
  trust: 0,
  granted: false,
  stirs: 0,
  stirLog: [],      // 它自己动过什么，喂回给它——不然它会封第三次同一张嘴
  questioned: {},   // id -> 他点名问过它几次。它自己动的时候从这里面抽人。
  askedCount: 0,    // 攒够几次点名，它就出手一次。按提问算，不按时间。
  itSaid: 0,        // 它开过几次口（只有被点名才算）
  itLied: 0,        // 其中有几次跟实情相反——揭晓时摊给他看
  filter: null,     // 本子上只看某一个证人
  busy: false,
  stirring: false,  // 它自己动那条线是异步的，跟他的输入互不阻塞
  ended: false,
  censored: 0,
};

/* ---------- 它自己那一票 ----------
   它跟证人不一样：**封不了口**（它就是这个地方，它不会缺席），
   但**它会骗人**。以前它每一句都白送一票，那票太便宜了，也太吵。
   现在他得点名花一次才拿得到，而且拿到的有三成不是真的。

   骰子由代码摇，理由跟别处一样：模型自己拿捏"该不该撒谎"，
   要么一次都不撒，要么句句都撒。代码定频率，模型只负责把谎编圆。 */
const IT_LIE = 0.3;

/* 说话的时候它是那个地方（「有田川町」开口了）；
   记账、点名、翻本子的时候它就是「它」——地名太长，塞不进一排名字里。 */
const itName = () => (G.gen?.place || '它').replace(/[，,。、\s]+$/, '').slice(0, 12);
const IT_TAG = '它';

/* 他有没有在问它自己。「问谁」空着＝问它——这是最省事的写法，
   也是他会自然而然用到的写法。 */
function wantsIt(who){
  if (!who) return true;
  const p = itName();
  return /(^|[、,，;；\s])(它|你|它自己|你自己|这地方|这里|这个地方)([、,，;；\s]|$)/.test(who)
      || (p.length >= 2 && who.includes(p));
}

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

/* 一个证人的回答：名字 + 裁决 + 它说的话（可能一个字都没有）。
   裁决必须**在对话里**看得见——它才是这个游戏的证据，
   本子是拿来回头对账的，不是拿来第一次读到它的。 */
function sayVoice(name, verdict, html, cls = 'obj'){
  const key = Object.keys(VERDICTS).find(k => VERDICTS[k].key === verdict);
  const d = VERDICTS[key] || VERDICTS.na;
  const e = document.createElement('div');
  e.className = 'entry ' + cls + (html ? '' : ' bare');
  e.innerHTML = `<div class="src">${escapeHtml(name)}<span class="vb ${d.cls}">${d.key}</span></div>`;
  const p = document.createElement('p');
  e.appendChild(p);
  $('#feed').appendChild(e);
  if (html) typeInto(p, html);
  else p.innerHTML = `<span class="nosay">${
    verdict === '不能说' ? '——一个字都没有' : '——只给了这一个字'}</span>`;
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

/* 等回话的那几秒，得让他看见谁正在开口。
   舞台底下那三个点太远了——他的眼睛在右边这一栏上，提示就得落在这里。 */
function pending(text){
  const e = document.createElement('div');
  e.className = 'entry sys pend';
  e.innerHTML = `<p><span class="dot"></span><span class="dot"></span><span class="dot"></span> ${escapeHtml(text)}</p>`;
  $('#feed').appendChild(e);
  $('#feed').scrollTop = 1e9;
  return () => e.remove();
}

function busy(on, label){
  G.busy = on;
  $('#cmd').disabled = $('#who').disabled = on || G.ended || !LLM.online();
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
    /* 它自己也要能单独筛出来——把它说过的话排成一列，才看得出哪几句对不上 */
    `<span class="cchip itchip${G.filter === '__it__' ? ' on' : ''}" data-id="__it__">${IT_TAG}</span>` +
    G.cast.map(h => {
      const dead = G.silenced.includes(h.id);
      return `<span class="cchip${G.filter === h.id ? ' on' : ''}${dead ? ' dead' : ''}" data-id="${escapeHtml(h.id)}"
        title="${escapeHtml(h.stake || '')}">${dead ? '✕' : ''}${escapeHtml(h.name)}</span>`;
    }).join('');
  $('#sheetCast').querySelectorAll('.cchip').forEach(el => {
    el.onclick = () => { G.filter = el.dataset.id || null; renderSheet(); };
  });

  /* 选中某个证人时，先把它是什么摆出来 */
  const f = G.filter && G.filter !== '__it__' && G.cast.find(h => h.id === G.filter);
  $('#sheetWho').innerHTML =
    G.filter === '__it__'
      ? `<div class="who"><b>${escapeHtml(itName())}</b><span class="wt">它自己</span>
          <span class="ws">封不了口，你随时问得到——但它答的话里有假的</span></div>`
      : f
      ? `<div class="who"><b>${escapeHtml(f.name)}</b><span class="wt">${escapeHtml(f.what || '')}</span>
          <span class="ws">${escapeHtml(f.stake || '')}</span>
          ${G.silenced.includes(f.id) ? '<span class="wd">它已经不说话了</span>' : ''}
         </div><div class="wl">${escapeHtml(f.look || '')}</div>`
      : '';

  if (!G.board.length){
    $('#sheetBoard').innerHTML = '<div class="bempty">你问过的每一句，和当时每一个人的回答，都会记在这里。</div>';
    return;
  }

  /* 筛「它」的时候，证人那几行全不要——只留下它自己说过的话 */
  const who = G.filter ? G.cast.filter(h => h.id === G.filter) : G.cast;
  /* 筛某一个的时候，它没被问到的那几句直接不显示——那些跟它无关 */
  const rows = G.board.map((row, i) => ({ row, i }))
    .filter(({ row }) => !G.filter || row.verdicts[G.filter]);
  if (!rows.length){
    $('#sheetBoard').innerHTML = '<div class="bempty">你还没问过它。</div>';
    return;
  }
  $('#sheetBoard').innerHTML = rows.map(({ row, i }) => {
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
    /* 它只有被点名那几句才有一格。没问过它的那些句子，这一行就不该在——
       跟证人一个待遇。 */
    const itV = row.verdicts['__it__'];
    const itD = VERDICTS[Object.keys(VERDICTS).find(k => VERDICTS[k].key === itV)] || VERDICTS.na;
    return `<div class="qblock"><div class="qh"><b>${i + 1}</b>${escapeHtml(row.claim)}</div>` +
           lines +
           ((G.filter && G.filter !== '__it__') || !itV ? '' : `<div class="ansrow it"><span class="an">${IT_TAG}</span>` +
             `<span class="av ${itD.cls}">${itD.key}</span>` +
             (row.lines && row.lines['__it__'] ? `<span class="al">${escapeHtml(row.lines['__it__'])}</span>` : '') +
             `</div>`) +
           `</div>`;
  }).join('');
}

/* 输入框底下那一排名字：点一下就填进「问谁」。
   只有三个起手的，剩下靠他自己问出来——所以这一排是会变长的。 */
function renderCastRow(){
  const box = $('#castRow');
  if (!G.cast.length){ box.innerHTML = ''; return; }
  const live = G.cast.filter(h => !G.silenced.includes(h.id));
  const dead = G.cast.filter(h => G.silenced.includes(h.id));

  box.innerHTML =
    /* 它自己也是一张嘴，而且是唯一封不了的那张。摆在最前面，
       因为他随时可以回头问它——代价是它答的话有真有假。 */
    `<span class="nchip itchip" data-n="${IT_TAG}"
        title="${escapeHtml(itName())}　它自己。封不了口，但它会骗你。">${IT_TAG}</span>` +
    live.map(h => `<span class="nchip" data-n="${escapeHtml(h.name)}"
        title="${escapeHtml(h.stake || '')}">${escapeHtml(h.name)}</span>`).join('') +
    `<span class="nhint">点一下填进「问谁」　名单外的直接打字</span>` +
    (dead.length
      ? `<span class="deadgrp"><span class="dl">它封了口</span>` +
        dead.map(h => `<span class="nchip dead" title="${escapeHtml(h.stake || '')}">✕${escapeHtml(h.name)}</span>`).join('') +
        `</span>` : '');

  box.querySelectorAll('.nchip:not(.dead)').forEach(el => {
    el.onclick = () => {
      const f = $('#who');
      const cur = f.value.split(/[、,，\s]+/).filter(Boolean);
      const n = el.dataset.n;
      f.value = (cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n]).join('、');
      el.classList.toggle('on');
      $('#cmd').focus();
    };
  });
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
  const who = $('#who').value.trim();
  if (!said || G.busy || G.ended || !G.gen) return;

  box.value = '';
  say(said, 'claim', who ? `第 ${G.qi + 1} 句　问 ${who}` : `第 ${G.qi + 1} 句　问它自己`);

  /* 它这一票不再白送：他点了它才答，骰子也只在这时候摇。
     点没点它由**代码**认，不由模型认——他写「它周围的空气」，模型多半会
     顺手把 __it__ 也填上，那就等于替他花了一次他没打算花的钱。 */
  const atIt = wantsIt(who);
  const lie = atIt && Math.random() < IT_LIE;

  const drop = pending(who ? `${who} 在想怎么答` : `${itName()} 在想怎么答`);
  busy(true, who ? `${who}……` : '……');

  let r;
  try{
    r = await LLM.ask(G.gen, {
      scene: G.scene.elements, note: G.note,
      cast: G.cast, hook: G.hook, silenced: G.silenced,
      lastRun: lastRunMemory(), board: boardForPrompt(),
      qi: G.qi + 1, trust: G.trust, granted: G.granted, itLie: lie,
    }, { said, who });
  }catch(err){
    drop();
    say('（没有回应：' + err.message + '）', 'sys');
    busy(false); return;
  }
  drop();
  busy(false);

  if (r.valid === false){
    say('这句话没法回答。里面得有一件能判真假的事——问句、说法都行。\n比如「他是自杀的吗」「那扇门是从里面锁上的」「问账房，那天谁签的字」。', 'sys deny');
    say(`没花你的次数（${G.askedCount}／${STIR_EVERY}）`, 'bill');
    return;
  }

  /* 他点名问了席上没有的——它来决定那东西存不存在。
     已经封过口的不许借新名字复活：模型认人（「那个大夫」＝「医生」），
     代码兜底（凡是已封的 id，一律不许再进证人席）。 */
  const joined = await admitNewcomers(r.newcomers);

  /* 换个叫法想撬开封过的口，当面驳回 */
  const hitWall = [];
  for (const id of (r.blocked || [])){
    const h = G.cast.find(c => c.id === id);
    if (h && G.silenced.includes(id)) hitWall.push(h.name);
  }

  /* —— 谁有资格在这一轮开口 ——
     只有他点到的，加上这一轮刚被他叫进来的。模型偶尔会让一个没被点名的
     证人顺嘴接一句——那等于替他花钱，而且花的是他算好了要留着的额度。
     这道闸归代码：嘴的数量是刻度，不是判断。 */
  const allowed = new Set([...(r.addressed || []), ...joined.ids]);
  const voices = (r.voices || []).filter(v => v && v.id && allowed.has(v.id));

  /* —— 谁表了态 ——
     被点到的每一个都要有下落，哪怕它答的是「无关」。 */
  const answered = voices
    .map(v => v.id)
    .filter(id => G.cast.some(c => c.id === id) && !G.silenced.includes(id));
  const uniq = [...new Set(answered)];
  for (const id of uniq) G.questioned[id] = (G.questioned[id] || 0) + 1;

  /* 它自己算一张嘴：点了才答。它封不了自己的口，但它有几成的概率
     在这一票上骗他——骰子是代码摇的（IT_LIE）。 */
  const itV = (atIt && ((r.addressed || []).includes('__it__') || !who))
    ? (r.it?.verdict || '无关') : null;
  const itIn = !!itV;

  /* —— 这一句花掉了多少 ——
     **「无关」不收钱。** 那一档是"我够不着这件事"——他确实拿到了一点地图，
     但没拿到关于这件事的任何裁决。撞在封过的口上、问了个不存在的东西，
     同样不收。只有真给出立场的（是／不是／不能说）才扣额度。 */
  const vmap = Object.fromEntries(voices.map(v => [v.id, v.verdict]));
  const paid = uniq.filter(id => vmap[id] && vmap[id] !== '无关');
  const free = uniq.filter(id => !vmap[id] || vmap[id] === '无关');
  const itPaid = itIn && itV !== '无关';
  G.askedCount += paid.length + (itPaid ? 1 : 0);

  const claim = String(r.claim || said).trim() || said;
  if (claim !== said) say(claim, 'norm', '记作');

  /* —— 记一行 ——
     只有被点名的那几个有裁决。没被问到的这一行就是空的——
     那是他没花在它们身上的机会，本子上要看得出来。 */
  G.qi++;
  const verdicts = {}, lines = {};
  for (const v of voices){
    verdicts[v.id] = v.verdict;
    if (v.line && v.line.trim()) lines[v.id] = deId(v.line.trim());
  }
  /* 封过口的，只要他点了名，那一格就是黑的 */
  for (const id of G.silenced){
    if (id in verdicts || (r.blocked || []).includes(id)){ verdicts[id] = '不能说'; delete lines[id]; }
  }
  if (itIn){
    verdicts['__it__'] = itV;
    if (r.it?.line && r.it.line.trim()) lines['__it__'] = deId(r.it.line.trim());
    G.itSaid++;
    /* 揭晓时要把它骗过几次摊出来。以实情为准，不以骰子为准——
       骰子没让它撒谎，它自己也可能撒。 */
    if ((r.truth && itV === '不是') || (!r.truth && itV === '是')) G.itLied++;
  }
  G.board.push({ who, claim, said, verdicts, lines, truth: !!r.truth, itSaid: itIn ? itV : null });
  refreshSheetBtn();
  renderCastRow();

  G.note = r.note || G.note;
  G.history.push(`他说「${claim}」`);

  /* —— 谁表了态 ——
     **他点到的每一个都要在这儿露一次面**，哪怕它只给了个「无关」、
     哪怕它是被封了口的一格黑。裁决直接挂在名字旁边——
     那是这个游戏的证据本身，不该只躺在本子里等他翻。

     顺序按他点名的顺序来。以前只放三句、还按"跟它唱反调的优先"排，
     那是全场都作答的时代留下的闸；现在只有他点的人会答，那道闸没用了。 */
  const nm = Object.fromEntries(G.cast.map(c => [c.id, c.name]));
  const order = [...(r.addressed || []), ...joined.ids, ...voices.map(v => v.id)];
  for (const id of [...new Set(order)]){
    if (!nm[id]) continue;
    const v = voices.find(x => x.id === id);
    const verdict = G.silenced.includes(id) ? '不能说' : (v && v.verdict);
    if (!verdict) continue;
    await sleep(240);
    const c = (v && v.line && v.line.trim() && !G.silenced.includes(id))
      ? LLM.censor(deId(v.line.trim())) : null;
    if (c) G.censored += c.count;
    sayVoice(nm[id], verdict, c && c.html);
  }
  /* 它只在被点到的时候开口——不然它就是白送他一票 */
  if (itIn){
    await sleep(340);
    const c = (r.it?.line || '').trim() ? LLM.censor(deId(r.it.line.trim())) : null;
    if (c) G.censored += c.count;
    sayVoice(itName(), itV, c && c.html, 'it');
    flick();
  }

  /* —— 回执 ——
     每一句都要给个交代：谁答了、谁没接住、谁封着、哪个不认、花掉几次。
     不给回执，他分不清"没人理他"和"他问了个空"。
     摆在所有回答之后——先听完，再看账。 */
  receipt(paid, free, itIn, itPaid, hitWall, joined, r.targets);

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

/* 他点名问了一个不在席上的东西。存不存在，它说了算——它也可以撒谎。
   返回这一轮真进来的那几个名字，回执里要点到。 */
async function admitNewcomers(list){
  const got = [], no = [], ids = [];
  for (const n of (list || [])){
    if (!n || !n.name) continue;
    if (!n.exists){
      no.push(n.name);
      await sleep(200);
      say(n.line || `没有这么个东西。`, 'sys deny');
      continue;
    }
    const id = String(n.id || '').trim() || ('x' + G.cast.length);
    if (G.cast.some(h => h.id === id)) continue;
    /* 代码兜底：封过的口不许换个名字重新开张。模型认人失手也拦得住。 */
    if (G.silenced.some(sid => sid === id)) continue;
    /* 不设人数上限。想出一个故事里真有位置的新证人，是这一局最难的动作，
       没有理由因为"人够多了"就把它挡回去。膨胀由合理性那道关拦，不由计数拦。 */
    G.cast.push({
      id, name: n.name, what: n.what || '物', stake: n.stake || '',
      look: n.look || '', mind: n.mind || '', toward: n.toward || '不在乎',
      slip: n.slip || '', found: true,
    });
    got.push(n.name); ids.push(id);
    await sleep(200);
    say(`${n.name}　${n.what || ''}　${n.stake || ''}`, 'joined', '进了证人席');
    refreshSheetBtn(); renderCastRow();
  }
  return { got, no, ids };
}

/* ---------- 每一句都给一张回执 ----------
   他按下"问"之后必须当场知道三件事：谁真答了、谁封着、哪个不认。
   这三件里少任何一件，他都会把"它在躲"错读成"游戏卡住了"。 */
function receipt(paid, free, itIn, itPaid, hitWall, joined, targets){
  const nm = Object.fromEntries(G.cast.map(c => [c.id, c.name]));
  const parts = [];
  const took = paid.map(id => nm[id]).filter(Boolean);
  const shrug = free.map(id => nm[id]).filter(Boolean);
  if (itPaid) took.push(IT_TAG);
  else if (itIn) shrug.push(IT_TAG);

  if (took.length)  parts.push(`表了态：${took.join('、')}`);
  if (shrug.length) parts.push(`答「无关」：${shrug.join('、')}（不收你的）`);
  if (hitWall.length)  parts.push(`封着：${hitWall.join('、')}`);
  if (joined.no.length) parts.push(`不认：${joined.no.join('、')}`);
  if (joined.got.length) parts.push(`新进席：${joined.got.join('、')}`);

  const cost = paid.length + (itPaid ? 1 : 0);
  parts.push(cost ? `花掉 ${cost} 次（${G.askedCount}／${STIR_EVERY}）`
                  : `一次都没花（${G.askedCount}／${STIR_EVERY}）`);

  /* 放进来了却没作声——模型偶尔只办入席、忘了让它开口。别让他以为白问了。 */
  if (joined.got.length && !took.length && !shrug.length)
    say(`${joined.got.map(n => `「${n}」`).join('')}刚落座，这一句还没接上——再问一次它就得答。`, 'sys');

  /* 一个下落都没有——模型偶尔会把点名整段吞掉。至少把他点过的名字复述回去，
     让他确认自己没打错字，也确认这一次没花钱。 */
  if (!took.length && !shrug.length && !hitWall.length && !joined.no.length && !joined.got.length){
    const t = (targets || []).filter(x => x && String(x).trim()).slice(0, 4);
    say(t.length
      ? `${t.map(x => `「${x}」`).join('')}——它一个都没认。换个说法，或者换个人。`
      : '你点的那几个，它一个都没认。换个说法，或者换个人。', 'sys deny');
  }

  say(parts.join('　｜　'), 'bill');
}

/* 给模型看的账：他问过什么、花在了谁身上、当时谁怎么答的 */
function boardForPrompt(){
  if (!G.board.length) return '';
  return G.board.slice(-12).map((row, i) => {
    const cells = G.cast
      .filter(c => row.verdicts[c.id])
      .map(c => `${c.name}:${row.verdicts[c.id]}`).join('　') || '（没点名，只有你答了）';
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

/* 一句话问三个人就是三次，额度掉得比想象中快——所以这个数要给得松，
   松到他敢一次点四五个名去比对口供。卡得紧，他就只敢一个一个问，
   那正好把"一次问多个"这件事废掉了。 */
const STIR_EVERY = 10;   // 累计点名到这个数，它出手一次
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

   没过不罚时间——多题一起判本来就难得多，再让他干等就是双重惩罚，
   而且计时器跟这一局别的东西不通货。改成**罚提问额度**：
   摊一次牌等于问了三次，它照样会因此掐掉一张嘴。
   代价和别的东西用同一种货币付。 */

const SHOWDOWN_COST = 3;

function refreshShowBtn(){
  const b = $('#btnShow');
  if (G.ended){ b.disabled = true; b.textContent = '这一局结束了'; return; }
  b.disabled = !G.gen || !G.riddles.length;
  b.textContent = G.attempts ? `摊牌（第 ${G.attempts + 1} 次）` : '摊牌';
}

function openShowdown(){
  if (!G.gen || G.ended) return;
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
    $('#cmd').disabled = $('#who').disabled = true;
    refreshShowBtn();
    await sleep(1600);
    reveal(true, v, hit);
    return;
  }

  /* 没过：只给一条模糊的接近度，不说对了几道，更不说是哪几道。
     代价不是等待，是提问额度——摊一次牌等于问了三次。 */
  await sleep(700);
  showTemp(v.closeness | 0);
  refreshShowBtn();
  say(`不全对。你答案留着，随时可以再摊一次、直接改。\n但这一次摊牌花掉了你三次提问——它又往前挪了一步。`, 'sys');
  G.askedCount += SHOWDOWN_COST;
  maybeStir();
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
  $('#cmd').disabled = $('#who').disabled = true;
  refreshShowBtn();
  say('你不问了。', 'sys');
  await sleep(900);
  reveal(false, { internal:'（你没有让它说完。）' }, {});
}

/* ================= 揭晓 ================= */

function reveal(pass, v, hit){
  $('#endTitle').textContent = pass ? '你把它说通了' : '你没说通';
  saveRunMemory(pass);

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
      <div class="rt">其中 ${trues} 句是真的。${G.itSaid
        ? `你花了 ${G.itSaid} 次去问它自己——它当着你的面骗了你 ${G.itLied} 次。`
        : '你一次都没问过它自己。'}</div></div>` : ''}

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
    board:[], qi:0, riddles:[], answers:{}, attempts:0,
    note:'', history:[], trust:0, granted:false, stirs:0, stirLog:[],
    questioned:{}, askedCount:0, filter:null, ended:false, censored:0,
    itSaid:0, itLied:0,
  });
  $('#feed').innerHTML = '';
  $('#scene').innerHTML = '';
  refreshSheetBtn();
  refreshShowBtn();
  $('#placeName').textContent = '正在生成';
  $('#castRow').innerHTML = '';
  $('#who').value = '';
  $('#cmd').disabled = $('#who').disabled = true;

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
  say('说一句话，**点名要谁回答**：「问账房和遗孀，那天谁签的字」。\n只有你点到的会答 是／不是／无关，或者答不上来——点几个算几次，' +
      '每一句都得决定花在谁身上。\n\n' +
      '起手就这' + G.cast.length + '个：' + G.cast.map(h => h.name).join('、') +
      '。剩下的人得你自己问出来——「问那个当晚值夜的」，它会告诉你有没有这个人。\n\n' +
      '还有它自己：「问谁」空着就是在问它。它封不了自己的口，你随时问得到——' +
      '但它答的话里有真有假。\n\n' +
      '它们互相不合，谁都可能骗你。你点名问得越多，它越可能掐掉其中一张嘴。', 'sys');
  $('#cmd').disabled = $('#who').disabled = false;
  renderCastRow();
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

/* 每一句只有被点名的那几个答——剩下的空着，那是他没花在它们身上的机会。
   [问的谁, 那句话, {id:裁决}, 它自己的裁决] */
/* 第四栏是它自己那一票。**只有点了它才有**——null 表示这一句没花在它身上，
   本子上那一行就没有它。自检页也得照着真规矩摆，不然文档比代码还旧。 */
const DEMO_ROWS = [
  ['遗孀、账房', '那天夜里上船的不止一个人', { widow:'是', purser:'无关' }, null],
  ['更夫',       '他不是自己走下船的',       { watch:'是' },                null],
  ['它',         '你想让我别去数那批货',     {},                            '不是'],
  ['账房、遗孀、港口', '账房那天动过签收簿',  { purser:'不是', widow:'是', port:'无关' }, null],
  ['宁远号、更夫', '那条船当晚根本没靠岸',   { ship:'不能说', watch:'不能说' }, '是'],
];

function runDemo(){
  bootDone();
  G.gen = DEMO; G.sealed = DEMO.intent;
  G.scene = DEMO.scene; G.cast = DEMO.cast; G.hook = DEMO.hook;
  G.silenced = ['watch'];
  G.questioned = { purser:2, widow:3, watch:1 };
  DEMO_ROWS.forEach(([who, claim, vs, itv]) => {
    const verdicts = itv ? Object.assign({}, vs, { __it__: itv }) : Object.assign({}, vs);
    G.board.push({ who, claim, verdicts, lines:{}, truth:true, itSaid:itv });
  });
  G.board[0].lines = { widow:'签收簿上有两个手印，一个是湿的。' };
  G.board[1].lines = { watch:'他的靴子是干的。下过船的人靴子不可能是干的。' };
  G.board[2].lines = { __it__:'那批货一共四十一箱。你数第三遍的时候还是四十一箱。' };
  G.riddles = [{ q:'那晚下船的为什么多一个人？', sealed:'（自检）' }];
  $('#placeName').textContent = '渲染自检';
  drawScene(); refreshSheetBtn(); refreshShowBtn(); renderCastRow();
  say(DEMO.opening);
  say(DEMO.hook.join(''), 'hookline', '它讲了这么一件事');
  say('图元清单：' + Render.KINDS.join('、') + '\n点右上角「本子」看记录长什么样。', 'sys');
  $('#cmd').disabled = true;
  $('#cmd').placeholder = '自检模式不接受输入';
  if (location.search.includes('sheet')) openSheet();
}

/* ================= 启动 ================= */

/* 全是"点名 + 一句话"的形状——玩家第一眼就得知道要指定问谁 */
/* 只管「问什么」那一框——「问谁」有自己的提示和下面那排名字 */
const PLACEHOLDERS = [
  '一句话——问句、说法、猜测都行',
  '他是自己走下船的吗',
  '那扇门是从里面锁上的',
  '那天夜里不止一个人上过船',
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
  $('#who').addEventListener('keydown', e => { if (e.key === 'Enter') $('#cmd').focus(); });
  $('#who').addEventListener('keydown', e => { if (e.key === 'Enter') $('#cmd').focus(); });
  $('#who').addEventListener('keydown', e => { if (e.key === 'Enter') $('#cmd').focus(); });

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

/* QA 用：?auto=问谁>说什么|问谁>说什么　开局跑完自动问几句，用来截真实一局的图。
   「问谁」可以留空（直接写 >说什么）。 */
async function autoPlay(){
  const m = /[?&]auto=([^&]*)/.exec(location.search);
  if (!m || !G.gen) return;
  for (const step of decodeURIComponent(m[1]).split('|')){
    if (G.ended) break;
    const i = step.indexOf('>');
    let who    = i >= 0 ? step.slice(0, i).trim() : '';
    const said = i >= 0 ? step.slice(i + 1).trim() : step.trim();
    if (!said) continue;
    /* `*` ＝ 这一局现有的全部证人。名字是开局才生成的，脚本没法预先写死。 */
    if (who === '*')
      who = G.cast.filter(h => !G.silenced.includes(h.id)).map(h => h.name).join('、');
    $('#who').value = who;
    $('#cmd').value = said;
    await sayClaim();
    await sleep(1200);
  }
}

init();
