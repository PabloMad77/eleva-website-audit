const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json;charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
});

const has = (s, re) => re.test(s);
const count = (s, re) => [...s.matchAll(re)].length;
const textOnly = s => s
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : '';
};
const metaContent = (html, name, property = false) => {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(x => x[0]);
  const key = property ? 'property' : 'name';
  for (const t of tags) {
    if (attr(t, key).toLowerCase() === name.toLowerCase()) return attr(t, 'content');
  }
  return '';
};
const linkHref = (html, rel) => {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    if (attr(t, 'rel').toLowerCase().split(/\s+/).includes(rel)) return attr(t, 'href');
  }
  return '';
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'ELEVA Website Audit',
        version: '1.4',
        pagespeedConfigured: Boolean(env.PAGESPEED_API_KEY)
      });
    }

    if (url.pathname === '/api/audit') {
      if (request.method !== 'POST') {
        return json({ error: 'Método no permitido' }, 405);
      }
      return auditRequest(request, env);
    }

    // Everything else is served from the Static Assets binding.
    return env.ASSETS.fetch(request);
  }
};

async function auditRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Solicitud inválida' }, 400);
  }

  let u;
  try {
    u = new URL(body.url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad protocol');
  } catch {
    return json({ error: 'URL inválida' }, 400);
  }

  if (isPrivateHost(u.hostname)) {
    return json({ error: 'No se permiten direcciones privadas o locales.' }, 400);
  }

  const warnings = [];
  let pageResp;
  let html = '';
  let finalUrl = u.href;

  try {
    pageResp = await fetch(u.href, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; ELEVAWebsiteAudit/1.2; +https://madebyeleva.com)',
        'accept': 'text/html,application/xhtml+xml'
      }
    });
    finalUrl = pageResp.url || u.href;
    const ct = pageResp.headers.get('content-type') || '';
    if (!pageResp.ok) warnings.push(`El sitio respondió HTTP ${pageResp.status}.`);
    if (!ct.includes('text/html')) warnings.push('La URL no respondió como HTML estándar.');
    html = (await pageResp.text()).slice(0, 2_500_000);
  } catch {
    return json({
      error: 'No pudimos acceder al sitio. Verifica que la URL sea pública y esté disponible.'
    }, 502);
  }

  let final;
  try {
    final = new URL(finalUrl);
    if (isPrivateHost(final.hostname)) {
      return json({ error: 'La URL redirigió a una dirección privada o local.' }, 400);
    }
  } catch {
    return json({ error: 'La URL final del sitio no es válida.' }, 502);
  }

  const origin = final.origin;
  const [robots, sitemap] = await Promise.all([
    probe(`${origin}/robots.txt`),
    probe(`${origin}/sitemap.xml`)
  ]);

  const scan = analyze(html, final, robots, sitemap);
  let pagespeed = { available: false, categories: {}, metrics: {} };

  try {
    pagespeed = await runPageSpeed(finalUrl, env.PAGESPEED_API_KEY);
  } catch (error) {
    console.error('PageSpeed error:', error?.message || error);
    warnings.push('Google PageSpeed no respondió; el resto de la auditoría sí se completó.');
  }

  return json({
    url: u.href,
    finalUrl,
    scan,
    pagespeed,
    fetchWarnings: warnings
  });
}

