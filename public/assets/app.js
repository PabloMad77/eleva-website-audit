const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let currentReport = null;

const categoryNames = {design:'Diseño & UX',mobile:'Mobile',speed:'Velocidad',seo:'SEO',structure:'Estructura',content:'Contenido',conversion:'Conversión',visibility:'Visibilidad'};
const categoryOrder = ['design','mobile','speed','seo','structure','content','conversion','visibility'];

function normalizeUrl(v){ let s=v.trim(); if(!/^https?:\/\//i.test(s)) s='https://'+s; return new URL(s).href; }
function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Math.round(n)))}
function scoreLabel(s){return s>=90?'Excelente':s>=80?'Muy bien':s>=70?'Buen punto de partida':s>=55?'Necesita optimización':'Oportunidad importante'}
function scoreSummary(s){return s>=80?'El sitio tiene una base sólida. Enfócate en mejoras puntuales para convertir mejor.':s>=60?'Hay una buena base, pero varias mejoras pueden elevar visibilidad, experiencia y conversión.':'El sitio presenta oportunidades claras que pueden afectar confianza, descubrimiento o generación de clientes.'}
function improvementPotential(r){
  const critical=(r.priorities||[]).filter(x=>x.status==='critical').length;
  const weak=Object.values(r.scores||{}).filter(v=>v<60).length;
  if(r.overall<70 || critical>=2 || weak>=3) return {level:'ALTO',kind:'red',detail:'Hay oportunidades claras que pueden generar una mejora visible en experiencia, conversión y presencia digital si se atienden las prioridades principales.'};
  if(r.overall<85 || critical>=1 || weak>=1) return {level:'MEDIO',kind:'amber',detail:'El sitio tiene una base aprovechable y puede mejorar de forma medible con optimizaciones focalizadas.'};
  return {level:'BAJO',kind:'green',detail:'La base actual es sólida. El mayor valor vendrá de mejoras incrementales, pruebas de conversión y optimización continua.'};
}
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
    seo: weighted([cats.seo,scoreSeo(s)],[.65,.35]),
    mobile: scoreMobile(s,psi),
    structure: scoreStructure(s),
    content: scoreContent(s),
    conversion: scoreConversion(s),
    visibility: scoreVisibility(s),
    design: scoreDesign(s,cats.accessibility,cats.bestPractices)
  };
  Object.keys(scores).forEach(k=>scores[k]=clamp(scores[k]));

  // ELEVA v1.2 is intentionally weighted for SMB / lead-generation websites:
  // conversion and mobile matter more than decorative/structural signals.
  const weights={design:.10,mobile:.15,speed:.15,seo:.15,structure:.07,content:.10,conversion:.20,visibility:.08};
  let overall=clamp(Object.entries(weights).reduce((a,[k,w])=>a+scores[k]*w,0));

  // Indexability is a hard business constraint: a site intentionally hidden from crawlers
  // should not receive an excellent discoverability or overall score.
  if(s.robotsMetaNoindex || s.robotsDisallowAll){
    scores.visibility=Math.min(scores.visibility,20);
    overall=Math.min(overall,69);
  }

  const findings=makeFindings(s,psi,scores,raw);
  const recommendation=buildRecommendation(scores,s,overall);
  const strengths=buildStrengths(s,psi,scores);
  return {version:'1.8',url:raw.url,finalUrl:raw.finalUrl||raw.url,domain:new URL(raw.finalUrl||raw.url).hostname.replace(/^www\./,''),createdAt:new Date().toISOString(),overall,scores,scan:s,pagespeed:psi,findings,recommendation,strengths,priorities:findings.filter(f=>f.status!=='good').sort((a,b)=>severity(b.status)-severity(a.status)||b.impact-a.impact).slice(0,5)};
}
function weighted(vals,weights){let a=0,w=0;vals.forEach((v,i)=>{if(typeof v==='number'){a+=v*weights[i];w+=weights[i]}});return w?a/w:60}
function scoreSpeedFallback(s){let sc=50;if(s.lazyImages)sc+=8;if(s.imageCount<=12)sc+=7;if(s.scriptCount<=8)sc+=7;if(s.stylesheetCount<=6)sc+=5;return sc}
function scoreSeo(s){
  let sc=0;
  sc+=s.title?16:0;
  sc+=s.metaDescription?14:0;
  sc+=s.h1Count===1?12:s.h1Count>0?6:0;
  sc+=s.canonical?10:0;
  sc+=!s.robotsMetaNoindex?12:0;
  sc+=s.openGraph?6:0;
  sc+=s.schema?10:0;
  sc+=s.altCoverage>=.9?10:s.altCoverage>=.7?7:s.altCoverage>=.5?4:0;
  sc+=s.lang?5:0;
  sc+=s.internalLinks>=3?5:Math.min(5,s.internalLinks);
  return sc;
}
function scoreMobile(s,psi){
  const perf=psi.categories?.performance;
  const a11y=psi.categories?.accessibility;
  let sc=0;
  sc+=s.viewport?20:0;
  sc+=s.responsiveSignals?10:0;
  sc+=s.tapTargetSignals?5:0;
  sc+=s.lazyImages?5:0;
  sc+=(typeof perf==='number'?perf:65)*.35;
  sc+=(typeof a11y==='number'?a11y:70)*.25;
  return sc;
}
function scoreStructure(s){
  let sc=0;
  sc+=s.h1Count===1?20:s.h1Count>0?10:0;
  sc+=s.headingCount>=4?14:Math.min(14,s.headingCount*3);
  sc+=s.nav?14:0;
  sc+=s.main?12:0;
  sc+=s.footer?8:0;
  sc+=s.sectionCount>=3?10:Math.min(10,s.sectionCount*3);
  sc+=s.internalLinks>=5?12:Math.min(12,s.internalLinks*2);
  sc+=s.semanticSignals?10:0;
  return sc;
}
function scoreContent(s){
  let sc=0;
  // More words are not automatically better. Reward enough context, not verbosity.
  sc+=s.wordCount>=250?20:s.wordCount>=120?14:s.wordCount>=60?8:3;
  sc+=s.title?12:0;
  sc+=s.metaDescription?10:0;
  sc+=s.headingCount>=4?10:Math.min(10,s.headingCount*2);
  sc+=s.serviceSignals?15:0;
  sc+=s.trustSignals?15:0;
  sc+=s.contactSignals?10:0;
  sc+=s.faqSignals?8:0;
  sc+=s.altCoverage>=.8?10:s.altCoverage>=.5?5:0;
  return sc;
}
function scoreConversion(s){
  let sc=0;
  const directLeadPath=s.whatsapp || s.formCount>0;
  const contactPath=s.phone || s.email || s.whatsapp;
  sc+=s.ctaCount>=3?20:s.ctaCount>=1?13:0;
  sc+=directLeadPath?20:0;
  sc+=s.quoteSignals?15:0;
  sc+=contactPath?10:0;
  sc+=s.trustSignals?15:0;
  sc+=s.contactSignals?8:0;
  sc+=s.formCount>0?5:0;
  sc+=s.whatsapp?4:0;
  sc+=s.socialLinks>=2?3:s.socialLinks?1:0;
  return sc;
}
function scoreVisibility(s){
  if(s.robotsMetaNoindex || s.robotsDisallowAll) return 10;
  let sc=0;
  sc+=s.canonical?12:0;
  sc+=s.robotsTxt?15:0;
  sc+=s.sitemap?20:0;
  sc+=20; // indexability baseline after hard noindex/disallow checks
  sc+=s.schema?12:0;
  sc+=s.openGraph?5:0;
  sc+=s.title&&s.metaDescription?10:0;
  sc+=s.localSignals?6:0;
  return sc;
}
function scoreDesign(s,a11y,bp){
  // This remains a heuristic score. Accessibility and best-practices are stronger
  // proxies than simply counting visual elements.
  const aa=typeof a11y==='number'?a11y:70;
  const bb=typeof bp==='number'?bp:70;
  let structural=0;
  structural+=s.viewport?15:0;
  structural+=s.nav?12:0;
  structural+=s.main?8:0;
  structural+=s.ctaCount?15:0;
  structural+=s.headingCount>=4?12:6;
  structural+=s.trustSignals?10:0;
  structural+=s.footer?8:0;
  structural+=s.responsiveSignals?10:0;
  structural+=s.altCoverage>=.8?10:0;
  return aa*.35+bb*.25+structural*.40;
}
function buildRecommendation(scores,s,overall){
  const weak=Object.entries(scores).sort((a,b)=>a[1]-b[1]).slice(0,3).map(([k])=>categoryNames[k]);
  if(overall<55 || (scores.design<55 && scores.conversion<55)){
    return {level:'Rediseño estratégico',title:'Recomendamos un rediseño enfocado en conversión',detail:`La base actual presenta fricción importante. Priorizaríamos ${weak.join(', ')} y reconstruiríamos el recorrido desde la llegada hasta el contacto.`,scope:['Arquitectura y mensaje','Diseño mobile-first','CTA y captura de leads','SEO técnico base','Medición post-lanzamiento']};
  }
  if(overall<75 || scores.conversion<70 || scores.mobile<70){
    return {level:'Optimización prioritaria',title:'Recomendamos optimizar antes de rediseñar todo',detail:`El sitio tiene una base aprovechable, pero hay oportunidades claras en ${weak.join(', ')}. Una intervención focalizada puede elevar resultados sin rehacer todo desde cero.`,scope:['UX y jerarquía','Conversión y contacto','Performance móvil','SEO on-page','Contenido de confianza']};
  }
  return {level:'Growth & mejora continua',title:'La base es sólida; recomendamos optimización incremental',detail:`El sitio funciona bien. El mayor retorno vendrá de mejorar ${weak.join(', ')} y medir el impacto de cambios específicos.`,scope:['CRO / pruebas de CTA','Performance fina','SEO de contenidos','Schema y visibilidad','Reauditoría periódica']};
}
function buildStrengths(s,psi,scores){
  const items=[];
  const add=(title,detail,category)=>items.push({title,detail,category});
  if((psi.categories?.performance??0)>=90) add('Carga móvil rápida',`Google PageSpeed Performance: ${psi.categories.performance}/100.`, 'Velocidad');
  if((psi.categories?.accessibility??0)>=90) add('Buena accesibilidad',`Lighthouse Accessibility: ${psi.categories.accessibility}/100.`, 'Diseño & UX');
  if(scores.seo>=80) add('Base SEO sólida',`El sitio obtiene ${scores.seo}/100 en SEO y ya cuenta con varias señales on-page correctas.`, 'SEO');
  if(scores.mobile>=80) add('Buena experiencia móvil',`Mobile obtiene ${scores.mobile}/100; conviene conservar esta base al hacer cambios.`, 'Mobile');
  if(s.whatsapp) add('WhatsApp disponible','Existe una ruta directa para iniciar conversación con el negocio.','Conversión');
  if(s.formCount>0) add('Captura de prospectos','El sitio ya cuenta con formulario para recibir información del visitante.','Conversión');
  if(s.trustSignals) add('Señales de confianza','Detectamos elementos como testimonios, reseñas, garantía, experiencia o casos que ayudan a reducir fricción.','Contenido');
  if(s.sitemap && s.robotsTxt) add('Rastreo preparado','robots.txt y sitemap están disponibles para ayudar a los buscadores a recorrer el sitio.','Visibilidad');
  if(s.schema) add('Datos estructurados','El sitio utiliza Schema, una señal útil para que los buscadores comprendan mejor el contenido.','Visibilidad');
  if(s.altCoverage>=.8) add('Imágenes bien descritas',`${Math.round(s.altCoverage*100)}% de las imágenes tienen texto alternativo.`, 'Contenido');
  if(s.ctaCount>=2) add('Llamadas a la acción visibles',`Detectamos ${s.ctaCount} CTA relevantes a lo largo de la página.`, 'Conversión');
  if(!items.length){
    const best=Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0,2);
    best.forEach(([k,v])=>add(`${categoryNames[k]} es una base aprovechable`,`${v}/100. Esta área puede conservarse mientras se atienden las prioridades principales.`,categoryNames[k]));
  }
  return items.slice(0,5);
}

