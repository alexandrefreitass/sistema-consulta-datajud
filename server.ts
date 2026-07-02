import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import bootstrap from './src/main.server';

const allowedTribunais = new Set([
  'api_publica_tjsp',
  'api_publica_tst',
  'api_publica_tse',
  'api_publica_stj',
  'api_publica_stm',
  'api_publica_trf2',
  'api_publica_tjmg',
  'api_publica_trt2',
  'api_publica_tre-sp',
  'api_publica_tjmsp',
]);

// The Express app is exported so that it can be used by serverless Functions.
export function app(): express.Express {
  const server = express();
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(serverDistFolder, 'index.server.html');

  const commonEngine = new CommonEngine();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);
  server.use(express.json());

  server.post('/api/consulta', async (req, res) => {
    const requestId = Math.random().toString(36).slice(2, 11);
    const { numeroProcesso, tribunalAlias } = req.body ?? {};
    const apiKey = process.env['DATAJUD_API_KEY'];

    if (!apiKey) {
      return res.status(500).json({
        error: 'DATAJUD_API_KEY nao configurada no ambiente de producao.',
        requestId,
      });
    }

    if (typeof numeroProcesso !== 'string' || typeof tribunalAlias !== 'string') {
      return res.status(400).json({
        error: 'numeroProcesso e tribunalAlias sao obrigatorios.',
        requestId,
      });
    }

    if (!allowedTribunais.has(tribunalAlias)) {
      return res.status(400).json({
        error: 'Tribunal invalido.',
        requestId,
      });
    }

    const apiUrl = `https://api-publica.datajud.cnj.jus.br/${tribunalAlias}/_search`;
    const requestBody = {
      query: {
        term: {
          numeroProcesso,
        },
      },
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'User-Agent': `DatajudConsulta/1.0 RequestId/${requestId}`,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'X-Request-Id': requestId,
      });

      return res.status(response.status).json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';

      return res.status(500).json({
        error: 'Erro ao buscar o processo no DataJud.',
        details: message,
        requestId,
      });
    }
  });

  // Example Express Rest API endpoints
  // server.get('/api/**', (req, res) => { });
  // Serve static files from /browser
  server.get('**', express.static(browserDistFolder, {
    maxAge: '1y',
    index: 'index.html',
  }));

  // All regular routes use the Angular engine
  server.get('**', (req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: browserDistFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
      })
      .then((html) => res.send(html))
      .catch((err) => next(err));
  });

  return server;
}

function run(): void {
  const port = process.env['PORT'] || 4000;

  // Start up the Node server
  const server = app();
  server.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

run();
