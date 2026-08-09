# ELEVA Website Audit v1.0

Auditoría automatizada de sitios web diseñada para uso comercial y técnico de ELEVA.

## Incluye
- Score general 0–100
- Diseño & UX (heurístico)
- Mobile
- Velocidad / Google PageSpeed
- SEO
- Estructura
- Contenido
- Conversión
- Visibilidad / indexability readiness
- Detección de WhatsApp, formularios y señales de cotización
- Core Web Vitals / Lighthouse cuando Google PSI responde
- Top 5 oportunidades
- Historial local (browser localStorage)
- Copiar resumen y resumen para propuesta
- Exportar reporte a PDF desde el navegador

## Cloudflare Pages

**Importante:** no uses el drag-and-drop del dashboard para esta versión. Cloudflare no soporta actualmente Pages Functions mediante Direct Upload desde el dashboard. Usa GitHub/GitLab o Wrangler.

Este proyecto usa Pages Functions. La carpeta `/functions` debe estar en la raíz del proyecto, tal como indica la documentación de Cloudflare Pages.

### Opción A — Subir por Git (recomendado)
1. Sube este folder a un repositorio GitHub.
2. Cloudflare > Workers & Pages > Create application > Pages > Connect to Git.
3. Framework preset: None.
4. Build command: dejar vacío.
5. Build output directory: `/` (o el directorio raíz que Cloudflare solicite según tu integración).
6. Deploy.

### Opción B — desarrollo local
Instala Node.js y ejecuta desde la raíz:

```bash
npx wrangler pages dev .
```

## Google PageSpeed API key (recomendado)
La API puede funcionar sin key en algunos escenarios, pero para uso recurrente conviene configurar una key.

En Cloudflare Pages:
- Settings > Variables and Secrets
- Variable: `PAGESPEED_API_KEY`
- Value: tu API key de Google Cloud con PageSpeed Insights API habilitada

El código nunca expone esta key al browser: la usa la Pages Function.

## Limitaciones intencionales de V1
- “Diseño & UX” es un score heurístico basado en estructura, accesibilidad, CTAs, responsive y señales de confianza. No afirma juzgar estética como un diseñador humano.
- “Visibilidad” mide preparación técnica para ser descubierto (robots, sitemap, canonical, schema, metadatos), no ranking real en Google.
- El análisis HTML revisa principalmente la URL ingresada; V2 puede rastrear múltiples páginas.
- Sitios que bloquean bots/firewalls pueden devolver auditoría parcial.

## Próximas versiones sugeridas
- Screenshot desktop/mobile + análisis visual
- Rastreo de 5–20 páginas internas
- Competitor benchmark
- Search Console / GA4
- Lead capture branded reports
- White-label client mode
- PDF con logo del prospecto y branding editable
