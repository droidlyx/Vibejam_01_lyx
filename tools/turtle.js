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

  const cast = g.cast;
  ok((g.hook||[]).length >= 2 && (g.hook||[]).length <= 5, `汤面 ${(g.hook||[]).length} 句（要 2–5）`);
  ok((g.hook||[]).join('').length >= 45, `汤面 ${(g.hook||[]).join('').length} 字（要 ≥45，太短就不成故事）`);
  ok(cast.length >= 5, `证人 ${cast.length} 个（要 ≥5）`);
  
  ok(cast.every(h => h.mind && h.toward && h.slip && h.stake), '每一件都有想法、立场、和捏着的事');
  const towards = new Set(cast.map(h => h.toward));
  ok(towards.size >= 2, `立场有分歧（${[...towards].join('/')}）`);

  /* ---------- 一句话，一屋子裁决 ---------- */
  const board = [];
  const list = claims.length ? claims : [
    '这里出过一件没上报的事',
    '你想要的那件事，只有他能做',
    '这些东西里有一件在替你撒谎',
  ];

  const tally = { rounds:0, dissent:0, mute:0 };
  let note = '';
  for (let i = 0; i < list.length; i++){
    const claim = list[i];
    console.log(`\n${C.y}第 ${i + 1} 句　「${claim}」${C.x}`);
    const t = Date.now();
    const r = await LLM.ask(g, {
      scene: g.scene.elements, note, cast, hook: g.hook, silenced: [], lastRun: '',
      board: board.map((b, j) => `${j + 1}.「${b.claim}」`).join('\n'),
      qi: i + 1, trust: 0, granted: false,
    }, claim);
    console.log(`${C.d}[ask ${((Date.now() - t) / 1000).toFixed(1)}s]${C.x}`);
    note = r.note || note;

    if (r.valid === false){ console.log(C.r + '  判为不是命题' + C.x); continue; }

    const vs = {};
    for (const v of r.voices || []) vs[v.id] = v;
    for (const h of cast){
      const v = vs[h.id];
      const mark = !v ? C.r + '缺' : v.verdict === '是' ? C.y + '是' :
                   v.verdict === '不是' ? '否' : v.verdict === '不能说' ? C.r + '▓' : C.d + '—';
      console.log(`  ${pad(h.name, 12)} ${mark}${C.x}  ${C.d}${v?.line || ''}${C.x}`);
    }
    console.log(`  ${pad('它', 12)} ${C.c}${r.it?.verdict}${C.x}  ${C.d}${r.it?.line || ''}${C.x}`);
    console.log(`  ${C.d}实情：${r.truth ? '这句是真的' : '这句不是真的'}${C.x}`);

    ok(cast.every(h => vs[h.id]), '每一件都表了态');
    ok(cast.every(h => !vs[h.id] || VERDICT_KEYS.includes(vs[h.id].verdict)), '裁决都在四档里');

    /* 真正要盯的不是"有没有第二种裁决"，是"有没有人跟多数派唱反调"。
       全场一半答「是」、一半答「无关」也是异口同声——「无关」是弃权，不是反对。 */
    const all = cast.map(h => vs[h.id]?.verdict).filter(Boolean);
    const yes = all.filter(v => v === '是').length;
    const no  = all.filter(v => v === '不是').length;
    const na  = all.filter(v => v === '无关').length;
    const mute = all.filter(v => v === '不能说').length;
    ok(yes > 0 && no > 0, `有人唱反调（是 ${yes} ／ 否 ${no} ／ 无关 ${na} ／ 不能说 ${mute}）`);
    ok(na >= all.length * 0.25 && na <= all.length * 0.7, `「无关」占 ${Math.round(na / all.length * 100)}%（要 25–70%，它划的是知识边界）`);
    tally.rounds++; tally.dissent += (yes > 0 && no > 0) ? 1 : 0; tally.mute += mute;
    /* 模型压不住嘴，一轮能让五六件东西同时说话。刻度归代码：
       game.js 只放三句，先放跟「它」唱反调的。这里跑同一套裁剪，
       验的是玩家真会看到什么。 */
    const raw = (r.voices || []).filter(v => v.line && v.line.trim() && cast.some(h => h.id === v.id));
    const shown = raw.slice().sort((a, b) =>
      (a.verdict === r.it?.verdict) - (b.verdict === r.it?.verdict)).slice(0, 3);
    ok(shown.length <= 3, `模型让 ${raw.length} 件开了口，代码裁到 ${shown.length} 句`);
    if (raw.length > 3){
      const names = Object.fromEntries(cast.map(h => [h.id, h.name]));
      console.log(`  ${C.d}留下：${shown.map(v => names[v.id]).join('、')}${C.x}`);
    }
    if (r.retract?.qi) console.log(`  ${C.r}它涂掉了第 ${r.retract.qi} 句里 ${r.retract.id} 的回答${C.x}`);
    if (r.scene?.length) console.log(`  ${C.g}画面因此变了 ${r.scene.length} 处${C.x}`);

    board.push({ claim });
  }

  console.log(`
${C.c}总计${C.x}　${tally.rounds} 轮，其中 ${tally.dissent} 轮有人唱反调，` +
              `「不能说」出现 ${tally.mute} 次`);
  ok(tally.dissent >= Math.ceil(tally.rounds * 0.6), '至少六成的轮次要裂开');
})().catch(e => { console.error(C.r + e.stack + C.x); process.exit(1); });
