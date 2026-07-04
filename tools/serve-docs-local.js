const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'docs');
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '0.0.0.0';

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function send(res, status, body, headers) {
  res.writeHead(status, headers || { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function resolveRequestPath(url) {
  const requestUrl = new URL(url, `http://${host}:${port}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    return null;
  }
  return filePath;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }

  const filePath = resolveRequestPath(req.url || '/');
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, 'Not Found');
      return;
    }

    const type = types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': type
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(data);
    }
  });
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/`);
});
