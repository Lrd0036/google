import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["GitHub token", /(?:gh[opsu]_[0-9A-Za-z]{36,255}|github_pat_[0-9A-Za-z_]{50,255})/],
  ["AWS access key", /(?:AKIA|ASIA)[0-9A-Z]{16}/],
  ["Slack token", /xox[baprs]-[0-9A-Za-z-]{10,}/],
  ["Stripe live key", /(?:sk|rk)_live_[0-9A-Za-z]{16,}/],
  ["service-account private key", /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/],
  ["workstation home path", /(?:\/Users\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)/],
  ["credential-bearing URL", /https?:\/\/[^\s/:]+:[^\s/@]+@/],
];

const emailPattern = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const allowedEmailDomains = new Set(["example.com", "developer.gserviceaccount.com"]);
const findings = [];

for (const file of files) {
  if (file === "scripts/check-sensitive-data.mjs") continue;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const [name, pattern] of rules) {
    if (pattern.test(text)) findings.push({ file, rule: name });
  }
  for (const match of text.matchAll(emailPattern)) {
    if (!allowedEmailDomains.has(match[1].toLowerCase())) {
      findings.push({ file, rule: "personal email address" });
      break;
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`${finding.file}: ${finding.rule}`);
  process.exitCode = 1;
} else {
  console.log(`Sensitive-data check passed (${files.length} current files inspected).`);
}
