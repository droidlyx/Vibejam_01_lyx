/* 数据一致性校验：node tools/check.js
   保证 fixed/free 引用的 fact 都存在、free 输出白名单自洽、结论选项下标合法。 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
const sandbox = {};
new Function('g', src + '\ng.FACTS=FACTS;g.OBJECTS=OBJECTS;g.QUESTIONS=QUESTIONS;g.OFFLINE=OFFLINE;g.TRUTH=TRUTH;')(sandbox);
const { FACTS, OBJECTS, QUESTIONS, OFFLINE } = sandbox;

const errs = [];
for (const [id, o] of Object.entries(OBJECTS)) {
  for (const a of o.actions) {
    for (const f of a.reveals || []) if (!FACTS[f]) errs.push(`${id} 动作「${a.verb}」引用了不存在的 fact: ${f}`);
    if (a.requires && !FACTS[a.requires]) errs.push(`${id} requires 不存在: ${a.requires}`);
    if (!a.text && !a.textFn) errs.push(`${id} 动作「${a.verb}」既无 text 也无 textFn`);
  }
  for (const f of o.free.allowFacts) if (!FACTS[f]) errs.push(`${id} allowFacts 含不存在的 fact: ${f}`);
  if (!o.free.truth) errs.push(`${id} 缺少 free.truth`);
}
for (const k of Object.keys(OFFLINE.freeKnown)) {
  const [c, ob] = k.split('->');
  if (!FACTS[c]) { errs.push(`离线组合 ${k} 的线索不存在`); continue; }
  if (!OBJECTS[ob]) { errs.push(`离线组合 ${k} 的物件不存在`); continue; }
  for (const f of OFFLINE.freeKnown[k].reveals)
    if (!OBJECTS[ob].free.allowFacts.includes(f)) errs.push(`离线组合 ${k} 泄漏了白名单外的 fact: ${f}`);
}
QUESTIONS.forEach(q => { if (!q.options[q.answer]) errs.push(`${q.id} 正确答案下标越界`); });

// 可解性：只用 fixed 交互，能否推出三条非封印结论所需的证据？
const reachable = new Set();
for (const o of Object.values(OBJECTS)) for (const a of o.actions) (a.reveals || []).forEach(f => reachable.add(f));
['fact_it_watches'].forEach(f => reachable.add(f)); // 由开门序列给出
const needed = ['fact_seismic', 'fact_han', 'fact_41days', 'fact_uninterrupted', 'fact_three_circuits'];
const missing = needed.filter(f => !reachable.has(f));
if (missing.length) errs.push(`仅靠固定交互无法获得关键证据: ${missing.join(', ')}`);

console.log(errs.length ? '✗ ' + errs.join('\n✗ ') : '✓ 数据一致性校验通过');
console.log(`物件 ${Object.keys(OBJECTS).length} ｜ 线索 ${Object.keys(FACTS).length} ｜ 结论 ${QUESTIONS.length} ｜ 固定交互可达事实 ${reachable.size}`);
process.exit(errs.length ? 1 : 0);
