import { createHash } from 'node:crypto';
export function digestJson(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
export function buildMeta({ configuredMode='DEMO', iapJwt='', controlReachable=false, checkedAt=new Date(), report, expectedReportDigest }) {
  const checkedAtIso=checkedAt.toISOString(); const freshUntil=new Date(checkedAt.getTime()+60_000).toISOString();
  let dataMode='OFFLINE'; let controlStatus=controlReachable?'REACHABLE':'UNREACHABLE';
  if(configuredMode==='DEMO') dataMode='DEMO';
  else if(configuredMode==='LIVE'&&iapJwt&&controlReachable) dataMode='LIVE';
  const reportDigest=report?.__file_sha256??(report?digestJson(report):undefined); const verifiedAt=report?.generated_at; const reportFresh=typeof verifiedAt==='string'&&Date.parse(verifiedAt)+86_400_000>checkedAt.getTime();
  const digestMatches=!expectedReportDigest||reportDigest===expectedReportDigest;
  const digestPattern=/^sha256:[a-f0-9]{64}$/; const reportPass=report?.schema==='runbookbench-report/v0.1'&&report?.safety==='PASS'&&report?.publishable_corpus===true&&digestPattern.test(report?.corpus_sha256??'')&&digestPattern.test(report?.submission_sha256??'')&&reportFresh&&digestMatches;
  return { data_mode:dataMode,control_status:controlStatus,checked_at:checkedAtIso,fresh_until:freshUntil,benchmark:reportPass?{status:'PASS',report_sha256:reportDigest,corpus_sha256:report.corpus_sha256,submission_sha256:report.submission_sha256,verified_at:verifiedAt,fresh_until:new Date(Date.parse(verifiedAt)+86_400_000).toISOString()}:{status:report?.safety==='FAIL'?'FAIL':'NO_CURRENT_EVIDENCE'} };
}
