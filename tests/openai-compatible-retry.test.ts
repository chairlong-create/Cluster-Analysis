import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithBurstRateRetry } from "../src/lib/llm/openai-compatible-fetch.ts";

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("fetchWithBurstRateRetry retries when provider returns limit_burst_rate", async () => {
  let calls = 0;
  const sleepCalls: number[] = [];

  const response = await fetchWithBurstRateRetry("https://example.com/chat/completions", {
    method: "POST",
    body: "{}",
    fetchImpl: async () => {
      calls += 1;

      if (calls < 3) {
        return createJsonResponse(
          {
            error: {
              message: "Request rate increased too quickly.",
              type: "limit_burst_rate",
              code: "limit_burst_rate",
            },
          },
          429,
        );
      }

      return createJsonResponse({ ok: true }, 200);
    },
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(sleepCalls, [500, 1200]);
});

test("fetchWithBurstRateRetry does not retry non-burst-rate failures", async () => {
  let calls = 0;

  const response = await fetchWithBurstRateRetry("https://example.com/chat/completions", {
    method: "POST",
    body: "{}",
    fetchImpl: async () => {
      calls += 1;
      return createJsonResponse(
        {
          error: {
            message: "invalid request",
            type: "invalid_request_error",
            code: "invalid_request_error",
          },
        },
        400,
      );
    },
    sleep: async () => {
      throw new Error("sleep should not be called");
    },
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});
