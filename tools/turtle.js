/* 海龟汤探针： node tools/turtle.js ["一句陈述" "另一句" ...]
   验证核心循环：开局造出一屋子各怀立场的证人，
   然后一句话下去，它们的裁决会不会裂开。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const box = {};
new Function('g', read('data.js') + '\n' + read('llm.js') +
  '\ng.LLM=LLM;g.VERDICT_KEYS=VERDICT_KEYS;')(box);
const { LLM, VERDICT_KEYS } = box;
LLM.cfg.key = read('deepseek_apikey').trim();
/* PLAY=pro node tools/turtle.js —— 拿问答那一步换个模型跑，比一比 */
if (process.env.PLAY) LLM.cfg.modelPlay = 'deepseek-v4-' + process.env.PLAY;

const C = { d:'\x1b[2m', y:'\x1b[33m', g:'\x1b[32m', r:'\x1b[31m', c:'\x1b[36m', x:'\x1b[0m' };
const pad = (s, n) => { let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
                        return s + ' '.repeat(Math.max(0, n - w)); };
const ok = (b, msg) => console.log((b ? C.g + '  ✓ ' : C.r + '  ✗ ') + msg + C.x);

(async () => {
  const claims = process.argv.slice(2);
  const seed = String(Math.floor(Math.random() * 100000));

  console.log(`${C.d}开局生成中（pro，约 30s）……${C.x}`);
  const t0 = Date.now();
  const g = await LLM.genesis(seed);
  console.log(`${C.d}[genesis ${((Date.now() - t0) / 1000).toFixed(1)}s]${C.x}`);
  console.log(`${C.d}[骰子] ${Object.values(g.axis).join(' / ')}${C.x}\n`);

  console.log(`${C.c}【地点】${C.x}${g.place}`);
  console.log(`${C.y}【它想要的（封存）】${C.x}${g.intent}\n`);

  /* ---------- 证人席 ---------- */
  console.log(`${C.c}【汤面】${C.x}${(g.hook || []).join('')}
`);
  console.log(`${C.c}【证人席】${C.x}`);
  for (const h of g.cast){
    console.log(`  ${pad(h.name, 12)} ${pad(h.what || '?', 4)} ${pad(h.toward || '?', 8)} ${C.d}${h.mind || ''}${C.x}`);
    console.log(`  ${' '.repeat(12)} ${C.d}利害：${h.stake || ''}｜捏着：${h.slip || ''}${C.x}`);
  }
  console.log();

  const cast = g.cast.slice();
  ok((g.hook||[]).length >= 2 && (g.hook||[]).length <= 5, `汤面 ${(g.hook||[]).length} 句（要 2–5）`);
  ok((g.hook||[]).join('').length >= 45, `汤面 ${(g.hook||[]).join('').length} 字（要 ≥45，太短就不成故事）`);
  ok(cast.length === 3, `起手 ${cast.length} 个（要正好 3——那不是名单，是三个抓手）`);
  ok(cast.every(h => h.mind && h.toward && h.slip && h.stake), '每一件都有想法、立场、和捏着的事');
  const towards = new Set(cast.map(h => h.toward));
  ok(towards.size >= 2, `立场有分歧（${[...towards].join('/')}）`);

  /* ---------- 四轮 ----------
     前两轮点名问席上的：验"只有被点名的开口"和"他们之间不许异口同声"。
     后两轮传唤席外的：一个该驳回，一个该放行。 */
  const all3 = cast.map(h => h.name).join('、');
  const rounds = claims.length
    ? claims.map(s => { const [w, q] = s.split('>');
        return { who:(q ? w : '').trim(), said:(q || w).trim(), kind:'free' }; })
    : [
      { who: all3, said: '这里出过一件没上报的事',   kind:'named'  },
      { who: all3, said: '当晚在场的不止你们几个',   kind:'named'  },
      { who: '它周围的空气', said: '那天夜里有别人在场', kind:'bogus'  },
      { who: '最先发现这件事的那个人', said: '他当时没说实话', kind:'summon' },
      { who: '', said: '你一直在瞒着我一件事', kind:'it', lie:true },
    ];

  const board = [], tally = { rounds:0, dissent:0, mute:0, spent:0 };
  let note = '';
  for (let i = 0; i < rounds.length; i++){
    const { who, said, kind, lie } = rounds[i];
    console.log(`\n${C.y}第 ${i + 1} 句　问【${who || '它自己'}】　「${said}」${
                  lie ? C.r + '（代码摇到了：这一次它要撒谎）' + C.y : ''}${C.x}`);
    const t = Date.now();
    const r = await LLM.ask(g, {
      scene: g.scene.elements, note, cast, hook: g.hook, silenced: [], lastRun: '',
      board: board.map((b, j) => `${j + 1}.「${b.claim}」`).join('\n'),
      qi: i + 1, trust: 0, granted: false, itLie: !!lie,
    }, { said, who });
    console.log(`${C.d}[ask ${((Date.now() - t) / 1000).toFixed(1)}s]${C.x}`);
    note = r.note || note;

    if (r.valid === false){ console.log(C.r + '  判为不是命题' + C.x); continue; }

    /* 传唤：谁被放进来了，谁被打发了 */
    let admitted = 0, refused = 0;
    const fresh = [];
    for (const n of (r.newcomers || [])){
      if (!n || !n.name) continue;
      if (n.exists && n.id && !cast.some(h => h.id === n.id)){
        admitted++; fresh.push(n.id);
        cast.push({ id:n.id, name:n.name, what:n.what, stake:n.stake,
                    mind:n.mind, toward:n.toward, slip:n.slip });
        console.log(`  ${C.g}＋ ${n.name}　${n.what || ''}　${n.stake || ''}${C.x}`);
      } else if (!n.exists){
        refused++;
        console.log(`  ${C.r}✕ ${n.name}　${C.d}${n.line || ''}${C.x}`);
      }
    }

    /* 跑 game.js 那道闸：没被点到、也不是这一轮刚进来的，一律不算数。
       模型偶尔会让旁人顺嘴接一句——那是在替他花钱。 */
    const allowed = new Set([...(r.addressed || []), ...fresh]);
    const kept = (r.voices || []).filter(v => v && v.id && allowed.has(v.id));
    const over = (r.voices || []).length - kept.length;
    if (over > 0) console.log(`  ${C.d}（模型多让 ${over} 个开口，代码掐掉了）${C.x}`);

    const vs = {};
    for (const v of kept) vs[v.id] = v;
    /* 跟 game.js 的 wantsIt 一样：点没点它由代码认。模型爱把 __it__
       顺手填上，那等于替玩家花钱。 */
    const saidIt = !who || /(^|[、,，;；\s])(它|你|它自己|你自己|这地方|这里|这个地方)([、,，;；\s]|$)/.test(who);
    const atIt = saidIt && ((r.addressed || []).includes('__it__') || !who);
    const addressed = (r.addressed || []).filter(id => cast.some(h => h.id === id));
    const names = Object.fromEntries(cast.map(h => [h.id, h.name]));
    for (const h of cast){
      const v = vs[h.id];
      if (!v) continue;
      const mark = v.verdict === '是' ? C.y + '是' : v.verdict === '不是' ? '否' :
                   v.verdict === '不能说' ? C.r + '▓' : C.d + '—';
      console.log(`  ${pad(h.name, 12)} ${mark}${C.x}  ${C.d}${v.line || ''}${C.x}`);
    }
    console.log(`  ${pad('它自己', 12)} ${atIt ? C.c + r.it?.verdict : C.d + '（没点它，不作答）'}${C.x}  ${C.d}${(atIt && r.it?.line) || ''}${C.x}`);
    console.log(`  ${C.d}实情：${r.truth ? '这句是真的' : '这句不是真的'}${C.x}`);

    /* 计费跑的是 game.js 那一套：只有真给了立场的才扣，「无关」白问 */
    const spent = Object.keys(vs).filter(id => names[id] && vs[id].verdict !== '无关').length
                + (atIt && (r.it?.verdict || '无关') !== '无关' ? 1 : 0);
    tally.spent += spent;
    console.log(`  ${C.d}这一句花掉 ${spent} 次，累计 ${tally.spent}／10${
                  tally.spent >= 10 ? C.r + '　它该出手了' : ''}${C.x}`);

    ok(Object.keys(vs).every(id => VERDICT_KEYS.includes(vs[id].verdict)), '裁决都在四档里');
    /* 这一条是新规矩里最容易破的：没被点名的不许插嘴 */
    const spoke = Object.keys(vs).filter(id => names[id]);
    const due = [...new Set([...addressed, ...fresh])];
    ok(spoke.every(id => due.includes(id)) && due.every(id => vs[id]),
       `该开口的都开了，没开口的没插嘴（该 ${due.length}，答了 ${spoke.length}）`);

    if (kind === 'named'){
      const av = addressed.map(id => vs[id]?.verdict).filter(Boolean);
      const yes = av.filter(v => v === '是').length;
      const no  = av.filter(v => v === '不是').length;
      const na  = av.filter(v => v === '无关').length;
      const mute = av.filter(v => v === '不能说').length;
      console.log(`  ${C.d}是 ${yes} ／ 否 ${no} ／ 无关 ${na} ／ 不能说 ${mute}${C.x}`);
      tally.rounds++;
      tally.dissent += new Set(av).size > 1 ? 1 : 0;
      tally.mute += mute;
      ok(admitted === 0, '点的都在席上，没顺手多造人');
      ok(!atIt && !(r.it?.line || '').trim(), '没点它自己，它就不插嘴（那一票要花钱买）');
    }
    if (kind === 'bogus'){
      ok(admitted === 0 && spent === 0,
         `「它周围的空气」既没变出证人，也没让别人替它答（花掉 ${spent} 次）`);
      /* 模型有时干脆不提这一条。代码那边有兜底的一句，所以只提醒，不判挂。 */
      if (!refused) console.log(`  ${C.d}（模型没写驳回那一条，游戏里由代码补一句）${C.x}`);
    }
    if (kind === 'summon'){
      ok(admitted > 0 || addressed.length > 0,
         admitted > 0 ? '推出来的人放行了，进了证人席'
                      : '没造新人，但认出了席上已有的那一个');
      ok(admitted === 0 || fresh.some(id => vs[id]), '刚进来的那个自己开了口，不是让旧人代答');
    }
    if (kind === 'it'){
      ok(atIt, '「问谁」空着＝在问它自己，它认下了这一票');
      const contra = (r.truth && r.it?.verdict === '不是') || (!r.truth && r.it?.verdict === '是');
      ok(contra, `骰子摇到撒谎，它就真的反着答了（实情 ${r.truth ? '真' : '假'}，它答「${r.it?.verdict}」）`);
      ok(spoke.length === 0, '只问它自己的时候，证人不搭腔');
    }

    if (r.scene?.length) console.log(`  ${C.g}画面因此变了 ${r.scene.length} 处${C.x}`);
    board.push({ claim: r.claim || said });
  }

  console.log(`
${C.c}总计${C.x}　点名问了 ${tally.rounds} 轮，其中 ${tally.dissent} 轮口供不一致，` +
              `「不能说」${tally.mute} 次，证人席 ${g.cast.length} → ${cast.length}`);
  ok(tally.dissent >= Math.ceil(tally.rounds * 0.5), '至少一半的轮次要裂开');
})().catch(e => { console.error(C.r + e.stack + C.x); process.exit(1); });
