import test from "node:test";
import assert from "node:assert/strict";

import { parseExtractionResponse } from "../src/lib/llm/extraction-parser.ts";

test("parseExtractionResponse accepts false branch with omitted fields", () => {
  const responseText = JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            has_buy_block_reason: false,
          }),
        },
      },
    ],
  });

  const result = parseExtractionResponse(responseText);

  assert.deepEqual(result, {
    hasTargetSignal: false,
    analysisSummary: "",
    evidenceQuote: "",
    evidenceExplanation: "",
    confidence: 0,
  });
});

test("parseExtractionResponse preserves raw response on invalid payload", () => {
  const responseText = JSON.stringify({
    choices: [
      {
        message: {
          content: "{not-valid-json}",
        },
      },
    ],
  });

  assert.throws(
    () => parseExtractionResponse(responseText),
    (error: unknown) =>
      error instanceof Error &&
      "responseText" in error &&
      String((error as { responseText: string }).responseText) === responseText,
  );
});
