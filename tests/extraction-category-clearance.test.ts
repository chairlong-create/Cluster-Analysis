import test from "node:test";
import assert from "node:assert/strict";

import { getExtractionCategoryAssignment } from "../src/lib/extraction-category-assignment.ts";

test("getExtractionCategoryAssignment clears stale category assignment when no target signal is found", () => {
  assert.deepEqual(getExtractionCategoryAssignment("no_buy_block_reason"), {
    categoryId: null,
    categoryNameSnapshot: null,
  });
});

test("getExtractionCategoryAssignment leaves category assignment untouched for extracted reasons", () => {
  assert.deepEqual(getExtractionCategoryAssignment("reasons_extracted"), {
    categoryId: undefined,
    categoryNameSnapshot: undefined,
  });
});
