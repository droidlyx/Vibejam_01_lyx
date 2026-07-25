/* 多样性检查： node tools/variety.js [局数]
   只跑 genesis，看它到底会不会一直写同一个厂。 */
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const box={}; new Function('g',read('data.js')+'\n'+read('llm.js')+'\ng.LLM=LLM;g.AXIS=AXIS;')(box);
const {LLM}=box; LLM.cfg.key=read('deepseek_apikey').trim();
const C={d:'\x1b[2m',y:'\x1b[33m',c:'\x1b[36m',m:'\x1b[35m',x:'\x1b[0m'};
(async()=>{
  const n=Number(process.argv[2]||6);
  const rs=await Promise.all(Array.from({length:n},(_,i)=>
    LLM.genesis('v'+i).catch(e=>({err:e.message}))));
  rs.forEach((g,i)=>{
    if(g.err){ console.log(`${i+1}. 失败 ${g.err}`); return; }
    console.log(`\n${C.c}${i+1}. ${g.place}${C.x}`);
    console.log(`${C.d}   坐标 ${g.axis.genre}／${g.axis.era}／${g.axis.where}／${g.axis.self}／${g.axis.scale}${C.x}`);
    console.log(`${C.y}   想要：${g.intent}${C.x}`);
    console.log(`${C.d}   图元 ${g.scene.elements.length}　热区 ${g.hotspots.length}${C.x}`);
  });
  const ok=rs.filter(r=>!r.err);
  const eighties=ok.filter(g=>/198\d|八十年代/.test(g.place)).length;
  console.log(`\n成功 ${ok.length}/${n}　落在八十年代的 ${eighties} 局`);
})();
