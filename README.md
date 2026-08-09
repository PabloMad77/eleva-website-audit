# ELEVA Website Audit v1.1

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
