import { createServer } from 'node:http';

/** Заглушка стенда на случайном порту. handler(req, res, body) — своя логика ответов. */
export async function startStub(handler) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    close: () => {
      server.closeAllConnections();
      return new Promise((ok) => server.close(ok));
    },
  };
}

export function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
