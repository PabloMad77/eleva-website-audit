const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let currentReport = null;

const categoryNames = {design:'Diseño & UX',mobile:'Mobile',speed:'Velocidad',seo:'SEO',structure:'Estructura',content:'Contenido',conversion:'Conversión',visibility:'Visibilidad'};
const categoryOrder = ['design','mobile','speed','seo','structure','content','conversion','visibility'];

function normalizeUrl(v){ let s=v.trim(); if(!/^https?:\/\//i.test(s)) s='https://'+s; return new URL(s).href; }
function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Math.round(n)))}
function scoreLabel(s){return s>=90?'Excelente':s>=80?'Muy bien':s>=70?'Buen punto de partida':s>=55?'Necesita optimización':'Oportunidad importante'}
function scoreSummary(s){return s>=80?'El sitio tiene una base sólida. Enfócate en mejoras puntuales para convertir mejor.':s>=60?'Hay una buena base, pero varias mejoras pueden elevar visibilidad, experiencia y conversión.':'El sitio presenta oportunidades claras que pueden afectar confianza, descubrimiento o generación de clientes.'}
function statusClass(s){return s>=80?'good':s>=55?'warning':'critical'}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}

$$('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{ $$('.nav-item').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); $$('.view').forEach(v=>v.classList.remove('active')); $('#'+btn.dataset.view+'View').classList.add('active'); if(btn.dataset.view==='history') renderHistory(); }));

$('#auditForm').addEventListener('submit',async e=>{
  e.preventDefault(); let url; try{url=normalizeUrl($('#urlInput').value)}catch{toast('Ingresa una URL válida');return}
  setLoading(true,'Conectando con el sitio…','Analizando HTML, SEO, conversión y señales de descubrimiento.');
  try{
    const res=await fetch('/api/audit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
    const data=await res.json(); if(!res.ok) throw new Error(data.error||'No se pudo completar la auditoría');
    currentReport=buildReport(data); renderReport(currentReport); saveHistory(currentReport);
  }catch(err){toast(err.message); console.error(err)}finally{setLoading(false)}
});

function setLoading(on,title,text){$('#auditButton').disabled=on;$('#auditButton').textContent=on?'Analizando…':'Auditar sitio';$('#progressCard').classList.toggle('hidden',!on);if(title)$('#progressTitle').textContent=title;if(text)$('#progressText').textContent=text;}

function buildReport(raw){
  const s=raw.scan||{}, psi=raw.pagespeed||{}, cats=psi.categories||{};
  const scores={
    speed: cats.performance ?? scoreSpeedFallback(s),
    seo: weighted([cats.seo,scoreSeo(s)],[.55,.45]),
    mobile: scoreMobile(s,psi),
    structure: scoreStructure(s),
    content: scoreContent(s),
    conversion: scoreConversion(s),
    visibility: scoreVisibility(s),
    design: scoreDesign(s,cats.accessibility,cats.bestPractices)
  };
  Object.keys(scores).forEach(k=>scores[k]=clamp(scores[k]));
  const weights={design:.12,mobile:.12,speed:.14,seo:.15,structure:.10,content:.11,conversion:.16,visibility:.10};
  const overall=clamp(Object.entries(weights).reduce((a,[k,w])=>a+scores[k]*w,0));
  const findings=makeFindings(s,psi,scores,raw);
  return {version:'1.0',url:raw.url,finalUrl:raw.finalUrl||raw.url,domain:new URL(raw.finalUrl||raw.url).hostname.replace(/^www\./,''),createdAt:new Date().toISOString(),overall,scores,scan:s,pagespeed:psi,findings,priorities:findings.filter(f=>f.status!=='good').sort((a,b)=>severity(b.status)-severity(a.status)||b.impact-a.impact).slice(0,5)};
}
function weighted(vals,weights){let a=0,w=0;vals.forEach((v,i)=>{if(typeof v==='number'){a+=v*weights[i];w+=weights[i]}});return w?a/w:60}
function scoreSpeedFallback(s){let sc=55;if(s.lazyImages)sc+=8;if(s.imageCount<20)sc+=8;if(s.scriptCount<12)sc+=7;if(s.stylesheetCount<8)sc+=5;return sc}
function scoreSeo(s){let sc=0;sc+=s.title?18:0;sc+=s.metaDescription?16:0;sc+=s.h1Count===1?14:s.h1Count>0?7:0;sc+=s.canonical?10:0;sc+=s.robotsMetaNoindex?0:8;sc+=s.openGraph?8:0;sc+=s.schema?10:0;sc+=s.altCoverage>=.8?9:s.altCoverage>=.5?5:0;sc+=s.lang?7:0;return sc}
function scoreMobile(s,psi){let sc=0;sc+=s.viewport?32:0;sc+=s.responsiveSignals?18:0;sc+=s.tapTargetSignals?8:0;sc+=s.lazyImages?7:0;sc+=(psi.categories?.performance??65)*.22;sc+=(psi.categories?.accessibility??70)*.13;return sc}
function scoreStructure(s){let sc=0;sc+=s.h1Count===1?22:s.h1Count>0?10:0;sc+=s.headingCount>=4?16:s.headingCount*4;sc+=s.nav?14:0;sc+=s.main?12:0;sc+=s.footer?8:0;sc+=s.sectionCount>=3?12:s.sectionCount*4;sc+=s.internalLinks>=5?10:Math.min(10,s.internalLinks*2);sc+=s.semanticSignals?6:0;return sc}
function scoreContent(s){let sc=0;sc+=s.wordCount>=500?28:s.wordCount>=250?20:s.wordCount>=100?11:4;sc+=s.titleLength>=25&&s.titleLength<=65?14:s.title?7:0;sc+=s.descriptionLength>=70&&s.descriptionLength<=165?14:s.metaDescription?7:0;sc+=s.headingCount>=5?12:Math.min(12,s.headingCount*2);sc+=s.serviceSignals?10:0;sc+=s.trustSignals?10:0;sc+=s.contactSignals?7:0;sc+=s.faqSignals?5:0;return sc}
function scoreConversion(s){let sc=0;sc+=s.ctaCount>=2?18:s.ctaCount?10:0;sc+=s.whatsapp?20:0;sc+=s.formCount?14:0;sc+=s.quoteSignals?12:0;sc+=s.phone?8:0;sc+=s.email?6:0;sc+=s.socialLinks>=2?6:s.socialLinks?3:0;sc+=s.trustSignals?10:0;sc+=s.contactSignals?6:0;return sc}
function scoreVisibility(s){let sc=0;sc+=s.canonical?14:0;sc+=s.robotsTxt?18:0;sc+=s.sitemap?22:0;sc+=!s.robotsMetaNoindex?12:0;sc+=s.schema?12:0;sc+=s.openGraph?8:0;sc+=s.title&&s.metaDescription?8:0;sc+=s.localSignals?6:0;return sc}
function scoreDesign(s,a11y,bp){let sc=35;sc+=s.viewport?8:0;sc+=s.nav?7:0;sc+=s.ctaCount?8:0;sc+=s.headingCount>=4?7:0;sc+=s.trustSignals?5:0;sc+=(a11y??70)*.15;sc+=(bp??70)*.15;return sc}
function severity(s){return s==='critical'?3:s==='warning'?2:1}
function f(status,category,title,detail,impact=5){return{status,category,title,detail,impact}}
function makeFindings(s,p,scores,raw){const out=[];
  out.push(s.title?f('good','SEO','Título SEO encontrado',`“${s.title.slice(0,90)}”`,2):f('critical','SEO','Falta el título de la página','Agrega un <title> descriptivo y orientado a la intención de búsqueda.',10));
  out.push(s.metaDescription?f(s.descriptionLength<70||s.descriptionLength>165?'warning':'good','SEO','Meta description',s.descriptionLength<70||s.descriptionLength>165?`Existe, pero su longitud (${s.descriptionLength}) puede optimizarse.`:'La página cuenta con una descripción útil para buscadores.',5):f('critical','SEO','Falta meta description','Añade una descripción clara que explique el servicio y motive el clic.',8));
  out.push(s.viewport?f('good','Mobile','Viewport móvil configurado','La página declara una vista adaptable para dispositivos móviles.',2):f('critical','Mobile','Falta viewport móvil','Sin viewport, la experiencia en teléfonos puede romperse o escalar incorrectamente.',10));
  out.push(s.h1Count===1?f('good','Estructura','Un H1 principal','La jerarquía principal está claramente definida.',2):s.h1Count===0?f('critical','Estructura','No encontramos H1','Define un encabezado H1 único que explique claramente la propuesta.',8):f('warning','Estructura',`${s.h1Count} encabezados H1`,`Conviene consolidar la jerarquía en un H1 principal.`,5));
  out.push(s.whatsapp?f('good','Conversión','WhatsApp detectado','Existe una ruta directa a conversación por WhatsApp.',3):f('warning','Conversión','WhatsApp no detectado','Si el negocio vende por conversación, un CTA a WhatsApp puede reducir fricción.',7));
  out.push(s.formCount?f('good','Conversión','Formulario detectado',`Encontramos ${s.formCount} formulario(s) en la página.`,2):f('warning','Conversión','Sin formulario visible','Un formulario corto puede capturar prospectos que no quieren iniciar chat.',6));
  out.push(s.quoteSignals?f('good','Conversión','Señales de cotización','La página usa lenguaje o elementos orientados a cotizar/agendar.',3):f('warning','Conversión','Cotización poco evidente','Haz visible una acción como “Cotizar”, “Agendar” o “Solicitar diagnóstico”.',7));
  out.push(s.ctaCount>=2?f('good','Conversión','CTAs suficientes',`Se detectaron ${s.ctaCount} llamadas a la acción relevantes.`,2):f('warning','Conversión','Pocas llamadas a la acción','Repite un CTA principal en hero, mitad de página y cierre.',6));
  out.push(s.sitemap?f('good','Visibilidad','Sitemap disponible','Se detectó sitemap.xml o una referencia válida.',2):f('warning','Visibilidad','Sitemap no encontrado','Publica un sitemap y regístralo en Google Search Console.',6));
  out.push(s.robotsTxt?f('good','Visibilidad','robots.txt disponible','El archivo de directivas para crawlers responde correctamente.',2):f('warning','Visibilidad','robots.txt no encontrado','Añade robots.txt para controlar rastreo e indicar el sitemap.',4));
  out.push(s.canonical?f('good','SEO','Canonical configurado','Ayuda a consolidar la URL preferida.',2):f('warning','SEO','Canonical no detectado','Añade rel="canonical" para reducir ambigüedad de URLs.',4));
  out.push(s.schema?f('good','Visibilidad','Datos estructurados detectados','Schema puede ayudar a buscadores a comprender el negocio.',2):f('warning','Visibilidad','Sin datos estructurados','Considera Organization/LocalBusiness, Service y FAQ schema cuando aplique.',5));
  out.push(s.altCoverage>=.8?f('good','Contenido','Buen uso de texto alternativo',`${Math.round(s.altCoverage*100)}% de imágenes tiene alt.`,2):f('warning','Contenido','Imágenes sin alt',`Cobertura estimada: ${Math.round(s.altCoverage*100)}%. Mejora accesibilidad y contexto SEO.`,5));
  if(typeof p.categories?.performance==='number') out.push(p.categories.performance>=80?f('good','Velocidad','Performance móvil sólida',`Google PageSpeed: ${p.categories.performance}/100.`,3):p.categories.performance>=55?f('warning','Velocidad','Performance móvil mejorable',`Google PageSpeed: ${p.categories.performance}/100. Revisa imágenes, JS y recursos bloqueantes.`,8):f('critical','Velocidad','Performance móvil baja',`Google PageSpeed: ${p.categories.performance}/100. La lentitud puede afectar experiencia y conversión.`,10));
  if(raw.fetchWarnings?.length) out.push(f('warning','Técnico','Auditoría parcial',raw.fetchWarnings.join(' '),4));
  return out;
}

function renderReport(r){
  $('#results').classList.remove('hidden'); $('#reportDomain').textContent=r.domain; $('#reportDate').textContent=`${new Date(r.createdAt).toLocaleString('es-MX')} · ${r.finalUrl}`;
  $('#overallScore').textContent=r.overall; $('#scoreLabel').textContent=scoreLabel(r.overall); $('#scoreSummary').textContent=scoreSummary(r.overall); $('#scoreRing').style.background=`conic-gradient(var(--accent) ${r.overall*3.6}deg,#edf0f3 0deg)`;
  $('#categoryCards').innerHTML=categoryOrder.map(k=>`<article class="category-card"><div class="cat-top"><span>${categoryNames[k]}</span><strong>${r.scores[k]}</strong></div><div class="bar"><i style="width:${r.scores[k]}%"></i></div></article>`).join('');
  $('#priorities').innerHTML=r.priorities.length?r.priorities.map((x,i)=>`<div class="priority"><div class="priority-num">${i+1}</div><div><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></div><span class="impact ${x.status}">${x.status==='critical'?'Alta':x.status==='warning'?'Media':'Baja'}</span></div>`).join(''):'<p class="muted">No se detectaron prioridades críticas.</p>';
  const s=r.scan; const checks=[['WhatsApp',s.whatsapp],['Formulario',s.formCount>0],['Cotización / agenda',s.quoteSignals],['CTA principal',s.ctaCount>0],['Teléfono',s.phone],['Email',s.email],['Prueba social / confianza',s.trustSignals],['Redes sociales',s.socialLinks>0]];
  $('#conversionChecklist').innerHTML=checks.map(([n,v])=>`<div class="check"><span>${n}</span><b class="${v?'ok':'no'}">${v?'✓ Sí':'✕ No'}</b></div>`).join('');
  renderMetrics(r.pagespeed); renderFindings(r.findings); $('#psiStatus').textContent=r.pagespeed.available?'Datos Google PSI':'PSI no disponible';
  $('#results').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderMetrics(p){const m=p.metrics||{};const arr=[['LCP',m.lcp?.display||'—',m.lcp?.rating],['INP',m.inp?.display||'—',m.inp?.rating],['CLS',m.cls?.display||'—',m.cls?.rating],['FCP',m.fcp?.display||'—',m.fcp?.rating],['TBT',m.tbt?.display||'—',m.tbt?.rating],['Speed Index',m.speedIndex?.display||'—',m.speedIndex?.rating]];$('#metrics').innerHTML=arr.map(([n,v,r])=>`<div class="metric"><span>${n}</span><strong>${v}</strong><small class="impact ${r||'warning'}">${r==='good'?'Bueno':r==='critical'?'Lento':r==='warning'?'Mejorar':'Sin dato'}</small></div>`).join('')}
function renderFindings(items,filter='all'){$('#findings').innerHTML=items.filter(x=>filter==='all'||x.status===filter).map(x=>`<div class="finding"><span class="dot ${x.status}"></span><div><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></div><span class="finding-tag">${esc(x.category)}</span></div>`).join('')}
$$('.mini-btn').forEach(b=>b.addEventListener('click',()=>{$$('.mini-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(currentReport)renderFindings(currentReport.findings,b.dataset.filter)}));
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

$('#shareBtn').addEventListener('click',async()=>{if(!currentReport)return;const r=currentReport;const lines=[`ELEVA Website Audit — ${r.domain}`,`Score general: ${r.overall}/100`,...categoryOrder.map(k=>`${categoryNames[k]}: ${r.scores[k]}/100`),'','Top oportunidades:',...r.priorities.map((p,i)=>`${i+1}. ${p.title} — ${p.detail}`)];await navigator.clipboard.writeText(lines.join('\n'));toast('Resumen copiado')});
$('#proposalBtn').addEventListener('click',async()=>{if(!currentReport)return;const r=currentReport;const t=`Propuesta de optimización para ${r.domain}\n\nObjetivo: elevar la experiencia, visibilidad y conversión del sitio actual.\n\nPrioridades detectadas:\n${r.priorities.map((p,i)=>`${i+1}. ${p.title}: ${p.detail}`).join('\n')}\n\nRecomendación ELEVA: trabajar primero las oportunidades de mayor impacto y validar nuevamente el score después de implementar mejoras.`;await navigator.clipboard.writeText(t);toast('Resumen de propuesta copiado')});

$('#pdfBtn').addEventListener('click',()=>{if(!currentReport)return; if(window.jspdf?.jsPDF) generatePdf(currentReport); else window.print();});
function generatePdf(r){
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:'mm',format:'a4'}); const W=210; let y=18;
  const text=(t,x,yy,size=10,style='normal',max=174)=>{doc.setFont('helvetica',style);doc.setFontSize(size);const lines=doc.splitTextToSize(String(t),max);doc.text(lines,x,yy);return yy+lines.length*(size*.43)+2};
  doc.setFillColor(12,13,16);doc.rect(0,0,W,52,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('ELEVA WEBSITE AUDIT',18,17);doc.setFontSize(24);doc.text(r.domain,18,30);doc.setFontSize(10);doc.setTextColor(190);doc.text(new Date(r.createdAt).toLocaleDateString('es-MX'),18,39);doc.setTextColor(255);doc.setFontSize(30);doc.text(String(r.overall),166,31);doc.setFontSize(9);doc.text('/100',183,31);
  y=64;doc.setTextColor(17);doc.setFontSize(15);doc.setFont('helvetica','bold');doc.text('Score por categoría',18,y);y+=9;
  categoryOrder.forEach((k,i)=>{const x=i%2===0?18:108;if(i%2===0&&i>0)y+=18;doc.setFontSize(9);doc.setFont('helvetica','normal');doc.text(categoryNames[k],x,y);doc.setFont('helvetica','bold');doc.text(`${r.scores[k]}/100`,x+64,y);doc.setFillColor(235);doc.roundedRect(x,y+3,72,3,1.5,1.5,'F');doc.setFillColor(20,20,20);doc.roundedRect(x,y+3,72*r.scores[k]/100,3,1.5,1.5,'F');});
  y+=29;doc.setFontSize(15);doc.text('Top oportunidades',18,y);y+=8;r.priorities.forEach((p,i)=>{doc.setFontSize(9);doc.setFont('helvetica','bold');doc.text(`${i+1}. ${p.title}`,18,y);y=text(p.detail,24,y+5,8,'normal',160)+4;if(y>270){doc.addPage();y=18}});
  y+=3;doc.setFontSize(15);doc.setFont('helvetica','bold');doc.text('Hallazgos',18,y);y+=8;r.findings.forEach(p=>{if(y>270){doc.addPage();y=18}doc.setFontSize(9);doc.setFont('helvetica','bold');doc.text(`• ${p.title} [${p.category}]`,18,y);y=text(p.detail,22,y+5,8,'normal',164)+3});
  doc.setFontSize(7);doc.setTextColor(120);doc.text('Reporte generado por ELEVA Website Audit v1.0 · madebyeleva.com',18,289);doc.save(`ELEVA-Audit-${r.domain}-${new Date().toISOString().slice(0,10)}.pdf`);
}

function saveHistory(r){let h=JSON.parse(localStorage.getItem('elevaAudits')||'[]');h=h.filter(x=>x.domain!==r.domain);h.unshift({domain:r.domain,url:r.finalUrl,overall:r.overall,scores:r.scores,createdAt:r.createdAt,report:r});localStorage.setItem('elevaAudits',JSON.stringify(h.slice(0,20)))}
function renderHistory(){const h=JSON.parse(localStorage.getItem('elevaAudits')||'[]');$('#historyList').innerHTML=h.length?h.map((x,i)=>`<div class="history-item"><div><strong>${esc(x.domain)}</strong><p>${new Date(x.createdAt).toLocaleString('es-MX')}</p></div><div class="history-score">${x.overall}</div><button class="secondary-btn" data-open="${i}">Abrir</button></div>`).join(''):'<div class="panel"><p class="muted">Aún no hay auditorías guardadas en este dispositivo.</p></div>';$$('[data-open]').forEach(b=>b.onclick=()=>{currentReport=h[+b.dataset.open].report;renderReport(currentReport);$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view==='audit'));$$('.view').forEach(v=>v.classList.remove('active'));$('#auditView').classList.add('active')})}
$('#clearHistory').addEventListener('click',()=>{localStorage.removeItem('elevaAudits');renderHistory();toast('Historial eliminado')});
