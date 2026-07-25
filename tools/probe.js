/* 开局生成探针： node tools/probe.js [种子]
   验证它能不能凭空造出一局：地点、往事、意图、可渲染的场景。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const box = {};
new Function('g', read('data.js') + '\n' + read('llm.js') +
  '\ng.LLM=LLM;g.PRIMITIVES=PRIMITIVES;')(box);
const { LLM } = box;
LLM.cfg.key = read('deepseek_apikey').trim();

const KINDS = ['box','container','slats','door','panel','window','light','figure','pipe','cable','stain','debris','text','redact'];
const C = { d:'\x1b[2m', y:'\x1b[33m', g:'\x1b[32m', r:'\x1b[31m', c:'\x1b[36m', x:'\x1b[0m' };

(async () => {
  const seed = process.argv[2] || String(Math.floor(Math.random()*100000));
  console.log(`种子 ${seed}　模型 ${LLM.cfg.model}\n`);

  const t0 = Date.now();
  const g = await LLM.genesis(seed);
  console.log(C.d + `[genesis ${((Date.now()-t0)/1000).toFixed(1)}s]` + C.x);

  console.log(`\n${C.c}【地点】${C.x}${g.place}`);
  console.log(`\n${C.c}【往事】${C.x}\n${g.past}`);
  console.log(`\n${C.y}【它想要的（封存）】${C.x}${g.intent}`);
  console.log(`${C.y}【为什么不能直说】${C.x}${g.why_silent}`);
  console.log(`\n${C.c}【开场】${C.x}\n${g.opening}`);

  const els = g.scene.elements;
  console.log(`\n${C.c}【场景】${C.x}${els.length} 个图元`);
  const bad = [];
  for (const e of els){
    const flags = Object.entries(e).filter(([k,v]) => !['id','kind','x','y','w','h'].includes(k)).map(([k,v]) => `${k}=${v}`);
    console.log(`  ${String(e.kind).padEnd(10)} ${String(e.id).padEnd(14)} ` +
      `(${String(e.x).padStart(3)},${String(e.y).padStart(3)}) ${String(e.w).padStart(3)}×${String(e.h).padStart(3)}  ${C.d}${flags.join(' ')}${C.x}`);
    if (!KINDS.includes(String(e.kind).toLowerCase())) bad.push(`未知 kind: ${e.kind}`);
    if (e.x < 0 || e.x > 800 || e.y < 0 || e.y > 500) bad.push(`${e.id} 坐标越界`);
    if (e.w <= 0 || e.h <= 0) bad.push(`${e.id} 尺寸非法`);
  }
  const ids = new Set(els.map(e => e.id));
  console.log(`\n${C.c}【可观察】${C.x}${g.hotspots.length} 处`);
  for (const h of g.hotspots){
    console.log(`  ${C.y}${h.name}${C.x} ${C.d}(${h.id})${C.x}  ${h.look.slice(0,54).replace(/\n/g,' ')}…`);
    if (!ids.has(h.id)) bad.push(`热区 ${h.id} 没有对应图元`);
  }

  console.log('\n── 校验 ──');
  console.log(bad.length ? C.r + bad.map(b => '✗ ' + b).join('\n') + C.x : C.g + '✓ 场景全部可渲染' + C.x);
  const onWall  = els.filter(e => e.y < 300).length;
  const onFloor = els.filter(e => e.y + e.h > 360).length;
  console.log(`布局：墙面 ${onWall} 件 ／ 地面 ${onFloor} 件　intent 长度 ${g.intent.length} 字`);
})();