function severity(s){return s==='critical'?3:s==='warning'?2:1}
function f(status,category,title,detail,impact=5){return{status,category,title,detail,impact}}
function makeFindings(s,p,scores,raw){const out=[];
  if(s.robotsMetaNoindex) out.push(f('critical','Visibilidad','Página marcada como noindex','La página indica a buscadores que no debe indexarse. Verifica si es intencional antes de cualquier esfuerzo SEO.',10));
  if(s.robotsDisallowAll) out.push(f('critical','Visibilidad','robots.txt bloquea el sitio','Se detectó una regla que puede impedir el rastreo general del sitio.',10));
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
  if(typeof p.categories?.performance==='number') out.push(p.categories.performance>=90?f('good','Velocidad','Performance móvil sólida',`Google PageSpeed: ${p.categories.performance}/100.`,3):p.categories.performance>=50?f('warning','Velocidad','Performance móvil mejorable',`Google PageSpeed: ${p.categories.performance}/100. Revisa imágenes, JS y recursos bloqueantes.`,8):f('critical','Velocidad','Performance móvil baja',`Google PageSpeed: ${p.categories.performance}/100. La lentitud puede afectar experiencia y conversión.`,10));
  if(typeof p.categories?.accessibility==='number') out.push(p.categories.accessibility>=90?f('good','Diseño & UX','Accesibilidad sólida',`Lighthouse Accessibility: ${p.categories.accessibility}/100.`,2):p.categories.accessibility>=50?f('warning','Diseño & UX','Accesibilidad mejorable',`Lighthouse Accessibility: ${p.categories.accessibility}/100. Revisa contraste, etiquetas y navegación.`,7):f('critical','Diseño & UX','Accesibilidad baja',`Lighthouse Accessibility: ${p.categories.accessibility}/100. Puede afectar el uso del sitio para parte de la audiencia.`,9));
  if(typeof p.categories?.bestPractices==='number' && p.categories.bestPractices<90) out.push(f(p.categories.bestPractices<50?'critical':'warning','Técnico','Best Practices por mejorar',`Lighthouse Best Practices: ${p.categories.bestPractices}/100.`,p.categories.bestPractices<50?9:6));
  if(!s.whatsapp && !s.formCount) out.push(f('critical','Conversión','Sin ruta directa de lead','No detectamos WhatsApp ni formulario. El visitante puede quedarse sin un siguiente paso claro para convertirse en prospecto.',10));
  if(raw.fetchWarnings?.length) out.push(f('warning','Técnico','Auditoría parcial',raw.fetchWarnings.join(' '),4));
  return out;
}

