import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8082);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const faultMode = req.headers['x-acme-fault-mode'];

  if (faultMode === 'FAIL_503') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Injected transient failure (503)' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'HEALTHY', service: 'acme-worker' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/capabilities/retry') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        operation_id: `op_retry_${Date.now()}`,
        status: 'COMPLETED',
        message: 'Ingestion job successfully retried',
      })
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/capabilities/drain') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        operation_id: `op_drain_${Date.now()}`,
        status: 'COMPLETED',
        drained_count: 42,
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(port, () => {
  console.log(`[acme-worker] Reference capability provider running on port ${port}`);
});
