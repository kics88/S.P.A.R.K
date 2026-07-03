export const $ = id => document.getElementById(id);
export const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

export function el(tag, cls, html=''){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(html) e.innerHTML = html;
  return e;
}

export function flash(btn, msg, ms=1400){
  const old = btn.textContent;
  btn.textContent = msg;
  btn.disabled = true;
  setTimeout(()=>{ btn.textContent = old; btn.disabled = false; }, ms);
}

export function fmtTime(secs){
  const s = Math.max(0, Math.floor(secs));
  const d  = Math.floor(s/86400);
  const h  = Math.floor((s%86400)/3600);
  const m  = Math.floor((s%3600)/60);
  const ss = s%60;
  if(d>0) return `${d}:${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  if(h>0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

export function overlayUrlForMode(mode, tool, urls){
  if(mode==='unique') return urls[tool]||'';
  return urls.master||'';
}

export function renderOverlayBar(modeSelId, urlInputId, copyBtnId, tool, urls){
  const sel = $(modeSelId), inp = $(urlInputId), btn = $(copyBtnId);
  if(!sel||!inp||!btn) return;
  const { invoke } = window.__TAURI__.core;
  function update(){
    inp.value = overlayUrlForMode(sel.value, tool, urls);
    // tell master overlay whether to show this tool
    invoke('set_tool_visibility', { tool, visible: sel.value === 'master' });
  }
  sel.addEventListener('change', update);
  btn.addEventListener('click', ()=>navigator.clipboard.writeText(inp.value));
  update(); // run once on init to set initial visibility
}

// Drag-to-reorder (mouse-based, works in Tauri WebView)
let dragSrc = null, dragGhost = null, dragOffY = 0;
export function initDrag(container, onReorder){
  container.querySelectorAll('.drag-handle').forEach(handle=>{
    handle.addEventListener('mousedown', e=>{
      e.preventDefault();
      const row = handle.closest('[data-i]');
      dragSrc = +row.dataset.i;
      dragGhost = row.cloneNode(true);
      dragGhost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;width:${row.offsetWidth}px;opacity:.85;background:#3a315e;border-radius:8px;padding:4px 8px;left:${row.getBoundingClientRect().left}px;`;
      dragOffY = e.clientY - row.getBoundingClientRect().top;
      dragGhost.style.top = (e.clientY - dragOffY) + 'px';
      document.body.appendChild(dragGhost);
      row.style.opacity = '0.3';
      const onMove = ev=>{
        dragGhost.style.top = (ev.clientY - dragOffY)+'px';
        container.querySelectorAll('[data-i]').forEach(r=>{
          const rect = r.getBoundingClientRect();
          r.classList.toggle('drag-over', ev.clientY>=rect.top && ev.clientY<=rect.bottom);
        });
      };
      const onUp = ev=>{
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if(dragGhost){ dragGhost.remove(); dragGhost=null; }
        container.querySelectorAll('[data-i]').forEach(r=>{ r.style.opacity=''; r.classList.remove('drag-over'); });
        let dest = null;
        container.querySelectorAll('[data-i]').forEach(r=>{
          const rect = r.getBoundingClientRect();
          if(ev.clientY>=rect.top && ev.clientY<=rect.bottom) dest = +r.dataset.i;
        });
        if(dest!==null && dest!==dragSrc) onReorder(dragSrc, dest);
        dragSrc = null;
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}
