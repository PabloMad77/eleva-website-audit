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
  return {version:'1.7',url:raw.url,finalUrl:raw.finalUrl||raw.url,domain:new URL(raw.finalUrl||raw.url).hostname.replace(/^www\./,''),createdAt:new Date().toISOString(),overall,scores,scan:s,pagespeed:psi,findings,recommendation,strengths,priorities:findings.filter(f=>f.status!=='good').sort((a,b)=>severity(b.status)-severity(a.status)||b.impact-a.impact).slice(0,5)};
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

$('#pdfBtn').addEventListener('click',()=>{if(!currentReport)return; if(window.jspdf?.jsPDF) generatePdf(currentReport); else window.print();});
function generatePdf(r){
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=210,H=297,M=18,CONTENT=174;
  const C={ink:[15,18,22],muted:[97,105,116],soft:[244,246,248],line:[224,228,233],green:[24,145,92],amber:[211,142,36],red:[201,65,56],white:[255,255,255]};
  const scoreColor=(v)=>v>=80?C.green:v>=55?C.amber:C.red;
  const addFooter=(page)=>{doc.setDrawColor(...C.line);doc.line(M,282,W-M,282);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...C.muted);doc.text('ELEVA Website Audit · madebyeleva.com',M,289);doc.text(`Página ${page}`,W-M,289,{align:'right'});};
  const wrap=(t,x,y,size=9,style='normal',max=CONTENT,color=C.ink)=>{doc.setFont('helvetica',style);doc.setFontSize(size);doc.setTextColor(...color);const lines=doc.splitTextToSize(String(t||''),max);doc.text(lines,x,y);return y+lines.length*(size*.41)+2;};
  const title=(t,y,sub='')=>{doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(...C.ink);doc.text(t,M,y);if(sub){doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...C.muted);doc.text(sub,M,y+6);}return y+(sub?16:10);};
  const section=(t,y)=>{doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...C.ink);doc.text(t,M,y);return y+7;};
  const ensure=(y,need=24)=>{if(y+need>274){addFooter(doc.getNumberOfPages());doc.addPage();return 20;}return y;};
  const badge=(txt,x,y,kind='soft')=>{const palette=kind==='green'?C.green:kind==='amber'?C.amber:kind==='red'?C.red:C.soft;doc.setFont('helvetica','bold');doc.setFontSize(7);const w=Math.max(20,doc.getTextWidth(txt)+8);doc.setFillColor(...palette);doc.roundedRect(x,y-4,w,7,3,3,'F');const tc=kind==='soft'?C.ink:C.white;doc.setTextColor(...tc);doc.text(txt,x+4,y+1);return w;};
  const scoreRing=(cx,cy,score,radius=17)=>{doc.setDrawColor(229,232,236);doc.setLineWidth(3.6);doc.circle(cx,cy,radius,'S');doc.setDrawColor(...scoreColor(score));doc.setLineWidth(3.6);const seg=Math.max(3,Math.round(score/4));for(let i=0;i<seg;i++){const a1=(-90+i*3.6)*Math.PI/180,a2=(-90+(i+1)*3.6)*Math.PI/180;doc.line(cx+Math.cos(a1)*radius,cy+Math.sin(a1)*radius,cx+Math.cos(a2)*radius,cy+Math.sin(a2)*radius);}doc.setFont('helvetica','bold');doc.setFontSize(18);doc.setTextColor(...C.ink);doc.text(String(score),cx,cy+2,{align:'center'});doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor(...C.muted);doc.text('/100',cx,cy+7,{align:'center'});};
  const metricCard=(x,y,label,score,w=82)=>{doc.setFillColor(250,251,252);doc.setDrawColor(...C.line);doc.roundedRect(x,y,w,24,3,3,'FD');doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(...C.muted);doc.text(label,x+6,y+8);doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor(...scoreColor(score));doc.text(String(score),x+6,y+18);doc.setFillColor(232,235,239);doc.roundedRect(x+28,y+15,w-34,3,1.5,1.5,'F');doc.setFillColor(...scoreColor(score));doc.roundedRect(x+28,y+15,(w-34)*score/100,3,1.5,1.5,'F');};
  const potential=improvementPotential(r);

  // PAGE 1 — COVER
  doc.setFillColor(...C.ink);doc.rect(0,0,W,H,'F');
  doc.setFillColor(31,35,41);doc.roundedRect(18,18,54,10,5,5,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(255);doc.text('ELEVA WEBSITE AUDIT',25,24.5);
  doc.setFont('helvetica','bold');doc.setFontSize(32);doc.text('Auditoría estratégica',M,68);doc.text('de sitio web',M,82);
  doc.setFont('helvetica','normal');doc.setFontSize(14);doc.setTextColor(190);doc.text(r.domain,M,101);
  doc.setDrawColor(70);doc.line(M,116,W-M,116);
  doc.setFontSize(8);doc.setTextColor(150);doc.text('ELEVA SCORE',M,138);
  doc.setFont('helvetica','bold');doc.setFontSize(58);doc.setTextColor(255);doc.text(String(r.overall),M,169);
  doc.setFont('helvetica','normal');doc.setFontSize(12);doc.setTextColor(170);doc.text('/100',63,168);
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...scoreColor(r.overall));doc.text(scoreLabel(r.overall),M,184);
  wrap(scoreSummary(r.overall),M,196,10,'normal',150,[205,208,214]);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(145);doc.text(`Fecha: ${new Date(r.createdAt).toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'})}`,M,253);doc.text(r.finalUrl,M,262);
  doc.setFontSize(7);doc.setTextColor(115);doc.text('Análisis técnico + comercial · Google PageSpeed Insights + metodología ELEVA',M,278);

  // PAGE 2 — EXECUTIVE DASHBOARD
  doc.addPage(); let y=22;
  y=title('Resumen ejecutivo',y,'Una lectura rápida del estado actual del sitio y sus oportunidades de negocio.');
  scoreRing(38,58,r.overall,18);
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...C.ink);doc.text(r.recommendation?.level||'Optimización',66,50);
  y=wrap(r.recommendation?.title||scoreSummary(r.overall),66,58,9,'normal',122,C.muted);
  y=wrap(r.recommendation?.detail||'',66,y+2,8,'normal',122,C.muted);
  doc.setFillColor(...(potential.kind==='red'?[252,242,241]:potential.kind==='amber'?[253,248,239]:[240,249,245]));doc.roundedRect(66,73,122,13,3,3,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...(potential.kind==='red'?C.red:potential.kind==='amber'?C.amber:C.green));doc.text(`POTENCIAL DE MEJORA: ${potential.level}`,72,81);
  y=94;
  section('Score por categoría',y); y+=7;
  categoryOrder.forEach((k,i)=>{const col=i%2,row=Math.floor(i/2);metricCard(M+col*90,y+row*30,categoryNames[k],r.scores[k],84);});
  y+=122;
  y=section('Lectura ejecutiva',y);
  const strongest=categoryOrder.slice().sort((a,b)=>r.scores[b]-r.scores[a]).slice(0,2).map(k=>categoryNames[k]);
  const weakest=categoryOrder.slice().sort((a,b)=>r.scores[a]-r.scores[b]).slice(0,2).map(k=>categoryNames[k]);
  y=wrap(`El sitio destaca principalmente en ${strongest.join(' y ')}. Las áreas que hoy ofrecen mayor oportunidad de mejora son ${weakest.join(' y ')}.`,M,y,9,'normal',CONTENT,C.ink)+3;
  doc.setFillColor(...C.soft);doc.roundedRect(M,y,CONTENT,32,3,3,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(...C.ink);doc.text('RECOMENDACIÓN ELEVA',M+7,y+9);
  wrap(r.recommendation?.detail||'Priorizar las oportunidades de mayor impacto y medir nuevamente después de implementar.',M+7,y+17,8,'normal',160,C.muted);
  addFooter(doc.getNumberOfPages());

  // PAGE 3 — STRENGTHS + PRIORITIES
  doc.addPage(); y=22;
  y=title('Qué conservar y qué mejorar',y,'Una auditoría útil no solo señala problemas: también identifica lo que ya está funcionando.');
  y=section('Fortalezas a conservar',y);
  (r.strengths||[]).slice(0,5).forEach((s,i)=>{y=ensure(y,24);doc.setFillColor(240,249,245);doc.roundedRect(M,y-4,CONTENT,20,3,3,'F');doc.setFillColor(...C.green);doc.circle(M+6,y+6,2.2,'F');doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(...C.ink);doc.text(s.title,M+12,y+3);wrap(s.detail,M+12,y+9,7.5,'normal',154,C.muted);y+=25;});
  y+=3; y=section('Prioridades por impacto',y);
  r.priorities.slice(0,5).forEach((p,i)=>{y=ensure(y,26);const cc=p.status==='critical'?C.red:C.amber;doc.setFillColor(252,252,252);doc.setDrawColor(...C.line);doc.roundedRect(M,y-4,CONTENT,22,3,3,'FD');doc.setFillColor(...cc);doc.roundedRect(M,y-4,4,22,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...cc);doc.text(p.status==='critical'?'URGENTE':'IMPORTANTE',M+9,y+2);doc.setFontSize(9.5);doc.setTextColor(...C.ink);doc.text(p.title,M+9,y+8);wrap(p.detail,M+9,y+14,7.5,'normal',158,C.muted);y+=27;});
  addFooter(doc.getNumberOfPages());

  // PAGE 4 — ACTION PLAN
  doc.addPage(); y=22;
  y=title('Plan de acción recomendado',y,'Qué haría ELEVA para convertir los hallazgos en mejoras concretas.');
  const scope=r.recommendation?.scope||[];
  scope.slice(0,6).forEach((item,i)=>{y=ensure(y,31);doc.setFillColor(...C.ink);doc.circle(M+7,y+6,6,'F');doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(255);doc.text(String(i+1),M+7,y+8,{align:'center'});doc.setFontSize(11);doc.setTextColor(...C.ink);doc.text(item,M+20,y+5);const detail={
    'UX y jerarquía':'Simplificar la lectura, clarificar el mensaje principal y dirigir al usuario hacia la acción correcta.',
    'Conversión y contacto':'Fortalecer llamadas a la acción, formularios, WhatsApp o mecanismos de cotización.',
    'Performance móvil':'Reducir fricción de carga y mejorar la experiencia desde celular.',
    'SEO on-page':'Optimizar títulos, descripciones, estructura, indexación y señales para buscadores.',
    'Contenido de confianza':'Reforzar testimonios, pruebas sociales, garantías, casos, ubicación y credenciales.',
    'Estructura':'Ordenar navegación y contenido para que usuarios y buscadores entiendan mejor el sitio.'
  }[item]||'Implementar mejoras concretas y medibles en esta área.';wrap(detail,M+20,y+12,8,'normal',150,C.muted);y+=31;});
  y=ensure(y,48);doc.setFillColor(...C.soft);doc.roundedRect(M,y,CONTENT,38,4,4,'F');doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...C.ink);doc.text('Cómo mediríamos el avance',M+8,y+11);wrap('Implementar las prioridades de mayor impacto y volver a ejecutar ELEVA Website Audit para comparar score, experiencia móvil, visibilidad y capacidad de conversión.',M+8,y+20,8,'normal',157,C.muted);
  addFooter(doc.getNumberOfPages());

  // PAGE 5 — COMMERCIAL PROPOSAL SUMMARY
  doc.addPage(); y=22;
  y=title('Propuesta recomendada por ELEVA',y,'Del diagnóstico a un alcance claro de mejora, sin comprometer una cotización automática.');
  doc.setFillColor(...C.ink);doc.roundedRect(M,y,CONTENT,38,4,4,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(170);doc.text('POTENCIAL DE MEJORA',M+8,y+10);
  doc.setFontSize(20);doc.setTextColor(...(potential.kind==='red'?C.red:potential.kind==='amber'?C.amber:C.green));doc.text(potential.level,M+8,y+23);
  wrap(potential.detail,M+50,y+10,8,'normal',124,[215,218,223]);
  y+=49;
  y=section('Diagnóstico ejecutivo',y);
  y=wrap(`ELEVA Score: ${r.overall}/100. ${scoreSummary(r.overall)}`,M,y,9,'normal',CONTENT,C.ink)+4;
  y=section('Recomendación',y);
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...C.ink);doc.text(r.recommendation?.level||'Optimización',M,y); y+=7;
  y=wrap(r.recommendation?.title||'',M,y,9,'bold',CONTENT,C.ink);
  y=wrap(r.recommendation?.detail||'',M,y+1,8,'normal',CONTENT,C.muted)+5;
  y=section('Qué recomendamos trabajar',y);
  (r.recommendation?.scope||[]).slice(0,6).forEach((item,i)=>{y=ensure(y,14);doc.setFillColor(...C.soft);doc.roundedRect(M,y-4,CONTENT,11,2,2,'F');doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...C.ink);doc.text(`${i+1}. ${item}`,M+6,y+2);y+=14;});
  y+=3; y=section('Prioridades detectadas',y);
  r.priorities.slice(0,3).forEach((p,i)=>{y=ensure(y,20);doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(...C.ink);doc.text(`${i+1}. ${p.title}`,M,y);y=wrap(p.detail,M,y+6,7.5,'normal',CONTENT,C.muted)+4;});
  y=ensure(y,42);doc.setFillColor(...C.soft);doc.roundedRect(M,y,CONTENT,34,4,4,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(...C.ink);doc.text('Siguiente paso sugerido',M+8,y+10);
  wrap('ELEVA puede convertir estos hallazgos en un plan de mejora y una propuesta personalizada para el sitio. Recomendamos comenzar por las prioridades de mayor impacto y repetir la auditoría después de implementar los cambios.',M+8,y+18,8,'normal',156,C.muted);
  addFooter(doc.getNumberOfPages());

  // PAGE 6 — TECHNICAL APPENDIX
  doc.addPage(); y=22;
  y=title('Apéndice técnico',y,'Detalle de hallazgos que respaldan la recomendación ejecutiva.');
  r.findings.forEach(p=>{y=ensure(y,23);const cc=p.status==='good'?C.green:p.status==='critical'?C.red:C.amber;doc.setFillColor(...cc);doc.circle(M+2,y-1,1.5,'F');doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(...C.ink);doc.text(p.title,M+7,y);badge(p.category,W-M-38,y,p.status==='good'?'green':p.status==='critical'?'red':'amber');y=wrap(p.detail,M+7,y+6,7.7,'normal',155,C.muted)+4;});
  y=ensure(y,44);doc.setFillColor(...C.ink);doc.roundedRect(M,y,CONTENT,36,4,4,'F');doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255);doc.text('Siguiente paso',M+8,y+11);wrap('Esta auditoría identifica oportunidades iniciales. ELEVA puede ayudarte a convertir estos hallazgos en un plan de mejora y una propuesta específica para tu sitio.',M+8,y+20,8,'normal',156,[215,218,223]);
  addFooter(doc.getNumberOfPages());

  doc.save(`ELEVA-Audit-${r.domain}-${new Date().toISOString().slice(0,10)}.pdf`);
}
function saveHistory(r){let h=JSON.parse(localStorage.getItem('elevaAudits')||'[]');h=h.filter(x=>x.domain!==r.domain);h.unshift({domain:r.domain,url:r.finalUrl,overall:r.overall,scores:r.scores,createdAt:r.createdAt,report:r});localStorage.setItem('elevaAudits',JSON.stringify(h.slice(0,20)))}
function renderHistory(){const h=JSON.parse(localStorage.getItem('elevaAudits')||'[]');$('#historyList').innerHTML=h.length?h.map((x,i)=>`<div class="history-item"><div><strong>${esc(x.domain)}</strong><p>${new Date(x.createdAt).toLocaleString('es-MX')}</p></div><div class="history-score">${x.overall}</div><button class="secondary-btn" data-open="${i}">Abrir</button></div>`).join(''):'<div class="panel"><p class="muted">Aún no hay auditorías guardadas en este dispositivo.</p></div>';$$('[data-open]').forEach(b=>b.onclick=()=>{currentReport=h[+b.dataset.open].report;renderReport(currentReport);$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view==='audit'));$$('.view').forEach(v=>v.classList.remove('active'));$('#auditView').classList.add('active')})}
$('#clearHistory').addEventListener('click',()=>{localStorage.removeItem('elevaAudits');renderHistory();toast('Historial eliminado')});
