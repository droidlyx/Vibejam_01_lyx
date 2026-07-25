/* ============================================================
   渲染原语 —— LLM 用这套词汇自由拼场景
   ------------------------------------------------------------
   全部是单色剪影。风格统一是安全阀：不管它怎么拼都不会难看。
   坐标空间 800×500，地平线默认 y=410。
   ============================================================ */

const Render = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a = {}) => { const n = document.createElementNS(NS, t); for (const k in a) if (a[k] != null) n.setAttribute(k, a[k]); return n; };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /* ---- 每个图元一个画法。参数缺省一律有兜底，LLM 少给字段也不崩。 ---- */
  const KINDS = {

    box(e){                                   // 家具、机柜、台面、墙垛
      const g = el('g');
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:e.dark ? 'p-dk' : 'p-md' }));
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-edge' }));
      if (e.legs) {
        g.appendChild(el('line', { x1:e.x+6, y1:e.y+e.h, x2:e.x+6, y2:445, class:'p-edge' }));
        g.appendChild(el('line', { x1:e.x+e.w-6, y1:e.y+e.h, x2:e.x+e.w-6, y2:445, class:'p-edge' }));
      }
      return g;
    },

    slats(e){                                 // 暖气片、通风格栅、百叶
      const g = KINDS.box({ ...e, dark:true });
      const n = Math.max(2, Math.floor(e.w / 18));
      for (let i = 1; i < n; i++){
        const x = e.x + (e.w / n) * i;
        g.appendChild(el('line', { x1:x, y1:e.y+4, x2:x, y2:e.y+e.h-4, class:'p-edge' }));
      }
      if (e.glow) for (let i = 0; i < 2; i++)
        g.appendChild(el('path', { d:`M${e.x+14+i*36} ${e.y-8} q6 -10 12 0 q6 10 12 0`, class:'p-heat' }));
      return g;
    },

    door(e){
      const g = el('g');
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-md' }));
      g.appendChild(el('rect', { x:e.x+8, y:e.y+8, width:e.w-16, height:e.h-16, class:'p-dk' }));
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-edge' }));
      if (e.open) g.appendChild(el('rect', { x:e.x+8, y:e.y+8, width:e.w-16, height:e.h-16, fill:'#e0a44a', opacity:.22 }));
      g.appendChild(el('rect', { x:e.x+e.w-24, y:e.y+e.h/2-14, width:7, height:26, class:'p-hi' }));
      if (e.led) g.appendChild(el('circle', { cx:e.x+18, cy:e.y+e.h/2, r:5, class:e.led === 'red' ? 'p-led-r' : e.led === 'off' ? 'p-led-o' : 'p-led-g' }));
      return g;
    },

    panel(e){                                 // 屏幕、终端、仪表
      const g = el('g');
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-dk' }));
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-edge' }));
      const on = e.on !== false;
      g.appendChild(el('rect', { x:e.x+7, y:e.y+7, width:e.w-14, height:e.h-22, fill:on ? (dim(e.tint, 0.22) || '#12211c') : '#0d100f' }));
      if (on){
        for (let y = e.y + 10; y < e.y + e.h - 18; y += 4)
          g.appendChild(el('line', { x1:e.x+7, y1:y, x2:e.x+e.w-7, y2:y, class:'p-scan' }));
        if (e.text){
          const lines = String(e.text).split(/\r?\n/).slice(0, 4);
          const lh = Math.min(13, (e.h - 26) / Math.max(1, lines.length));
          lines.forEach((ln, i) => {
            const t = el('text', {
              x: e.x + e.w/2,
              y: e.y + e.h/2 - 6 - (lines.length-1)*lh/2 + i*lh,
              class:'p-scrtxt', 'text-anchor':'middle',
            });
            t.textContent = ln.slice(0, 20);
            g.appendChild(t);
          });
        }
      }
      return g;
    },

    window(e){
      const g = el('g');
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-dk' }));
      g.appendChild(el('rect', { x:e.x+8, y:e.y+8, width:e.w-16, height:e.h-16, fill:dim(e.tint, 0.20) || '#1b201f' }));
      const seed = (e.x * 31 + e.y * 17) | 0;
      if (e.noise !== false)
        for (let i = 0; i < 40; i++)
          g.appendChild(el('rect', {
            x: e.x + 10 + ((seed + i * 37) % Math.max(1, e.w - 20)),
            y: e.y + 10 + ((seed + i * 53) % Math.max(1, e.h - 20)),
            width:2, height:2, class:'p-noise', opacity:.2 + ((i * 7) % 10) / 22,
          }));
      g.appendChild(el('line', { x1:e.x+e.w/2, y1:e.y+8, x2:e.x+e.w/2, y2:e.y+e.h-8, class:'p-edge' }));
      g.appendChild(el('line', { x1:e.x+8, y1:e.y+e.h/2, x2:e.x+e.w-8, y2:e.y+e.h/2, class:'p-edge' }));
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-edge' }));
      return g;
    },

    light(e){                                 // 光源：亮就有光晕
      const g = el('g');
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:Math.max(4, e.h), class:e.on === false ? 'p-dk' : 'p-hi' }));
      if (e.on !== false){
        const r = el('ellipse', { cx:e.x+e.w/2, cy:e.y+e.h+70, rx:e.w*1.5, ry:100, fill:'url(#pGlow)', opacity:.5 });
        g.insertBefore(r, g.firstChild);
      }
      return g;
    },

    figure(e){                                // 人形剪影
      const g = el('g'), cx = e.x + e.w / 2, h = e.h, w = e.w;
      const headR = Math.min(w * 0.26, h * 0.11);
      const neck = e.y + headR * 2.1;
      const shoulder = e.y + h * 0.30, hipY = e.y + h;
      const sw = w * 0.46, hw = w * 0.30;      // 半肩宽 / 半胯宽
      g.appendChild(el('circle', { cx, cy:e.y + headR, r:headR, class:'p-fig' }));
      g.appendChild(el('path', {
        d:`M${cx - w*0.10} ${neck} L${cx + w*0.10} ${neck}` +
          ` L${cx + sw} ${shoulder} L${cx + hw} ${hipY} L${cx - hw} ${hipY} L${cx - sw} ${shoulder} Z`,
        class:'p-fig',
      }));
      if (e.faint) g.setAttribute('opacity', .45);
      return g;
    },

    pipe(e){
      const g = el('g'), horiz = e.w >= e.h;
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-md' }));
      const n = Math.max(2, Math.floor((horiz ? e.w : e.h) / 60));
      for (let i = 1; i < n; i++){
        const p = i / n;
        g.appendChild(horiz
          ? el('rect', { x:e.x+e.w*p-4, y:e.y-3, width:8, height:e.h+6, class:'p-hi' })
          : el('rect', { x:e.x-3, y:e.y+e.h*p-4, width:e.w+6, height:8, class:'p-hi' }));
      }
      return g;
    },

    cable(e){                                 // 垂下的线缆：跨度要够宽，下垂量不超过跨度的一半
      const g = el('g');
      const w = Math.max(60, e.w);
      const sag = Math.min(Math.max(18, e.h), w * 0.5);
      g.appendChild(el('path', { d:`M${e.x} ${e.y} Q${e.x + w/2} ${e.y + sag * 2} ${e.x + w} ${e.y}`, class:'p-cable' }));
      return g;
    },

    container(e){                             // 柜子、抽屉、储物箱
      const g = KINDS.box(e);
      const rows = Math.max(1, Math.floor(e.h / 40));
      for (let i = 0; i < rows; i++){
        const y = e.y + (e.h / rows) * i;
        g.appendChild(el('line', { x1:e.x, y1:y, x2:e.x+e.w, y2:y, class:'p-edge' }));
        g.appendChild(el('rect', { x:e.x+e.w/2-10, y:y+(e.h/rows)/2-2, width:20, height:4, class:'p-hi' }));
      }
      if (e.open) g.appendChild(el('rect', { x:e.x-14, y:e.y+e.h-(e.h/rows), width:e.w+14, height:e.h/rows, class:'p-md' }));
      return g;
    },

    text(e){                                  // 墙上的字、标签、编号
      const t = el('text', { x:e.x, y:e.y, class:'p-wall' });
      t.textContent = String(e.text || '').slice(0, 40);
      if (e.faint) t.setAttribute('opacity', .5);
      return t;
    },

    stain(e){                                 // 地面污渍、水痕、划痕
      const g = el('g'), s = (e.x * 13 + e.y * 7) | 0;
      const pts = [];
      for (let i = 0; i < 9; i++){
        const a = (Math.PI * 2 * i) / 9;
        const rr = 0.5 + ((s + i * 41) % 40) / 100;
        pts.push(`${(e.x + e.w/2 + Math.cos(a) * e.w/2 * rr).toFixed(0)},${(e.y + e.h/2 + Math.sin(a) * e.h/2 * rr).toFixed(0)}`);
      }
      g.appendChild(el('polygon', { points:pts.join(' '), class:'p-stain' }));
      return g;
    },

    debris(e){                                // 散落杂物
      const g = el('g'), s = Math.abs((e.x * 19 + e.y * 23) | 0), n = num(e.count, 7);
      for (let i = 0; i < n; i++){
        const w = 4 + ((s + i) % 9), h = 3 + ((s + i * 3) % 5);
        const x = e.x + ((s + i * 61) % Math.max(1, e.w - w));
        const y = e.y + ((s + i * 29) % Math.max(1, e.h - h));
        g.appendChild(el('rect', {
          x, y, width:w, height:h, class:'p-md',
          transform:`rotate(${(s + i * 37) % 60 - 30} ${x + w / 2} ${y + h / 2})`,
        }));
      }
      return g;
    },

    redact(e){                                // 涂黑：它不让你看的部分
      const g = el('g');
      g.appendChild(el('rect', { x:e.x, y:e.y, width:e.w, height:e.h, class:'p-redact' }));
      return g;
    },
  };

  /* 模型给的 tint 有时亮得炸眼，在这套暗调里会毁掉画面。
     统一压到亮度上限以下，保留色相。 */
  function dim(hex, cap){
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    let r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    if (lum > cap){
      const k = cap / lum;
      r = Math.round(r*k); g = Math.round(g*k); b = Math.round(b*k);
    }
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  }

  const FLOOR = 445;

  function draw(svg, scene){
    svg.innerHTML = '';

    const defs = el('defs');
    defs.innerHTML =
      '<linearGradient id="pWall" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#161a19"/><stop offset="100%" stop-color="#0c0f0e"/></linearGradient>' +
      '<radialGradient id="pGlow"><stop offset="0%" stop-color="rgba(224,164,74,.30)"/>' +
        '<stop offset="100%" stop-color="rgba(224,164,74,0)"/></radialGradient>';
    svg.appendChild(defs);

    const floor = num(scene.floor, FLOOR);
    svg.appendChild(el('rect', { x:0, y:0, width:800, height:floor, fill:'url(#pWall)' }));
    svg.appendChild(el('rect', { x:0, y:floor, width:800, height:500-floor, fill:'#070908' }));
    svg.appendChild(el('line', { x1:0, y1:floor, x2:800, y2:floor, class:'p-edge' }));

    const body = el('g');
    for (const raw of scene.elements || []){
      const e = normalize(raw);
      const f = KINDS[e.kind];
      if (!f) continue;                       // 认不出来的图元直接跳过，不崩
      try { const n = f(e); n.dataset.id = e.id; body.appendChild(n); } catch (err) {}
    }
    svg.appendChild(body);

    const hs = el('g', { id:'hotspots' });
    svg.appendChild(hs);
    return hs;
  }

  /* 尺寸软上限：防止某一件东西大到吃掉整幅画。
     门/管道/窗/涂块本来就可能很大，不限。 */
  const BIG_OK = new Set(['door', 'pipe', 'window', 'redact']);

  /* 容错：坐标夹进画布，尺寸给上下限，字段缺失有默认值 */
  function normalize(e){
    const kind = String(e.kind || '').toLowerCase();
    const x = Math.max(0, Math.min(790, num(e.x, 0)));
    const y = Math.max(0, Math.min(490, num(e.y, 0)));
    const capW = BIG_OK.has(kind) ? 800 : 300;
    const capH = BIG_OK.has(kind) ? 500 : 220;
    return { ...e,
      x, y, kind,
      w: Math.max(4, Math.min(800 - x, capW, num(e.w, 40))),
      h: Math.max(3, Math.min(500 - y, capH, num(e.h, 40))),
    };
  }

  /* 增量更新：按 id 合并，remove:true 表示删掉 */
  function patch(scene, changes){
    const list = scene.elements || (scene.elements = []);
    for (const c of changes || []){
      const i = list.findIndex(e => e.id === c.id);
      if (c.remove){ if (i >= 0) list.splice(i, 1); continue; }
      if (i >= 0) list[i] = { ...list[i], ...c };
      else list.push(c);
    }
    return scene;
  }

  return { draw, patch, KINDS: Object.keys(KINDS) };
})();

if (typeof module !== 'undefined') module.exports = Render;
