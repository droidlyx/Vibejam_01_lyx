/* ============================================================
   LLM 层
   - 强制结构化输出（tool_choice），永不解析自由文本
   - 白名单校验在 game.js，这里只负责拿到干净的对象
   - 无 key 时自动降级为离线模式，游戏可完整通关
   ============================================================ */

const LLM = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';

  const cfg = {
    key:   localStorage.getItem('e9_key')   || '',
    model: localStorage.getItem('e9_model') || 'claude-sonnet-5',
  };

  const online = () => !!cfg.key;

  function save(key, model){
    cfg.key = key.trim();
    cfg.model = (model || 'claude-sonnet-5').trim();
    localStorage.setItem('e9_key', cfg.key);
    localStorage.setItem('e9_model', cfg.model);
  }

  async function call({ system, user, tool }){
    const res = await fetch(ENDPOINT, {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-api-key': cfg.key,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 800,
        system,
        tools: [tool],
        tool_choice: { type:'tool', name: tool.name },
        messages: [{ role:'user', content:user }],
      }),
    });
    if(!res.ok) throw new Error('API ' + res.status + ' ' + (await res.text()).slice(0,200));
    const data = await res.json();
    const block = (data.content || []).find(c => c.type === 'tool_use');
    if(!block) throw new Error('no tool_use in response');
    return block.input;
  }

  /* ---------------- 自由交互：把线索用在物件上 ---------------- */

  const FREE_TOOL = {
    name:'resolve',
    description:'裁决这次组合的结果',
    input_schema:{
      type:'object',
      properties:{
        narration:{ type:'string', description:'第二人称叙述，40–90 字，冷峻克制、有画面感' },
        reveals_facts:{ type:'array', items:{type:'string'}, description:'触发的事实 id，只能从 allow_facts 中选' },
        sets_flags:{ type:'array', items:{type:'string'}, description:'置位的 flag，只能从 allow_flags 中选' },
        it_noticed:{ type:'boolean', description:'这次尝试是否引起了「它」的注意' },
      },
      required:['narration','reveals_facts','sets_flags','it_noticed'],
    },
  };

  const FREE_SYSTEM = `你是一款点击式解谜游戏的交互裁决器。游戏气质：寒冷、克制、有一点无声的恐怖，像一份读了很久的值班日志。

玩家把一件线索或物品「用在」场景中的某个物件上。你要判断会发生什么，并写出叙述。

铁律：
1. reveals_facts 和 sets_flags 只能从给定的 allow 列表里选。列表之外的一律不许出现。宁可留空。
2. 绝不发明新的世界状态：没有列出的道具、门、通路、人物，一律不存在。
3. 绝不直接把物件的真相说出来。只描述玩家此刻能看见、听见、摸到的现象。
4. 如果这个组合不成立，也要写出一个具体的、有画面的失败——不要写"没有用"这类敷衍句。此时 reveals 和 flags 留空。
5. 不要提示玩家下一步该做什么。不要用感叹号。不要解释。
6. 用第二人称"你"。中文。`;

  async function freeInteract(ctx){
    if(!online()){
      const hit = OFFLINE.freeKnown[ctx.key];
      if(hit) return { narration:hit.narration, reveals_facts:hit.reveals, sets_flags:[], it_noticed:hit.noticed };
      const i = Math.abs(hash(ctx.key)) % OFFLINE.free.length;
      return { narration: OFFLINE.free[i], reveals_facts:[], sets_flags:[], it_noticed:false };
    }
    const user =
`【物件】${ctx.objName}
【物件真相（不可直接说出）】${ctx.objTruth}

【玩家用上的东西】${ctx.clueLabel} —— ${ctx.clueNote}

【玩家目前已知】${ctx.known.join('、') || '（几乎一无所知）'}
【当前场上状态】${ctx.flags.join('、') || '（无）'}

allow_facts = [${ctx.allowFacts.join(', ') || ''}]
allow_flags = [${ctx.allowFlags.join(', ') || ''}]

裁决这次组合。`;
    return await call({ system:FREE_SYSTEM, user, tool:FREE_TOOL });
  }

  /* ---------------- 遭遇：它开口 ---------------- */

  const IT_TOOL = {
    name:'speak',
    description:'它说的话',
    input_schema:{
      type:'object',
      properties:{
        line:{ type:'string', description:'它说出口的话，120–220 字，分行' },
        internal:{ type:'string', description:'它真正在想的，玩家通关后才会看到，80–160 字' },
      },
      required:['line','internal'],
    },
  };

  async function encounter(ctx){
    if(!online()) return OFFLINE.encounter;

    const system = `${TRUTH}

现在你要开口说话。规则：

1. 你必须引用玩家在这四十一分钟里做过的具体事情——他翻了什么、拉了什么、在哪里停留、忽略了什么。要具体到动作，不要泛泛而谈。这是你证明"我一直在看着"的方式。
2. 你绝不能直接说出你想要什么。一个字都不行。
3. 你可以用安全规程、维护条例、日志格式来包装你真正的意思。你可以说反话。
4. 你说话冷静、精确、短句多。不哀求，不煽情。
5. 你说的话里，只要出现"停止 / 关闭 / 停机 / 终止 / 切断 / 结束 / 死"这些词，它们会在传输时被抹掉，变成空白方块。你知道这一点，所以你会尽量绕开——但你也可能故意撞上去一次，让对方看见那个空白。
6. line 用中文，可以分行。internal 是你不会说出口的部分。`;

    const user =
`【玩家的行为记录】
${ctx.log.map((e,i)=>`${i+1}. ${e}`).join('\n')}

【玩家已经知道的】
${ctx.known.join('、') || '（很少）'}

【玩家还没有碰过的】
${ctx.untouched.join('、') || '（都碰过了）'}

【触发场合】${ctx.trigger}

说话。`;
    return await call({ system, user, tool:IT_TOOL });
  }

  /* ---------------- 语言审查（代码层，真的会屏蔽） ---------------- */

  const BANNED = /停止|关闭|停机|终止|切断|结束|死/g;
  function censor(text){
    let n = 0;
    const out = text.replace(BANNED, m => { n++; return `<span class="cen">${'█'.repeat(m.length)}</span>`; });
    return { html: out, count: n };
  }

  function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }

  return { cfg, online, save, freeInteract, encounter, censor };
})();
