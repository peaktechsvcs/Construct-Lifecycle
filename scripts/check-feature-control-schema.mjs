import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const drizzlePath = path.join(rootDir, "lib/db/src/schema/platform.ts");
const migrationPath = path.join(rootDir, "lib/db/migrations/0019_platform_feature_controls.sql");
const [drizzleSource, migrationSource] = await Promise.all([
  readFile(drizzlePath, "utf8"),
  readFile(migrationPath, "utf8"),
]);

const tableDeclarations = [
  ["platformFeatureFlagsTable", "platform_feature_flags"],
  ["featureFeedbackVotesTable", "feature_feedback_votes"],
];

function matchingDelimiter(source, start, opening, closing) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed ${opening} in schema source`);
}

function normalizeDefault(value) {
  const normalized = value.trim().replace(/;$/, "");
  if (normalized === "false" || normalized === "true") return normalized;
  if (normalized === "now()" || normalized === "defaultNow()") return "now()";
  return normalized.replace(/^["']|["']$/g, "");
}

function drizzleType(builder, options) {
  if (builder === "timestamp" && options?.includes("withTimezone: true")) return "timestamptz";
  return builder;
}

function parseDrizzleTable(declaration, tableName) {
  const declarationStart = drizzleSource.indexOf(`export const ${declaration} = pgTable(`);
  if (declarationStart < 0) throw new Error(`Missing Drizzle table declaration: ${declaration}`);
  const callStart = drizzleSource.indexOf("(", declarationStart);
  const callEnd = matchingDelimiter(drizzleSource, callStart, "(", ")");
  const call = drizzleSource.slice(callStart + 1, callEnd);
  const objectStart = call.indexOf("{");
  const objectEnd = matchingDelimiter(call, objectStart, "{", "}");
  const columnsSource = call.slice(objectStart + 1, objectEnd);
  const columns = {};

  for (const line of columnsSource.split("\n")) {
    const match = line.match(/^\s*(\w+):\s*(\w+)\("([^"]+)"(?:,\s*(\{[^}]*\}))?\)(.*)$/);
    if (!match) continue;
    const [, property, builder, columnName, options, suffix] = match;
    const primaryKey = suffix.includes(".primaryKey()");
    const foreignKey = suffix.match(/\.references\(\(\) => (\w+)\.id,\s*\{\s*onDelete:\s*"([^"]+)"/);
    columns[columnName] = {
      type: drizzleType(builder, options),
      notNull: primaryKey || suffix.includes(".notNull()"),
      default: suffix.includes(".defaultNow()")
        ? "now()"
        : normalizeDefault(suffix.match(/\.default\(([^)]*)\)/)?.[1] ?? ""),
      primaryKey,
      foreignKey: foreignKey
        ? {
          targetTable: foreignKey[1] === "usersTable" ? "local_users" : "tenants",
          targetColumn: "id",
          onDelete: foreignKey[2].toUpperCase(),
        }
        : null,
      property,
    };
  }

  const indexes = [];
  const tableCallback = call.slice(objectEnd + 1);
  for (const match of tableCallback.matchAll(/(uniqueIndex|index)\("([^"]+)"\)\.on\(([^)]+)\)/g)) {
    indexes.push({
      name: match[2],
      unique: match[1] === "uniqueIndex",
      columns: match[3].split(",").map((field) => {
        const property = field.trim().replace(/^table\./, "");
        const column = Object.values(columns).find((candidate) => candidate.property === property);
        if (!column) throw new Error(`Unknown Drizzle index column ${property} on ${tableName}`);
        return columnNameFor(columns, property);
      }),
    });
  }

  return {
    columns: Object.fromEntries(Object.entries(columns).map(([column, value]) => {
      const { property: _property, ...contract } = value;
      return [column, contract];
    })),
    indexes,
  };
}

function columnNameFor(columns, property) {
  return Object.entries(columns).find(([, candidate]) => candidate.property === property)?.[0];
}

function splitSqlDefinitions(source) {
  const definitions = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      definitions.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  definitions.push(source.slice(start).trim());
  return definitions.filter(Boolean);
}

function sqlTableBody(tableName) {
  const expression = new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\s*\\(`, "i");
  const match = expression.exec(migrationSource);
  if (!match) throw new Error(`Missing migration table definition: ${tableName}`);
  const bodyStart = match.index + match[0].length - 1;
  const bodyEnd = matchingDelimiter(migrationSource, bodyStart, "(", ")");
  return migrationSource.slice(bodyStart + 1, bodyEnd);
}

function parseMigrationTable(tableName) {
  const columns = {};
  for (const definition of splitSqlDefinitions(sqlTableBody(tableName))) {
    const columnMatch = definition.match(/^"?([a-z0-9_]+)"?\s+(serial|text|boolean|integer|timestamptz)\b([\s\S]*)$/i);
    if (!columnMatch) continue;
    const [, columnName, type, suffix] = columnMatch;
    const primaryKey = /\bPRIMARY KEY\b/i.test(suffix);
    const foreignKey = suffix.match(/REFERENCES\s+"?([a-z0-9_]+)"?\s*\("?( [a-z0-9_]+|[a-z0-9_]+)"?\)\s+ON DELETE\s+([A-Z ]+)/i);
    columns[columnName] = {
      type: type.toLowerCase(),
      notNull: primaryKey || /\bNOT NULL\b/i.test(suffix),
      default: normalizeDefault(suffix.match(/\bDEFAULT\s+([\s\S]+)$/i)?.[1] ?? ""),
      primaryKey,
      foreignKey: foreignKey
        ? {
          targetTable: foreignKey[1],
          targetColumn: foreignKey[2].trim(),
          onDelete: foreignKey[3].trim(),
        }
        : null,
    };
  }

  const indexes = [];
  const indexPattern = /CREATE\s+(UNIQUE\s+)?INDEX\s+IF NOT EXISTS\s+"?([a-z0-9_]+)"?\s+ON\s+"?([a-z0-9_]+)"?\s*\(([^)]+)\)/gi;
  for (const match of migrationSource.matchAll(indexPattern)) {
    if (match[3].toLowerCase() !== tableName) continue;
    indexes.push({
      name: match[2],
      unique: Boolean(match[1]),
      columns: match[4].split(",").map((column) => column.trim().replace(/^"|"$/g, "")),
    });
  }

  return { columns, indexes };
}

function normalizeContract(table) {
  return {
    columns: Object.fromEntries(Object.entries(table.columns).sort(([left], [right]) => left.localeCompare(right))),
    primaryKeys: Object.entries(table.columns)
      .filter(([, column]) => column.primaryKey)
      .map(([column]) => column)
      .sort(),
    foreignKeys: Object.entries(table.columns)
      .filter(([, column]) => column.foreignKey)
      .map(([column, value]) => ({ column, ...value.foreignKey }))
      .sort((left, right) => left.column.localeCompare(right.column)),
    indexes: table.indexes
      .map((index) => ({ ...index, columns: [...index.columns] }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function compare(tableName, drizzleTable, migrationTable) {
  const drizzleContract = normalizeContract(drizzleTable);
  const migrationContract = normalizeContract(migrationTable);
  const left = JSON.stringify(drizzleContract, null, 2);
  const right = JSON.stringify(migrationContract, null, 2);
  if (left !== right) {
    throw new Error(`Feature-control schema drift detected for ${tableName}\nDrizzle:\n${left}\nMigration:\n${right}`);
  }
}

for (const [declaration, tableName] of tableDeclarations) {
  compare(tableName, parseDrizzleTable(declaration, tableName), parseMigrationTable(tableName));
}

console.log("Feature-control schema contract is aligned.");