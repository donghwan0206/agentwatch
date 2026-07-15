import { spawnSync } from "node:child_process";

const candidates =
  process.platform === "win32"
    ? [
        ["py", ["-3", "-m", "unittest"]],
        ["python", ["-m", "unittest"]],
        ["python3", ["-m", "unittest"]],
      ]
    : [
        ["python3", ["-m", "unittest"]],
        ["python", ["-m", "unittest"]],
      ];

let lastError = null;
for (const [command, args] of candidates) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error?.code === "ENOENT") {
    lastError = result.error;
    continue;
  }
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error("Python 3 was not found. Tried: " + candidates.map(([command]) => command).join(", "));
if (lastError) {
  console.error(lastError.message);
}
process.exit(1);
