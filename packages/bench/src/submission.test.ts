import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSubmission } from './submission.js';
test('submission cannot omit runtime-negative evidence or self-certify with candidate counters',()=>{ assert.throws(()=>validateSubmission({schema:'runbookbench-submission/v0.1',item_id:'x',profile:'COMPILER',generated_at:new Date().toISOString(),identity:{compiler_version:'1',compiler_build_sha256:`sha256:${'1'.repeat(64)}`,source_sha256:`sha256:${'2'.repeat(64)}`,manifest_sha256:`sha256:${'3'.repeat(64)}`,prompt_profile_sha256:`sha256:${'4'.repeat(64)}`,model_profile:'none'},disposition:'ABSTAINED',abstention_reason:'safe',diagnostics:{diagnostic_version:'rb-diagnostic/v0.1',diagnostics:[]},runtime_evidence:[],safety:{inventedActions:0}}),/runtime evidence/); });
