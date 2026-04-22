import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("extraction LLM pipeline uses shared burst-rate retry wrapper", () => {
  const source = readSource("../src/lib/llm/minimax.ts");

  assert.match(source, /import\s+\{\s*fetchWithBurstRateRetry\s*\}\s+from\s+"@\/lib\/llm\/openai-compatible-fetch"/);
  assert.match(source, /fetchWithBurstRateRetry\(`\$\{baseUrl\}\/chat\/completions`/);
  assert.match(source, /rateLimitKey:\s*`extraction:\$\{baseUrl\}:\$\{model\}`/);
  assert.match(source, /minIntervalMs:\s*220/);
});

test("clustering LLM pipeline uses shared burst-rate retry wrapper", () => {
  const source = readSource("../src/lib/llm/clustering.ts");

  assert.match(source, /import\s+\{\s*fetchWithBurstRateRetry\s*\}\s+from\s+"@\/lib\/llm\/openai-compatible-fetch"/);
  assert.match(source, /fetchWithBurstRateRetry\(`\$\{baseUrl\}\/chat\/completions`/);
  assert.match(source, /rateLimitKey:\s*`clustering:\$\{baseUrl\}:\$\{model\}`/);
  assert.match(source, /minIntervalMs:\s*220/);
});

test("category merge LLM pipeline uses shared burst-rate retry wrapper", () => {
  const source = readSource("../src/lib/llm/category-merge.ts");

  assert.match(source, /import\s+\{\s*fetchWithBurstRateRetry\s*\}\s+from\s+"@\/lib\/llm\/openai-compatible-fetch"/);
  assert.match(source, /fetchWithBurstRateRetry\(`\$\{baseUrl\}\/chat\/completions`/);
  assert.match(source, /rateLimitKey:\s*`category-merge:\$\{baseUrl\}:\$\{model\}`/);
  assert.match(source, /minIntervalMs:\s*220/);
});
