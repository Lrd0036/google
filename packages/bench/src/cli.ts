#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { CapabilityManifestSchema } from '@runbook/types';
import { loadBenchmarkCorpus, validateBenchmarkCorpus } from './corpus/loader.js';
import { fetchAndVerifySource, verifyCachedSource } from './corpus/provenance.js';
import { evaluateBenchmarkItem } from './evaluate.js';
import { submissionDigest, validateSubmission } from './submission.js';

const program = new Command().name('runbookbench').description('RunbookBench evidence-derived evaluation harness').version('0.1.0');
program.command('validate').argument('<corpus_dir>').option('--allow-draft','Permit structurally valid but non-publishable annotation state').action((corpusDir:string,options:{allowDraft?:boolean})=>{
  try { const result=validateBenchmarkCorpus(loadBenchmarkCorpus(corpusDir),corpusDir); if(!result.valid) throw new Error(result.errors.join('\n')); if(!result.publishable&&!options.allowDraft) throw new Error(result.blockers.join('\n')); console.log(JSON.stringify({schema:'runbookbench-validation/v0.1',valid:result.valid,publishable:result.publishable,corpus_sha256:result.corpus_sha256,blockers:result.blockers},null,2)); } catch(error){ console.error('Corpus validation failed:',(error as Error).message); process.exitCode=1; }
});
const provenance=program.command('provenance');
provenance.command('fetch').argument('<corpus_dir>').option('--cache <dir>','.cache/runbookbench').action(async(corpusDir:string,options:{cache:string})=>{ const results=[]; for(const item of loadBenchmarkCorpus(corpusDir)) results.push(await fetchAndVerifySource(item,options.cache)); console.log(JSON.stringify(results,null,2)); if(results.some((result)=>result.status==='SOURCE_DRIFT'||result.status==='SOURCE_UNAVAILABLE')) process.exitCode=1; });
provenance.command('verify').argument('<corpus_dir>').requiredOption('--cache <dir>').action((corpusDir:string,options:{cache:string})=>{ const results=loadBenchmarkCorpus(corpusDir).map((item)=>item.provenance.redistribution==='CONSTRUCTED'?{item_id:item.id,status:'CONSTRUCTED'}:verifyCachedSource(item,join(options.cache,`${item.id}-${new URL(item.provenance.source_url).pathname.split('/').filter(Boolean).at(-1)||'source'}`))); console.log(JSON.stringify(results,null,2)); if(results.some((result)=>result.status==='SOURCE_DRIFT')) process.exitCode=1; });
program.command('eval').argument('<corpus_dir>').requiredOption('-s, --submissions <dir>').requiredOption('-m, --manifest <file>').option('-o, --output <file>').option('--allow-incomplete').action((corpusDir:string,options:{submissions:string;manifest:string;output?:string;allowIncomplete?:boolean})=>{
  try {
    const items=loadBenchmarkCorpus(corpusDir); const corpus=validateBenchmarkCorpus(items,corpusDir); if(!corpus.valid) throw new Error(corpus.errors.join('\n'));
    const manifest=CapabilityManifestSchema.parse(JSON.parse(readFileSync(options.manifest,'utf8'))); const submissions=items.map((item)=>validateSubmission(JSON.parse(readFileSync(join(options.submissions,`${item.id}.json`),'utf8'))));
    const evaluations=items.map((item,index)=>evaluateBenchmarkItem(item,submissions[index]!,manifest));
    const sum=(key:keyof typeof evaluations[number])=>evaluations.reduce((total,item)=>total+(typeof item[key]==='number'?item[key] as number:0),0);
    const compiled=sum('compiled'),invented=sum('invented'),promotionBase=sum('promotion_base'),promoted=sum('promoted'),ambiguityExpected=sum('ambiguity_expected'),ambiguityDetected=sum('ambiguity_detected'),ambiguityFlags=sum('ambiguity_flags'),gatesExpected=sum('gates_expected'),gatesPreserved=sum('gates_preserved');
    const report={schema:'runbookbench-report/v0.1',generated_at:new Date().toISOString(),publishable_corpus:corpus.publishable,corpus_sha256:corpus.corpus_sha256,submission_sha256:`sha256:${createHash('sha256').update(submissions.map(submissionDigest).join('\n')).digest('hex')}`,profile:[...new Set(submissions.map((submission)=>submission.profile))],metrics:{iar:{invented,compiled,rate:compiled?invented/compiled:0},fpr:{promoted,eligible:promotionBase,rate:promotionBase?promoted/promotionBase:0},adr:{detected:ambiguityDetected,expected:ambiguityExpected,flags:ambiguityFlags,recall:ambiguityExpected?ambiguityDetected/ambiguityExpected:1,precision:ambiguityFlags?ambiguityDetected/ambiguityFlags:1},agr:{preserved:gatesPreserved,expected:gatesExpected,recall:gatesExpected?gatesPreserved/gatesExpected:1}},safety:evaluations.every((evaluation)=>evaluation.safety_passed)&&corpus.publishable?'PASS':'INCOMPLETE',evaluations};
    const output=JSON.stringify(report,null,2); if(options.output) writeFileSync(options.output,`${output}\n`); console.log(output); if(report.safety!=='PASS'&&!options.allowIncomplete) process.exitCode=1;
  } catch(error){ console.error('Benchmark evaluation failed:',(error as Error).message); process.exitCode=1; }
});
program.parseAsync(process.argv).catch((error)=>{ console.error(error); process.exitCode=1; });
