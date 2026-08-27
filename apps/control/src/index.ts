import { createServer } from 'node:http';
import type { ExecutionRecord } from '@runbook/types';

const port = Number(process.env.PORT || 8080);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'HEALTHY', service: 'rb-control' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/executions') {
    const mockExecution: Partial<ExecutionRecord> = {
      execution_id: `exec_${Date.now()}`,
      tenant_id: 'acme-corp',
      runbook_id: 'acme-ingestion-recovery',
      runbook_version: 1,
      state_version: 1,
      status: 'PENDING',
      current_node: 'classify_failure',
      context: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockExecution));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(port, () => {
  console.log(`[rb-control] Control plane service running on port ${port}`);
});
