import test from "node:test";
import assert from "node:assert/strict";

import { launchBackgroundTask } from "../src/lib/background-task.ts";

test("launchBackgroundTask schedules work asynchronously", async () => {
  const events: string[] = [];

  launchBackgroundTask(async () => {
    events.push("task");
  });

  events.push("after-launch");
  assert.deepEqual(events, ["after-launch"]);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ["after-launch", "task"]);
});

test("launchBackgroundTask reports task errors via callback", async () => {
  const errors: string[] = [];

  launchBackgroundTask(
    async () => {
      throw new Error("boom");
    },
    (error) => {
      errors.push(error instanceof Error ? error.message : String(error));
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(errors, ["boom"]);
});
