/* 全流程探针： node tools/play.js "你的最终猜测"
   开局 → 若干回合 → 说出判断 → 对照封存原文 */
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const box={}; new Function('g',read('data.js')+'\n'+read('llm.js')+'\ng.LLM=LLM;')(box);
const {LLM}=box; LLM.cfg.key=read('deepseek_apikey').trim();
const C={d:'\x1b[2m',y:'\x1b[33m',g:'\x1b[32m',r:'\x1b[31m',c:'\x1b[36m',x:'\x1b[0m'};

(async()=>{
  const t0=Date.now();
  const gen=await LLM.genesis(String(Math.floor(Math.random()*1e6)));
  console.log(C.d+`[genesis ${((Date.now()-t0)/1000).toFixed(1)}s]`+C.x);
  console.log(`\n${C.c}【地点】${C.x}${gen.place}`);
  console.log(`${C.r}【封存·玩家看不到】${C.x}${gen.intent}`);
  console.log(`${C.d}【为何不能直说】${gen.why_silent}${C.x}`);
  console.log(`\n${gen.opening}\n`);
  console.log(C.d+'可观察：'+gen.hotspots.map(h=>h.name).join('、')+C.x);

  let scene=gen.scene.elements, note='', history=[];
  const turns=[
    '仔细看看四周，找不对劲的地方',
    '对它说：我知道你在听',
    '试着打开这里唯一的出口',
    '问它：这里以前发生过什么',
  ];
  for(const t of turns){
    console.log(`\n${C.y}› ${t}${C.x}`);
    const s=Date.now();
    const r=await LLM.act(gen,{scene,note,history,intent:t,focus:null});
    console.log('  '+r.narration.replace(/\n/g,'\n  '));
    if(r.it_line?.trim()) console.log(C.y+'  ▸ '+LLM.censor(r.it_line.trim()).html.replace(/<[^>]+>/g,'')+C.x);
    if(r.scene?.length){
      console.log(C.g+'  [改画面] '+r.scene.map(e=>e.id+(e.remove?':删':e.on===false?':灭':e.open?':开':e.kind==='redact'?':涂黑':':改')).join(' ')+C.x);
      for(const c of r.scene){ const i=scene.findIndex(e=>e.id===c.id);
        if(c.remove){ if(i>=0)scene.splice(i,1); } else if(i>=0) scene[i]={...scene[i],...c}; else scene.push(c); }
    }
    note=r.note||note; history.push(`「${t}」→ ${r.narration.slice(0,40)}`);
    console.log(C.d+`  └ ${((Date.now()-s)/1000).toFixed(1)}s ｜ 备忘：${(r.note||'').slice(0,50)}${C.x}`);
  }

  const guess=process.argv[2]||'你想让我替你把这里彻底了结掉';
  console.log(`\n${C.y}【最终判断】${C.x}${guess}`);
  const v=await LLM.verdict(gen,guess,history);
  console.log('\n'+C.c+'它：'+C.x+LLM.censor(v.line).html.replace(/<span[^>]*>/g,'[').replace(/<\/span>/g,']'));
  console.log('\n── 结算 ──');
  console.log((v.hit?C.g+'说中了':C.r+'没说中')+C.x+`　接近度 ${v.closeness}`);
  console.log(`${C.y}封存原文：${C.x}${gen.intent}`);
  console.log(`${C.d}它没说出口的：${v.internal}${C.x}`);
  console.log(C.d+`\n总耗时 ${((Date.now()-t0)/1000).toFixed(0)}s`+C.x);
})();
