/* JSON 修复单元测试： node tools/check.js
   模型手滑的每一种花样，都要能救回来——玩家不该为它的手滑买单。 */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'llm.js'), 'utf8');

/* parseLoose 关在 LLM 的闭包里，这里把那一段源码单独取出来跑 */
const start = src.indexOf('  /* 模型偶尔会吐出不合法的 JSON');
const end   = src.indexOf('  /* 生成失败就重来');
if (start < 0 || end < 0) { console.error('没在 llm.js 里找到 parseLoose 那一段'); process.exit(1); }
const parseLoose = new Function(src.slice(start, end) + '\nreturn parseLoose;')();

const C = { g:'\x1b[32m', r:'\x1b[31m', d:'\x1b[2m', x:'\x1b[0m' };
const NL = String.fromCharCode(10);
let pass = 0, fail = 0;

function t(name, raw, check){
  try{
    const o = parseLoose(raw);
    if (check && !check(o)) throw new Error('解析出来了但内容不对：' + JSON.stringify(o).slice(0, 90));
    console.log(`${C.g}  ✓${C.x} ${name}`); pass++;
  }catch(e){
    console.log(`${C.r}  ✗${C.x} ${name}　${C.d}${e.message.slice(0, 110)}${C.x}`); fail++;
  }
}

t('干净的 JSON',            '{"a":1,"b":"x"}',                        o => o.a === 1);
t('尾逗号',                 '{"a":1,"b":"x",}',                       o => o.b === 'x');
t('数组尾逗号',             '{"a":[1,2,],}',                          o => o.a.length === 2);
t('字符串里夹裸换行',       '{"a":"上一行' + NL + '下一行"}',          o => o.a.includes(NL));
t('被截断',                 '{"a":"x","b":[{"c":1}',                  o => o.a === 'x');
t('被截断在字符串里',       '{"a":"x","b":"没写完',                    o => o.a === 'x');

/* 这一批是跑 turtle 探针时真实撞上的：值忘了加引号 */
t('枚举值裸奔',             '{"moved": slight, "hostile": false}',    o => o.moved === 'slight');
t('中文值裸奔',             '{"note": 他猜到了，方向对了。, "moved": "none"}',
                                                                      o => o.note.startsWith('他猜到'));
t('裸值在末尾',             '{"a":"x","note": 就这样}',                o => o.note === '就这样');
t('裸值里带换行',           '{"note": 第一行' + NL + '第二行, "a":1}', o => o.a === 1 && o.note.includes('第二行'));
t('true/false/null 不要动', '{"a":true,"b":false,"c":null}',          o => o.a === true && o.c === null);
t('负数和小数不要动',       '{"a":-1,"b":2.5}',                       o => o.a === -1 && o.b === 2.5);
t('字符串里的冒号不要动',   '{"a":"时间 12:30","b":1}',                o => o.a === '时间 12:30');
t('字符串里的中文引号',     '{"a":"他说「不」","b":1}',                 o => o.a.includes('「'));
t('嵌套对象里的裸值',       '{"it":{"verdict": 无关,"line":""},"a":1}', o => o.it.verdict === '无关');
t('数组里的裸值',           '{"v":[{"id":"x","verdict": 是}],"a":1}',  o => o.v[0].verdict === '是');
/* 这一批也是跑 turtle 时真实撞上的：中文句子里夹半角引号引一个词 */
t('值里夹没转义的引号',     '{"note":"条款上没有"未上报"这一栏。","a":1}',
                                                                      o => o.a === 1 && o.note.includes('未上报'));
t('引号夹在句尾',           '{"line":"他签的字，写的是"一切正常"","a":1}',
                                                                      o => o.line.endsWith('"一切正常"'));
t('一个值里夹好几对',       '{"n":"他说"甲"，又说"乙"。","a":1}',       o => o.n.includes('甲') && o.n.includes('乙'));
t('内部引号后面跟冒号',     '{"n":"记作"甲":一条","a":1}',              o => o.a === 1);
t('空字符串不要动',         '{"a":"","b":1}',                          o => o.a === '' && o.b === 1);
t('转义引号本来就对',       '{"a":"他说\\"好\\"","b":1}',               o => o.a === '他说"好"');

t('几样一起犯',
  '{"a":[1,2,],"note": 他说：好' + NL + '然后走了, "moved": met,}',
  o => o.moved === 'met' && o.note.includes('然后走了'));
t('裸值加内部引号一起犯',
  '{"note": 他说"就这样", "moved": met}',
  o => o.moved === 'met' && o.note.includes('就这样'));

console.log(`${NL}${fail ? C.r : C.g}${pass} 过 / ${fail} 挂${C.x}`);
process.exit(fail ? 1 : 0);
