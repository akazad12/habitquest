import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{25,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /AKIA[0-9A-Z]{16}/,
];
const issues = [];
for (const file of new Set(files)) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".example"))
    issues.push(file);
  try {
    const text = readFileSync(file, "utf8");
    if (patterns.some((p) => p.test(text))) issues.push(file);
  } catch {
    issues.push(file);
  }
}
if (issues.length) {
  console.error("Potential secret files (values withheld):", [
    ...new Set(issues),
  ]);
  process.exitCode = 1;
} else
  console.log(
    "Source secret-pattern check passed (not a complete secret scanner).",
  );
