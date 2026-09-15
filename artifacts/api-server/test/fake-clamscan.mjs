#!/usr/bin/env node
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const content = Buffer.concat(chunks).toString("utf8");
if (content.includes("MALWARE_TEST_TIMEOUT")) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
if (content.includes("MALWARE_TEST_INFECTED")) process.exitCode = 1;
else if (content.includes("MALWARE_TEST_UNAVAILABLE")) process.exitCode = 2;
else process.exitCode = 0;