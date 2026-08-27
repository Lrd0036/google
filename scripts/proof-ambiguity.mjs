import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { compilePlan } from '../packages/compiler/dist/compile.js';

const source = readFileSync('fixtures/proof-cases/acme-ingestion-recovery-ambiguous.md', 'utf8');
const plan = JSON.parse(readFileSync('fixtures/proof-cases/acme-ingestion-recovery-ambiguous-plan.json', 'utf8'));
const manifest = JSON.parse(readFileSync('fixtures/manifests/acme-operations.json', 'utf8'));
const result = compilePlan(source, 'fixtures/proof-cases/acme-ingestion-recovery-ambiguous.md', plan, manifest);
if (!result.lint.hasErrors) throw new Error('Expected ambiguous mutation to fail compilation.');
mkdirSync('.local/proof', { recursive: true });
writeFileSync('.local/proof/acme-recovery-ambiguous.json', `${JSON.stringify({
  schema: 'runbook-compiler-proof/v0.1',
  evidence_mode: 'LOCAL_STATIC_ANALYSIS',
  disposition: 'ABSTAINED',
  diagnostics: result.lint.artifact,
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, disposition: 'ABSTAINED', diagnostics: result.lint.artifact.diagnostics.map(({ code, category }) => ({ code, category })) }));
