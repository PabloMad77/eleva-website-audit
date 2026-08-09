# ELEVA Website Audit v1.5

Cloudflare Workers + Static Assets edition.

## Qué cambió respecto a v1.0
La v1.0 se desplegó como sitio estático y Cloudflare no activó el runtime de Worker. Esta versión incorpora un Worker real y sirve el dashboard como Static Assets.

- `src/worker.js` — backend y endpoint `/api/audit`
- `public/` — interfaz HTML/CSS/JS
- `wrangler.jsonc` — configuración de Cloudflare Workers
- `package.json` — scripts de desarrollo y deploy

## Cloudflare
El proyecto necesita un Worker script y Static Assets. `wrangler.jsonc` ya está configurado con:

- Worker: `src/worker.js`
- Static assets: `./public`
- Assets binding: `ASSETS`
- Worker-first solamente para `/api/*`

## Secret requerido
Después del primer deployment correcto, agrega en Cloudflare:

`PAGESPEED_API_KEY`

como **Secret** de runtime.

No guardes la API key en GitHub ni en este repositorio.

## Prueba rápida
Una vez publicado:

- `/api/health` debe devolver JSON con `ok: true`.
- `pagespeedConfigured` cambia a `true` cuando el Secret está configurado.
- La interfaz utiliza `POST /api/audit`.

## Desarrollo local opcional

```bash
npm install
npx wrangler dev
```

Para probar PageSpeed localmente crea `.dev.vars` (no lo subas a GitHub):

```text
PAGESPEED_API_KEY="TU_KEY"
```


## Scoring v1.5

The ELEVA Score is tuned for SMB / lead-generation websites. Overall weighting: Conversion 20%, Mobile 15%, Speed 15%, SEO 15%, Content 10%, Design & UX 10%, Visibility 8%, Structure 7%. Indexability blockers such as `noindex` or a site-wide robots disallow cap discoverability and the overall score.

This release also adds an ELEVA commercial recommendation (redesign, priority optimization, or growth/continuous improvement), includes it in the PDF, and creates a more useful proposal summary.


## URL flexible
El campo de auditoría acepta dominios como `laspulseras.com`, `www.laspulseras.com` o URLs completas. Si falta el protocolo, la app agrega `https://` automáticamente.


## v1.5
- Reporte orientado a cliente con fortalezas y prioridades por impacto.
- Nuevo bloque “Qué haríamos con tu sitio”.
- PDF rediseñado con portada, resumen ejecutivo, fortalezas, prioridades, plan de acción y hallazgos.
- Copy comercial mejorado para compartir auditorías con prospectos.
