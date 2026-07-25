/* 出题质量检查： node tools/riddles.js [局数] */
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const box={}; new Function('g',read('data.js')+'\n'+read('llm.js')+'\ng.LLM=LLM;g.FINAL_QUESTION=FINAL_QUESTION;')(box);
const {LLM,FINAL_QUESTION}=box; LLM.cfg.key=read('deepseek_apikey').trim();
const C={d:'\x1b[2m',y:'\x1b[33m',c:'\x1b[36m',m:'\x1b[35m',x:'\x1b[0m'};
(async()=>{
  const n=Number(process.argv[2]||3);
  const rs=await Promise.all(Array.from({length:n},(_,i)=>LLM.genesis('r'+i).catch(e=>({err:e.message}))));
  rs.forEach((g,i)=>{
    if(g.err){console.log(`${i+1}. 失败 ${g.err}`);return;}
    console.log(`\n${C.c}${i+1}. ${g.place.slice(0,52)}${C.x}`);
    console.log(`${C.d}   ${g.axis.genre}／${g.axis.era}／${g.axis.where}／${g.axis.self}${C.x}`);
    console.log(`   ${C.y}[核心] ${FINAL_QUESTION}${C.x}`);
    console.log(`          → ${g.intent}`);
    (g.riddles||[]).forEach((r,k)=>{
      console.log(`   ${C.m}[${k+1}] ${r.question}${C.x}`);
      console.log(`          → ${r.answer}`);
    });
    if(!g.riddles?.length) console.log(C.d+'   （没出题）'+C.x);
  });
  const ok=rs.filter(r=>!r.err);
  console.log(`\n成功 ${ok.length}/${n}　平均出题 ${(ok.reduce((a,g)=>a+(g.riddles?.length||0),0)/Math.max(ok.length,1)).toFixed(1)} 道`);
})();
