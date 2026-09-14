import { readFile, writeFile } from "node:fs/promises";

const typesIndex = new URL("../api-zod/src/generated/types/index.ts", import.meta.url);
const duplicateExport = "export * from './listSubmittalDocumentProviderFilesParams';\n";
const source = await readFile(typesIndex, "utf8");

if (source.includes(duplicateExport)) {
  await writeFile(typesIndex, source.replace(duplicateExport, ""));
}

for (const relativePath of [
  "../api-client-react/src/generated/api.schemas.ts",
  "../api-client-react/src/generated/api.ts",
  "../api-zod/src/generated/api.ts",
]) {
  const target = new URL(relativePath, import.meta.url);
  const generated = await readFile(target, "utf8");
  await writeFile(target, `${generated.trimEnd()}\n`);
}