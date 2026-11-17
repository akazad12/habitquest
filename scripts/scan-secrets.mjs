import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const config = resolve(root, ".gitleaks.toml");
if (spawnSync("gitleaks", ["version"], { stdio: "ignore" }).status !== 0) {
  console.error(
    "Gitleaks is required. Install the documented scanner version; scans never silently skip.",
  );
  process.exit(1);
}
const scratch = mkdtempSync(join(tmpdir(), "habitquest-secret-scan-"));
try {
  const source = join(scratch, "source");
  mkdirSync(source);
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of new Set(files)) {
    if (!existsSync(join(root, file))) continue;
    const target = join(source, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target, { dereference: false });
  }
  let failures = 0;
  for (const [name, args] of [
    ["source", ["dir", source]],
    ["history", ["git", root, "--log-opts=--all --full-history"]],
  ]) {
    const report = join(scratch, `${name}.json`);
    const result = spawnSync(
      "gitleaks",
      [
        ...args,
        "--config",
        config,
        "--redact=100",
        "--ignore-gitleaks-allow",
        "--no-banner",
        "--log-level=error",
        "--report-format=json",
        "--report-path",
        report,
      ],
      { stdio: "ignore", timeout: 120000 },
    );
    if (result.status === 0) {
      console.log(`Gitleaks ${name}: passed.`);
      continue;
    }
    failures++;
    if (result.status === 1 && existsSync(report)) {
      // Never forward scanner stdout, raw findings, authors, matches, or secret values.
      const findings = JSON.parse(readFileSync(report, "utf8"));
      console.error(
        `Gitleaks ${name}: ${findings.length} finding(s); values withheld.`,
      );
      for (const f of findings)
        console.error(
          JSON.stringify({
            file: String(f.File).replace(source + "/", ""),
            line: f.StartLine,
            rule: f.RuleID,
          }),
        );
    } else
      console.error(
        `Gitleaks ${name}: scanner failed or timed out; scan did not pass.`,
      );
  }
  if (failures) process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
