import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /api/deeplink
 *
 * Ponte de redirecionamento: o bot WhatsApp envia um link HTTPS apontando
 * para esta rota (via Ngrok em dev local, domínio real em produção).
 * Esta rota responde com HTML + JavaScript que redireciona o browser
 * para o scheme customizado imoveis://, fazendo o SO abrir o app Flutter.
 *
 * Query params recebidos (do WhatsApp → buildSearchResponse):
 *   state, city, maxPrice (e outros compatíveis com SearchFilters.fromQueryParams)
 *
 * Fluxo completo:
 *   WhatsApp → https://ngrok/api/deeplink?state=SP&city=São+Paulo&maxPrice=5000
 *   Browser  → GET /api/deeplink → HTML com JS
 *   JS       → window.location.href = "imoveis://search?state=SP&..."
 *   SO       → intercepta imoveis:// → abre app Flutter
 *   Flutter  → go_router resolve /search → SearchPage com filtros
 */
router.get('/deeplink', (_req: Request, res: Response) => {
  // Achata query params (Express entrega arrays p/ chaves repetidas).
  const flat: Record<string, string> = {};
  for (const [key, val] of Object.entries(_req.query as Record<string, unknown>)) {
    flat[key] = Array.isArray(val) ? val[0] : String(val ?? '');
  }
  const params = new URLSearchParams(flat);
  const appDeepLink = `imoveis:///search?${params.toString()}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>i-Móveis</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; background: #0f0f0f; color: #e0e0e0; text-align: center;
    }
    .card {
      background: #1a1a1a; border: 1px solid #2a2a2a;
      border-radius: 16px; padding: 32px 24px; max-width: 340px; width: 90%;
    }
    h2 { color: #f97316; margin: 0 0 4px; font-size: 20px; }
    .spinner {
      border: 2px solid #2a2a2a; border-top-color: #f97316;
      border-radius: 50%; width: 24px; height: 24px;
      animation: spin 0.8s linear infinite; margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    p  { color: #888; font-size: 14px; margin: 0 0 20px; line-height: 1.4; }
    .btn {
      display: inline-block; background: #f97316; color: #0f0f0f;
      padding: 12px 24px; border-radius: 8px; text-decoration: none;
      font-weight: 600; font-size: 14px; transition: background 0.15s;
    }
    .btn:hover { background: #ea580c; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Abrindo i-Móveis...</h2>
    <p>Se o app não abrir automaticamente, toque no botão abaixo.</p>
    <a class="btn" href="${appDeepLink}">Abrir app i-Móveis</a>
  </div>
  <script>
    window.location.href = "${appDeepLink}";
  </script>
</body>
</html>`;

  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

export default router;
