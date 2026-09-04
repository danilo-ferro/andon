/* Servidor estático só para os testes: serve public/ e resolve /acordos sem
   a extensão, como a Vercel faz. Suba com `node testes/servidor.mjs &`. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public');
const TIPO = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (!extname(p)) p += '.html';
  try {
    const corpo = await readFile(join(RAIZ, p));
    res.writeHead(200, { 'Content-Type': TIPO[extname(p)] || 'application/octet-stream' });
    res.end(corpo);
  } catch {
    res.writeHead(404);
    res.end('não achei ' + p);
  }
}).listen(8898, '127.0.0.1', () => console.log('no ar em http://127.0.0.1:8898'));
