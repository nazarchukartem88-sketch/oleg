'use strict';
const $=(s)=>document.querySelector(s);
const $$=(s)=>[...document.querySelectorAll(s)];
let props=[];
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadProps(){
 try{const r=await fetch('/api/properties');props=await r.json();renderProps(props);}catch(e){console.error(e);}
}
function renderProps(items){
 const grid=$('#propertyGrid'); if(!grid)return;
 grid.innerHTML=items.length?items.map(p=>`<article class="property" data-type="${esc(p.type)}">
 <div class="property-media"><img src="${p.images?.[0]||'og-image.jpg'}" alt="${esc(p.title)}"><span class="pill">${esc(p.status||'Актуально')}</span></div>
 <div class="property-body"><div class="property-location">Чернівці • ${esc(p.district)}</div><h3>${esc(p.title)}</h3>
 <div class="property-meta"><span>${Number(p.area||0)} м²</span><span>${Number(p.rooms||0)} кім.</span></div>
 <div class="property-footer"><span class="price">$${Number(p.price||0).toLocaleString('uk-UA')}</span><button class="details" data-id="${p.id}">Детальніше</button></div></div></article>`).join(''):
 '<p class="muted">Об’єкти скоро з’являться. Залиште заявку — підберемо актуальні варіанти.</p>';
 $$('.details').forEach(b=>b.onclick=()=>openProp(b.dataset.id));
}
function openProp(id){const p=props.find(x=>String(x.id)===String(id));if(!p)return;
 $('#projectLocation').textContent=`Чернівці • ${p.district}`;$('#projectTitle').textContent=p.title;$('#projectDescription').textContent=p.description;$('#projectPrice').textContent=`$${Number(p.price||0).toLocaleString('uk-UA')}`;
 $('#projectFacts').innerHTML=`<span>${Number(p.area||0)} м²</span><span>${Number(p.rooms||0)} кім.</span><span>${esc(p.status||'Актуально')}</span>`;
 $('#projectGallery').innerHTML=(p.images||[]).map(x=>`<img src="${x}" alt="${esc(p.title)}">`).join('')+(p.video_url?`<p><a href="${esc(p.video_url)}" target="_blank" rel="noopener">Переглянути відео</a></p>`:'');
 $('#projectModal').classList.add('open');$('#projectModal').setAttribute('aria-hidden','false');
}
$('#projectClose')?.addEventListener('click',()=>$('#projectModal').classList.remove('open'));
$$('.filter').forEach(b=>b.onclick=()=>{$$('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderProps(b.dataset.filter==='all'?props:props.filter(p=>p.type===b.dataset.filter));});
$('#leadForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,fd=new FormData(f),st=$('#formStatus'),btn=f.querySelector('button[type=submit]');
 const payload=Object.fromEntries(fd.entries());payload.page_url=location.href;
 st.textContent='Надсилаємо…';btn.disabled=true;
 try{const r=await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Помилка');st.textContent='Дякуємо! Заявку отримано.';f.reset();}
 catch(err){st.textContent=err.message||'Не вдалося надіслати заявку.';}finally{btn.disabled=false;}
});
$('#menuBtn')?.addEventListener('click',()=>$('#nav')?.classList.toggle('open'));
$('#cookieAccept')?.addEventListener('click',()=>$('#cookieBanner')?.classList.add('hidden'));
loadProps();
