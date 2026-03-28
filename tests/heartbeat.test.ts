import test from "node:test";
import assert from "node:assert/strict";

import { withHeartbeat } from "../src/lib/heartbeat.ts";

test("withHeartbeat emits beats until work resolves", async () => {
  const beats: number[] = [];
  let release: (() => void) | null = null;

  const work = new Promise<string>((resolve) => {
    release = () => resolve("done");
  });

  const resultPromise = withHeartbeat({
    intervalMs: 10,
    beat: async () => {
      beats.push(Date.now());
    },
    run: () => work,
  });

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.ok(beats.length >= 2);

  release?.();
  const result = await resultPromise;
  assert.equal(result, "done");

  const beatCountAfterResolve = beats.length;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(beats.length, beatCountAfterResolve);
});
