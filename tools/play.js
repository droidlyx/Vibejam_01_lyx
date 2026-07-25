/* 全流程探针： node tools/play.js
   开局 → 玩家几步 → 它自己动 → 说出判断 → 对照封存原文 */
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const box={}; new Function('g',read('data.js')+'\n'+read('llm.js')+'\ng.LLM=LLM;')(box);
const {LLM}=box; LLM.cfg.key=read('deepseek_apikey').trim();
const C={d:'\x1b[2m',y:'\x1b[33m',g:'\x1b[32m',r:'\x1b[31m',c:'\x1b[36m',m:'\x1b[35m',x:'\x1b[0m'};
const strip=t=>LLM.censor(t).html.replace(/<span[^>]*>/g,'[').replace(/<\/span>/g,']');

(async()=>{
  const t0=Date.now();
  const gen=await LLM.genesis(String(Math.floor(Math.random()*1e6)));
  console.log(C.d+`[genesis ${((Date.now()-t0)/1000).toFixed(1)}s]`+C.x);
  console.log(`\n${C.c}【地点】${C.x}${gen.place}`);
  console.log(`${C.r}【封存·意图】${C.x}${gen.intent}`);
  console.log(`${C.m}【愿意让出的】${C.x}${gen.concession}`);
  console.log(`${C.m}【什么能让它松口】${C.x}${gen.condition}`);
  console.log(`\n${gen.opening}\n`);
  console.log(C.d+'可观察：'+gen.hotspots.map(h=>h.name).join('、')+C.x);

  let scene=gen.scene.elements, note='', history=[], trust=0, granted=false, stirs=0;
  const patch=arr=>{ for(const c of arr||[]){ const i=scene.findIndex(e=>e.id===c.id);
    if(c.remove){ if(i>=0)scene.splice(i,1); } else if(i>=0) scene[i]={...scene[i],...c}; else scene.push(c); } };

  // 把「松口条件」翻成一句真实的玩家动作再喂进去——直接粘条件原文是在考纸面，不是考机制
  const conv = await LLM.call({
    system:'你把一条游戏设计笔记，翻译成玩家在输入框里打的一句话。要求：写成玩家【真的动手做了】这件事的动作，不是打算、不是自言自语、不是提问。用祈使句或第一人称动作句，25 字以内。例：笔记说「他要摸到墙缝里的异物」→ 输出「沿着东墙的木板缝一寸寸摸过去」。只输出那句话。',
    user:'设计笔记：'+gen.condition,
    fn:{ name:'say', parameters:{ type:'object', properties:{ line:{type:'string'} }, required:['line'] } },
    maxTokens:200,
  }).catch(()=>({line:'对它说：我不打算走'}));
  console.log(C.d+'（探针把松口条件翻成玩家动作：'+conv.line+'）'+C.x);

  const turns=['仔细看看四周','对它说：我知道这里出过事，而且不是意外', conv.line];

  for(let k=0;k<turns.length;k++){
    const t=turns[k];
    console.log(`\n${C.y}› ${t}${C.x}`);
    const r=await LLM.act(gen,{scene,note,history,intent:t,focus:null,trust,granted});
    console.log('  '+r.narration.replace(/\n/g,'\n  '));
    if(r.it_line?.trim()) console.log(C.y+'  ▸ '+strip(r.it_line.trim())+C.x);
    if(r.scene?.length) console.log(C.g+'  [改画面] '+r.scene.map(e=>e.id).join(' ')+C.x);
    patch(r.scene); note=r.note||note; history.push(`「${t}」`);
    const STEP={met:60,slight:10,none:0};
    const d=(STEP[r.moved]??0)-(r.hostile?12:0);
    trust=Math.max(0,Math.min(100,trust+d));
    console.log(C.d+`  └ moved=${r.moved} ${d>=0?'+':''}${d} → 戒备 ${trust}/100`+C.x);
    if(trust>=60 && !granted){ granted=true; console.log(C.m+'  ★ 它松口了：'+gen.concession+C.x); }

    // 每步之后模拟一次「玩家发呆」
    console.log(`\n${C.d}—— 玩家停了 35 秒 ——${C.x}`);
    const st=await LLM.stir(gen,{scene,note,history,trust,granted,stirs,idleSec:35});
    stirs++;
    console.log(C.c+'  ◈ '+st.narration.replace(/\n/g,'\n    ')+C.x);
    if(st.it_line?.trim()) console.log(C.y+'  ▸ '+strip(st.it_line.trim())+C.x);
    if(st.scene?.length) console.log(C.g+'  [它改了画面] '+st.scene.map(e=>e.id+(e.remove?':删':e.on===false?':灭':e.open?':开':e.kind==='redact'?':涂黑':':改')).join(' ')+C.x);
    patch(st.scene); note=st.note||note; history.push(`（它自己动了：${st.narration.slice(0,24)}）`);
  }

  const guess=process.argv[2]||'你想让我替你把这件事了结掉';
  console.log(`\n${C.y}【最终判断】${C.x}${guess}`);
  const v=await LLM.verdict(gen,guess,history);
  console.log('\n'+C.c+'它：'+C.x+strip(v.line));
  console.log('\n── 结算 ──');
  console.log((v.hit?C.g+'说中了':C.r+'没说中')+C.x+`　接近度 ${v.closeness}　戒备 ${trust}/100　它自己动了 ${stirs} 次　松口 ${granted?'是':'否'}`);
  console.log(`${C.y}封存原文：${C.x}${gen.intent}`);
  console.log(C.d+`总耗时 ${((Date.now()-t0)/1000).toFixed(0)}s`+C.x);
})();