function analyze(html, url, robots, sitemap) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const desc = metaContent(html, 'description');
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(x => x[0]);
  const withAlt = images.filter(t => /\balt\s*=\s*["'][^"']*["']/i.test(t)).length;
  const bodyText = textOnly(html);
  const words = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const hrefs = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(x => x[1]);
  let internal = 0;
  let social = 0;

  for (const h of hrefs) {
    try {
      const x = new URL(h, url.href);
      if (x.hostname === url.hostname) internal++;
      if (/instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com/i.test(x.hostname)) social++;
    } catch {}
  }

  const buttonText = [...html.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)]
    .map(x => textOnly(x[1]))
    .join(' | ');
  const ctaRegex = /cotiz|agenda|contact|compr|reserv|solicita|escr[ií]benos|ll[aá]manos|whatsapp|diagn[oó]st|empezar|conoce|ver servicios|quiero/i;
  const ctaCount = buttonText.split('|').filter(x => ctaRegex.test(x)).length;
  const stylesheetCount = count(html, /<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi);
  const scriptCount = count(html, /<script\b/gi);
  const robotsText = (robots.text || '').toLowerCase();

  return {
    title,
    titleLength: title.length,
    metaDescription: desc,
    descriptionLength: desc.length,
    lang: attr(html.match(/<html\b[^>]*>/i)?.[0] || '', 'lang'),
    h1Count: count(html, /<h1\b/gi),
    headingCount: count(html, /<h[1-6]\b/gi),
    sectionCount: count(html, /<section\b/gi),
    nav: has(html, /<nav\b/i),
    main: has(html, /<main\b/i),
    footer: has(html, /<footer\b/i),
    semanticSignals: has(html, /<article\b|<aside\b/i),
    viewport: !!metaContent(html, 'viewport'),
    canonical: linkHref(html, 'canonical'),
    robotsMetaNoindex: /noindex/i.test(metaContent(html, 'robots')),
    openGraph: !!metaContent(html, 'og:title', true),
    schema: has(html, /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i),
    imageCount: images.length,
    altCoverage: images.length ? withAlt / images.length : 1,
    lazyImages: images.some(t => /loading\s*=\s*["']lazy["']/i.test(t)),
    stylesheetCount,
    scriptCount,
    wordCount: words,
    internalLinks: internal,
    socialLinks: social,
    whatsapp: /wa\.me|api\.whatsapp\.com|whatsapp:/i.test(html),
    formCount: count(html, /<form\b/gi),
    phone: /tel:/i.test(html),
    email: /mailto:/i.test(html),
    quoteSignals: /cotiz|presupuesto|diagn[oó]stico|agenda|reserv|solicita una|request a quote|book now/i.test(bodyText),
    ctaCount,
    trustSignals: /reseñ|testimoni|clientes|años de experiencia|garant[ií]a|reviews?|estrellas|★★★★★|casos de éxito|certific/i.test(bodyText),
    contactSignals: /contact|ubicaci[oó]n|direcci[oó]n|tel[eé]fono|whatsapp|correo|email/i.test(bodyText),
    serviceSignals: /servicios|services|soluciones|qué hacemos|lo que hacemos/i.test(bodyText),
    faqSignals: /preguntas frecuentes|faq|frequently asked/i.test(bodyText),
    localSignals: /mapa|maps|monterrey|saltillo|méxico|mexico|nuevo le[oó]n|coahuila|ubicaci[oó]n/i.test(bodyText),
    responsiveSignals: /@media\s*\(|max-width|min-width|srcset=|sizes=/i.test(html),
    tapTargetSignals: /button|btn|cta|menu|hamburger/i.test(html),
    robotsTxt: robots.ok,
    robotsDisallowAll: /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(?:\r?\n|$)/i.test(robotsText),
    sitemap: sitemap.ok || /sitemap:/i.test(robotsText)
  };
}

async function probe(url) {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'ELEVAWebsiteAudit/1.2' }
    });
    const text = (await r.text()).slice(0, 100000);
    return { ok: r.ok, text, status: r.status };
  } catch {
    return { ok: false, text: '', status: 0 };
  }
}

async function runPageSpeed(url, key) {
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', 'mobile');
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach(c => endpoint.searchParams.append('category', c));
  if (key) endpoint.searchParams.set('key', key);

  const r = await fetch(endpoint.href);
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 500);
    throw new Error(`PSI failed (${r.status}): ${detail}`);
  }

  const d = await r.json();
  const c = d.lighthouseResult?.categories || {};
  const a = d.lighthouseResult?.audits || {};
  const val = k => typeof c[k]?.score === 'number' ? Math.round(c[k].score * 100) : undefined;
  const metric = (id, good, warn) => {
    const x = a[id];
    if (!x) return {};
    const n = x.numericValue;
    return {
      display: x.displayValue || '',
      numeric: n,
      rating: typeof n !== 'number' ? undefined : n <= good ? 'good' : n <= warn ? 'warning' : 'critical'
    };
  };

  return {
    available: true,
    categories: {
      performance: val('performance'),
      accessibility: val('accessibility'),
      bestPractices: val('best-practices'),
      seo: val('seo')
    },
    metrics: {
      lcp: metric('largest-contentful-paint', 2500, 4000),
      fcp: metric('first-contentful-paint', 1800, 3000),
      cls: metric('cumulative-layout-shift', .1, .25),
      tbt: metric('total-blocking-time', 200, 600),
      speedIndex: metric('speed-index', 3400, 5800),
      inp: metric('interaction-to-next-paint', 200, 500)
    }
  };
}

function isPrivateHost(h) {
  h = h.toLowerCase();
  return h === 'localhost' ||
    h.endsWith('.local') ||
    h === '127.0.0.1' ||
    h === '::1' ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h);
}
