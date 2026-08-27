import { createServer } from 'node:http';
import type { ActionGrant } from '@runbook/types';

const port = Number(process.env.PORT || 8081);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'HEALTHY', service: 'rb-broker' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/dispatch') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}') as { grant: ActionGrant };
        if (!payload.grant || payload.grant.typ !== 'RB-ACTION-GRANT') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: Missing or invalid Action Grant' }));
          return;
        }

        // Mock bounded capability dispatch
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            operation_id: `op_${Date.now()}`,
            status: 'COMPLETED',
            capability: payload.grant.capability,
          })
        );
      } catch (err: unknown) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(port, () => {
  console.log(`[rb-broker] Action Broker PEP service running on port ${port}`);
});
