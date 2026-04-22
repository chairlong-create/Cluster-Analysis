import test from "node:test";
import assert from "node:assert/strict";

import { createSeeOtherRedirectResponse } from "../src/lib/http-redirect.ts";

test("createSeeOtherRedirectResponse uses relative location without host leakage", () => {
  const response = createSeeOtherRedirectResponse("/tasks/task-123");

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/tasks/task-123");
});
