import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = resolve(workspaceRoot, "artifacts/clc-projects/src");
const sourceExtensions = new Set([".css", ".tsx", ".ts"]);
const forbiddenImports = [
  {
    label: "local UI primitives",
    pattern: /(?:from\s+|import\s*\(\s*)['"]@\/components\/ui(?:\/|['"])/,
  },
  {
    label: "local utility module",
    pattern: /(?:from\s+|import\s*\(\s*)['"]@\/lib\/utils(?:['"]|\/)/,
  },
  {
    label: "local toast hook",
    pattern: /(?:from\s+|import\s*\(\s*)['"]@\/hooks\/use-toast(?:['"]|\/)/,
  },
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

const failures = [];
for (const file of sourceFiles(sourceRoot)) {
  const contents = readFileSync(file, "utf8");
  const lines = contents.split(/\r?\n/);
  for (const [lineNumber, line] of lines.entries()) {
    for (const { label, pattern } of forbiddenImports) {
      if (pattern.test(line)) {
        failures.push(
          `${relative(workspaceRoot, file)}:${lineNumber + 1} reintroduces ${label}: ${line.trim()}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Design-system import boundary passed for ${sourceFiles(sourceRoot).length} CLC source files.`,
);