function renderReport(r){
  $('#results').classList.remove('hidden'); $('#reportDomain').textContent=r.domain; $('#reportDate').textContent=`${new Date(r.createdAt).toLocaleString('es-MX')} · ${r.finalUrl}`;
  $('#overallScore').textContent=r.overall; $('#scoreLabel').textContent=scoreLabel(r.overall); $('#scoreSummary').textContent=scoreSummary(r.overall); $('#scoreRing').style.background=`conic-gradient(var(--accent) ${r.overall*3.6}deg,#edf0f3 0deg)`;
  $('#categoryCards').innerHTML=categoryOrder.map(k=>`<article class="category-card"><div class="cat-top"><span>${categoryNames[k]}</span><strong>${r.scores[k]}</strong></div><div class="bar"><i style="width:${r.scores[k]}%"></i></div></article>`).join('');
  $('#strengths').innerHTML=(r.strengths||[]).map(x=>`<div class="strength"><span class="strength-check">✓</span><div><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></div><span>${esc(x.category)}</span></div>`).join('')||'<p class="muted">La mayor fortaleza es que ya existe una base sobre la cual trabajar.</p>';
  $('#priorities').innerHTML=r.priorities.length?r.priorities.map((x,i)=>`<div class="priority"><div class="priority-num">${i+1}</div><div><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></div><span class="impact ${x.status}">${x.status==='critical'?'Urgente':x.status==='warning'?'Importante':'Oportunidad'}</span></div>`).join(''):'<p class="muted">No se detectaron prioridades críticas.</p>';
  const s=r.scan; const checks=[['WhatsApp',s.whatsapp],['Formulario',s.formCount>0],['Cotización / agenda',s.quoteSignals],['CTA principal',s.ctaCount>0],['Teléfono',s.phone],['Email',s.email],['Prueba social / confianza',s.trustSignals],['Redes sociales',s.socialLinks>0]];
  $('#conversionChecklist').innerHTML=checks.map(([n,v])=>`<div class="check"><span>${n}</span><b class="${v?'ok':'no'}">${v?'✓ Sí':'✕ No'}</b></div>`).join('');
  const rec=r.recommendation||{}; $('#recommendationTitle').textContent=rec.title||'—'; $('#recommendationLevel').textContent=rec.level||'—'; $('#recommendationDetail').textContent=rec.detail||'—'; $('#recommendationScope').innerHTML=(rec.scope||[]).map(x=>`<span>${esc(x)}</span>`).join('');
  $('#actionPlanLevel').textContent=rec.level||'ELEVA'; $('#actionPlanText').textContent=rec.detail||'—'; $('#actionPlanScope').innerHTML=(rec.scope||[]).map((x,i)=>`<span><b>${i+1}</b>${esc(x)}</span>`).join('');
  renderMetrics(r.pagespeed); renderFindings(r.findings); $('#psiStatus').textContent=r.pagespeed.available?'Datos Google PSI':'PSI no disponible';
  $('#results').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderMetrics(p){const m=p.metrics||{};const arr=[['LCP',m.lcp?.display||'—',m.lcp?.rating],['INP',m.inp?.display||'—',m.inp?.rating],['CLS',m.cls?.display||'—',m.cls?.rating],['FCP',m.fcp?.display||'—',m.fcp?.rating],['TBT',m.tbt?.display||'—',m.tbt?.rating],['Speed Index',m.speedIndex?.display||'—',m.speedIndex?.rating]];$('#metrics').innerHTML=arr.map(([n,v,r])=>`<div class="metric"><span>${n}</span><strong>${v}</strong><small class="impact ${r||'warning'}">${r==='good'?'Bueno':r==='critical'?'Lento':r==='warning'?'Mejorar':'Sin dato'}</small></div>`).join('')}
function renderFindings(items,filter='all'){$('#findings').innerHTML=items.filter(x=>filter==='all'||x.status===filter).map(x=>`<div class="finding"><span class="dot ${x.status}"></span><div><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></div><span class="finding-tag">${esc(x.category)}</span></div>`).join('')}
$$('.mini-btn').forEach(b=>b.addEventListener('click',()=>{$$('.mini-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(currentReport)renderFindings(currentReport.findings,b.dataset.filter)}));
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

$('#shareBtn').addEventListener('click',async()=>{if(!currentReport)return;const r=currentReport;const lines=[`ELEVA Website Audit — ${r.domain}`,`Score general: ${r.overall}/100`,...categoryOrder.map(k=>`${categoryNames[k]}: ${r.scores[k]}/100`),'','Fortalezas:',...(r.strengths||[]).map((p,i)=>`${i+1}. ${p.title}`),'','Top oportunidades:',...r.priorities.map((p,i)=>`${i+1}. ${p.title} — ${p.detail}`)];await navigator.clipboard.writeText(lines.join('\n'));toast('Resumen copiado')});
$('#proposalBtn').addEventListener('click',async()=>{if(!currentReport)return;const r=currentReport,rec=r.recommendation||{};const potential=improvementPotential(r);const t=`PROPUESTA ELEVA — ${r.domain}

Diagnóstico ejecutivo
ELEVA Score: ${r.overall}/100. ${scoreSummary(r.overall)}
Potencial de mejora: ${potential.level}. ${potential.detail}

Recomendación
${rec.level||'Optimización'} — ${rec.title||''}
${rec.detail||''}

Fortalezas a conservar
${(r.strengths||[]).map(x=>`• ${x.title}`).join('\n')}

Qué haríamos con tu sitio
${(rec.scope||[]).map(x=>`• ${x}`).join('\n')}

Prioridades detectadas
${r.priorities.map((p,i)=>`${i+1}. ${p.title}: ${p.detail}`).join('\n')}

Siguiente paso sugerido
Implementar primero los puntos de mayor impacto y repetir la auditoría para documentar la mejora en score, experiencia y conversión.`;await navigator.clipboard.writeText(t);toast('Propuesta comercial copiada')});

$('#pdfBtn').addEventListener('click',()=>{
  if(!currentReport)return;
  try{
    generatePdf(currentReport);
    toast('PDF descargado');
  }catch(err){
    console.error(err);
    toast('No se pudo generar el PDF');
  }
});

// v1.8: PDF generator is bundled in the app itself. No CDN and no print-dialog fallback.
// It creates a real PDF Blob and downloads it directly in the browser.
function generatePdf(r){
  const PDF_W=595.28, PDF_H=841.89;
  const M=48, CONTENT=PDF_W-M*2;
  const C={ink:[17,19,24],muted:[101,107,117],soft:[245,247,249],line:[225,229,234],green:[27,145,91],amber:[205,137,34],red:[195,64,55],white:[255,255,255],dark2:[31,35,41]};
  const pdf=new ElevaPdf(PDF_W,PDF_H);
  const scoreColor=v=>v>=80?C.green:v>=55?C.amber:C.red;
  const potential=improvementPotential(r);
  const potentialColor=potential.kind==='red'?C.red:potential.kind==='amber'?C.amber:C.green;
  const date=new Date(r.createdAt).toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'});
  const shortDate=new Date(r.createdAt).toLocaleDateString('es-MX');

  const footer=(p)=>{
    p.line(M,798,PDF_W-M,798,C.line,0.7);
    p.text('ELEVA Website Audit · madebyeleva.com',M,813,7,C.muted,'normal');
    p.text(`Auditoría ${shortDate}`,PDF_W-M,813,7,C.muted,'normal','right');
  };
  const sectionTitle=(p,title,sub,y)=>{
    p.text(title,M,y,21,C.ink,'bold');
    if(sub)p.multiline(sub,M,y+18,8.5,C.muted,'normal',CONTENT,12);
  };
  const label=(p,t,x,y,color=C.muted)=>p.text(String(t).toUpperCase(),x,y,7.5,color,'bold');
  const card=(p,x,y,w,h,fill=C.white,stroke=C.line)=>p.rect(x,y,w,h,fill,stroke,1,5);

  // PAGE 1 — COVER
  let p=pdf.addPage();
  p.rect(0,0,PDF_W,PDF_H,C.ink,null,0,0);
  p.rect(M,49,171,30,C.dark2,null,0,15);
  p.text('ELEVA WEBSITE AUDIT',M+18,69,8,C.white,'bold');
  p.text('Auditoría estratégica',M,176,31,C.white,'bold');
  p.text('de sitio web',M,211,31,C.white,'bold');
  p.text(r.domain,M,251,14,[190,195,202],'normal');
  p.line(M,291,PDF_W-M,291,[74,79,86],0.8);
  label(p,'ELEVA SCORE',M,343,[160,165,173]);
  p.text(String(r.overall),M,423,61,C.white,'bold');
  p.text('/100',M+108,420,12,[167,172,180],'normal');
  p.text(scoreLabel(r.overall),M,456,13,scoreColor(r.overall),'bold');
  p.multiline(scoreSummary(r.overall),M,486,10,[207,211,217],'normal',420,15);
  label(p,'POTENCIAL DE MEJORA',M,587,[160,165,173]);
  p.text(potential.level,M,616,20,potentialColor,'bold');
  p.multiline(potential.detail,M,641,9,[201,205,212],'normal',430,14);
  p.text(`Fecha: ${date}`,M,756,8,[149,154,162],'normal');
  p.multiline(r.finalUrl,M,773,7,[128,134,143],'normal',CONTENT,10);
  p.text('Análisis técnico + comercial · Google PageSpeed Insights + metodología ELEVA',M,811,7,[112,118,127],'normal');

  // PAGE 2 — EXECUTIVE SUMMARY
  p=pdf.addPage();
  sectionTitle(p,'Resumen ejecutivo','Una lectura rápida del estado actual del sitio y de las oportunidades que pueden tener mayor impacto.',52);
  card(p,M,117,CONTENT,112,C.soft,C.line);
  label(p,'RECOMENDACIÓN ELEVA',M+20,143);
  p.text(r.recommendation?.level||'Optimización',M+20,170,18,C.ink,'bold');
  p.multiline(r.recommendation?.title||scoreSummary(r.overall),M+20,194,10,C.ink,'bold',CONTENT-40,14);
  p.multiline(r.recommendation?.detail||'',M+20,223,8.5,C.muted,'normal',CONTENT-40,12);
  let y=272;
  label(p,'SCORE POR CATEGORÍA',M,y); y+=18;
  categoryOrder.forEach((k,i)=>{
    const col=i%2,row=Math.floor(i/2), x=M+col*257, yy=y+row*74;
    card(p,x,yy,242,60,C.white,C.line);
    p.text(categoryNames[k],x+14,yy+20,8,C.muted,'normal');
    p.text(String(r.scores[k]),x+14,yy+44,18,scoreColor(r.scores[k]),'bold');
    p.rect(x+58,yy+36,163,6,[232,235,239],null,0,3);
    p.rect(x+58,yy+36,163*r.scores[k]/100,6,scoreColor(r.scores[k]),null,0,3);
  });
  y+=318;
  const sorted=categoryOrder.slice().sort((a,b)=>r.scores[b]-r.scores[a]);
  card(p,M,y,CONTENT,82,C.soft,C.line);
  label(p,'LECTURA EJECUTIVA',M+18,y+22);
  p.multiline(`El sitio destaca principalmente en ${categoryNames[sorted[0]]} y ${categoryNames[sorted[1]]}. Las áreas que hoy ofrecen mayor oportunidad de mejora son ${categoryNames[sorted[sorted.length-1]]} y ${categoryNames[sorted[sorted.length-2]]}.`,M+18,y+42,9,C.ink,'normal',CONTENT-36,13);
  footer(p);

  // PAGE 3 — STRENGTHS + PRIORITIES
  p=pdf.addPage();
  sectionTitle(p,'Qué conservar y qué mejorar','Una buena auditoría también identifica lo que ya funciona para no perderlo durante una optimización o rediseño.',52);
  y=119; label(p,'FORTALEZAS A CONSERVAR',M,y); y+=16;
  (r.strengths||[]).slice(0,5).forEach(s=>{
    const h=58; card(p,M,y,CONTENT,h,[241,249,245],null);
    p.circle(M+17,y+18,5,C.green);
    p.text('✓',M+17,y+21,7,C.white,'bold','center');
    p.text(s.title,M+32,y+20,10,C.ink,'bold');
    p.multiline(s.detail,M+32,y+37,8,C.muted,'normal',CONTENT-52,11);
    y+=h+9;
  });
  y+=10; label(p,'PRIORIDADES POR IMPACTO',M,y); y+=18;
  r.priorities.slice(0,5).forEach((it,i)=>{
    const urgency=it.status==='critical'?'URGENTE':it.status==='warning'?'IMPORTANTE':'OPORTUNIDAD';
    const cc=it.status==='critical'?C.red:it.status==='warning'?C.amber:C.green;
    card(p,M,y,CONTENT,64,C.white,C.line);
    p.rect(M,y,5,64,cc,null,0,3);
    p.text(`${i+1}`,M+20,y+25,12,cc,'bold');
    p.text(it.title,M+42,y+22,10,C.ink,'bold');
    p.multiline(it.detail,M+42,y+39,7.7,C.muted,'normal',CONTENT-150,10.5);
    p.text(urgency,PDF_W-M-16,y+22,7,cc,'bold','right');
    y+=74;
  });
  footer(p);

  // PAGE 4 — COMMERCIAL PROPOSAL
  p=pdf.addPage();
  sectionTitle(p,'Propuesta recomendada por ELEVA','El diagnóstico convertido en un alcance inicial claro, sin comprometer una cotización automática.',52);
  card(p,M,119,CONTENT,91,C.ink,null);
  label(p,'POTENCIAL DE MEJORA',M+20,145,[165,170,178]);
  p.text(potential.level,M+20,178,23,potentialColor,'bold');
  p.multiline(potential.detail,M+178,143,8.5,[214,218,224],'normal',CONTENT-198,13);
  y=246; label(p,'DIAGNÓSTICO EJECUTIVO',M,y); y+=18;
  p.multiline(`ELEVA Score: ${r.overall}/100. ${scoreSummary(r.overall)}`,M,y,9.5,C.ink,'normal',CONTENT,14); y+=48;
  label(p,'QUÉ RECOMENDAMOS TRABAJAR',M,y); y+=18;
  (r.recommendation?.scope||[]).slice(0,6).forEach((item,i)=>{
    card(p,M,y,CONTENT,36,C.soft,null);
    p.circle(M+18,y+18,9,C.ink);
    p.text(String(i+1),M+18,y+21,8,C.white,'bold','center');
    p.text(item,M+38,y+22,9,C.ink,'bold');
    y+=44;
  });
  y+=9; label(p,'PRIORIDADES DETECTADAS',M,y); y+=18;
  r.priorities.slice(0,3).forEach((it,i)=>{
    p.text(`${i+1}. ${it.title}`,M,y,9,C.ink,'bold');
    p.multiline(it.detail,M+14,y+15,7.5,C.muted,'normal',CONTENT-14,10.5);
    y+=48;
  });
  footer(p);

  // PAGE 5 — NEXT STEP + TECHNICAL SUMMARY
  p=pdf.addPage();
  sectionTitle(p,'Siguiente paso','Cómo convertir esta auditoría en una mejora medible del sitio.',52);
  card(p,M,119,CONTENT,129,C.ink,null);
  p.text('De auditoría a plan de mejora.',M+23,153,17,C.white,'bold');
  p.multiline('ELEVA puede convertir estos hallazgos en un plan de mejora y una propuesta personalizada para el sitio. Recomendamos comenzar por las prioridades de mayor impacto y repetir la auditoría después de implementar los cambios.',M+23,181,9,[214,218,224],'normal',CONTENT-46,14);
  p.multiline('El objetivo no es únicamente aumentar un score: es mejorar la experiencia de las personas, la visibilidad del sitio y su capacidad de generar contactos o clientes.',M+23,226,8,[170,176,184],'normal',CONTENT-46,12);
  y=291; label(p,'DATOS GOOGLE PSI',M,y); y+=17;
  p.multiline('PageSpeed Insights ayuda a entender qué tan rápido y estable se siente el sitio para una persona que lo visita desde su celular. Menos tiempo suele ser mejor; ELEVA traduce estas métricas a recomendaciones accionables.',M,y,8.5,C.muted,'normal',CONTENT,12); y+=55;
  const metrics=[['LCP',r.pagespeed?.metrics?.lcp],['INP',r.pagespeed?.metrics?.inp],['CLS',r.pagespeed?.metrics?.cls],['FCP',r.pagespeed?.metrics?.fcp],['TBT',r.pagespeed?.metrics?.tbt],['Speed Index',r.pagespeed?.metrics?.speedIndex]];
  metrics.forEach((m,i)=>{
    const col=i%3,row=Math.floor(i/3),x=M+col*171,yy=y+row*69;
    card(p,x,yy,158,56,C.soft,null);
    p.text(m[0],x+12,yy+18,7.5,C.muted,'bold');
    p.text(m[1]?.display||'—',x+12,yy+40,14,C.ink,'bold');
  });
  y+=160; label(p,'HALLAZGOS PRINCIPALES',M,y); y+=16;
  r.findings.slice(0,7).forEach(it=>{
    const cc=it.status==='good'?C.green:it.status==='critical'?C.red:C.amber;
    p.circle(M+4,y-3,3,cc);
    p.text(it.title,M+14,y,8.5,C.ink,'bold');
    p.multiline(it.detail,M+14,y+14,7,C.muted,'normal',CONTENT-90,9.5);
    p.text(it.category,PDF_W-M,y,6.8,C.muted,'bold','right');
    y+=42;
  });
  footer(p);

  const blob=pdf.toBlob();
  const filename=`ELEVA-Audit-${safeFileName(r.domain)}-${new Date().toISOString().slice(0,10)}.pdf`;
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename; a.style.display='none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2500);
}

function safeFileName(s='sitio'){
  return String(s).toLowerCase().replace(/[^a-z0-9.-]+/g,'-').replace(/^-+|-+$/g,'')||'sitio';
}

class ElevaPdf{
  constructor(w,h){this.w=w;this.h=h;this.pages=[];}
  addPage(){const page=new ElevaPdfPage(this.w,this.h);this.pages.push(page);return page;}
  toBlob(){return new Blob([this._bytes()],{type:'application/pdf'});}
  _bytes(){
    const objects=[];
    objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
    const kids=[];
    objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    this.pages.forEach((page,i)=>{
      const contentId=5+i*2, pageId=6+i*2; kids.push(`${pageId} 0 R`);
      const stream=page.commands.join('\n')+'\n';
      const streamBytes=pdfCp1252(stream);
      objects[contentId]={stream,byteLength:streamBytes.length};
      objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w.toFixed(2)} ${this.h.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    });
    objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${this.pages.length} >>`;
    const parts=[pdfCp1252('%PDF-1.4\n%âãÏÓ\n')], offsets=[0];
    let length=parts[0].length;
    for(let i=1;i<objects.length;i++){
      offsets[i]=length;
      let body;
      if(objects[i]&&typeof objects[i]==='object'&&'stream' in objects[i]){
        body=`${i} 0 obj\n<< /Length ${objects[i].byteLength} >>\nstream\n${objects[i].stream}endstream\nendobj\n`;
      }else body=`${i} 0 obj\n${objects[i]}\nendobj\n`;
      const b=pdfCp1252(body); parts.push(b); length+=b.length;
    }
    const xrefOffset=length;
    let xref=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let i=1;i<objects.length;i++)xref+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
    xref+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    parts.push(pdfCp1252(xref));
    const total=parts.reduce((n,b)=>n+b.length,0),out=new Uint8Array(total);let pos=0;
    parts.forEach(b=>{out.set(b,pos);pos+=b.length;});return out;
  }
}

class ElevaPdfPage{
  constructor(w,h){this.w=w;this.h=h;this.commands=[];}
  _c(c){return c.map(v=>(v/255).toFixed(3)).join(' ');}
  _y(top){return this.h-top;}
  text(t,x,y,size=9,color=[0,0,0],weight='normal',align='left'){
    t=String(t??''); const font=weight==='bold'?'/F2':'/F1';
    const width=pdfEstimateWidth(t,size);
    if(align==='right')x-=width; else if(align==='center')x-=width/2;
    this.commands.push(`${this._c(color)} rg BT ${font} ${size.toFixed(2)} Tf 1 0 0 1 ${x.toFixed(2)} ${this._y(y).toFixed(2)} Tm (${pdfEscape(t)}) Tj ET`);
  }
  multiline(t,x,y,size=9,color=[0,0,0],weight='normal',maxWidth=400,lineHeight=size*1.35){
    const lines=pdfWrap(String(t??''),size,maxWidth); lines.forEach((line,i)=>this.text(line,x,y+i*lineHeight,size,color,weight)); return lines.length*lineHeight;
  }
  rect(x,y,w,h,fill=null,stroke=null,lineWidth=1,radius=0){
    const yy=this.h-y-h; let cmd='q ';
    if(fill)cmd+=`${this._c(fill)} rg `; if(stroke)cmd+=`${this._c(stroke)} RG ${lineWidth.toFixed(2)} w `;
    // rounded corners intentionally approximated as standard rectangles for maximum PDF compatibility.
    cmd+=`${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill&&stroke?'B':fill?'f':'S'} Q`; this.commands.push(cmd);
  }
  line(x1,y1,x2,y2,color=[0,0,0],width=1){this.commands.push(`q ${this._c(color)} RG ${width.toFixed(2)} w ${x1.toFixed(2)} ${this._y(y1).toFixed(2)} m ${x2.toFixed(2)} ${this._y(y2).toFixed(2)} l S Q`);}
  circle(cx,cy,r,fill=[0,0,0]){
    const k=.5522847498, y=this._y(cy),c=this._c(fill);
    this.commands.push(`q ${c} rg ${(cx+r).toFixed(2)} ${y.toFixed(2)} m ${(cx+r).toFixed(2)} ${(y+k*r).toFixed(2)} ${(cx+k*r).toFixed(2)} ${(y+r).toFixed(2)} ${cx.toFixed(2)} ${(y+r).toFixed(2)} c ${(cx-k*r).toFixed(2)} ${(y+r).toFixed(2)} ${(cx-r).toFixed(2)} ${(y+k*r).toFixed(2)} ${(cx-r).toFixed(2)} ${y.toFixed(2)} c ${(cx-r).toFixed(2)} ${(y-k*r).toFixed(2)} ${(cx-k*r).toFixed(2)} ${(y-r).toFixed(2)} ${cx.toFixed(2)} ${(y-r).toFixed(2)} c ${(cx+k*r).toFixed(2)} ${(y-r).toFixed(2)} ${(cx+r).toFixed(2)} ${(y-k*r).toFixed(2)} ${(cx+r).toFixed(2)} ${y.toFixed(2)} c f Q`);
  }
}

function pdfWrap(text,size,maxWidth){
  const paras=String(text||'').replace(/\r/g,'').split('\n'), out=[];
  paras.forEach((para,pi)=>{
    const words=para.split(/\s+/).filter(Boolean); let line='';
    words.forEach(word=>{const test=line?line+' '+word:word;if(pdfEstimateWidth(test,size)<=maxWidth)line=test;else{if(line)out.push(line);line=word;}});
    if(line)out.push(line); if(!words.length)out.push(''); if(pi<paras.length-1&&para==='')out.push('');
  });
  return out.length?out:[''];
}
function pdfEstimateWidth(text,size){
  let units=0; for(const ch of String(text)){if('ilI.,:;!|\'` '.includes(ch))units+=.26;else if('MW@%&QO'.includes(ch))units+=.82;else units+=.52;} return units*size;
}
function pdfEscape(s){return pdfSanitize(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
function pdfSanitize(s){return String(s??'').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/…/g,'...').replace(/✓/g,'OK').replace(/✕/g,'X').replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]/g,'');}
function pdfCp1252(str){
  const map={'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
  const s=String(str); const out=new Uint8Array(s.length); for(let i=0;i<s.length;i++){const code=s.charCodeAt(i),ch=s[i];out[i]=code<=255?code:(map[ch]??63);} return out;
}

function saveHistory(r){let h=JSON.parse(localStorage.getItem('elevaAudits')||'[]');h=h.filter(x=>x.domain!==r.domain);h.unshift({domain:r.domain,url:r.finalUrl,overall:r.overall,scores:r.scores,createdAt:r.createdAt,report:r});localStorage.setItem('elevaAudits',JSON.stringify(h.slice(0,20)))}
function renderHistory(){const h=JSON.parse(localStorage.getItem('elevaAudits')||'[]');$('#historyList').innerHTML=h.length?h.map((x,i)=>`<div class="history-item"><div><strong>${esc(x.domain)}</strong><p>${new Date(x.createdAt).toLocaleString('es-MX')}</p></div><div class="history-score">${x.overall}</div><button class="secondary-btn" data-open="${i}">Abrir</button></div>`).join(''):'<div class="panel"><p class="muted">Aún no hay auditorías guardadas en este dispositivo.</p></div>';$$('[data-open]').forEach(b=>b.onclick=()=>{currentReport=h[+b.dataset.open].report;renderReport(currentReport);$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view==='audit'));$$('.view').forEach(v=>v.classList.remove('active'));$('#auditView').classList.add('active')})}
$('#clearHistory').addEventListener('click',()=>{localStorage.removeItem('elevaAudits');renderHistory();toast('Historial eliminado')});
