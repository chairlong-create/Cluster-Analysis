import test from "node:test";
import assert from "node:assert/strict";

import { getExtractionCategoryAssignment } from "../src/lib/extraction-category-assignment.ts";

test("getExtractionCategoryAssignment preserves category assignment when no target signal is found", () => {
  assert.deepEqual(getExtractionCategoryAssignment("no_buy_block_reason"), {
    categoryId: undefined,
    categoryNameSnapshot: undefined,
  });
});

test("getExtractionCategoryAssignment leaves category assignment untouched for extracted reasons", () => {
  assert.deepEqual(getExtractionCategoryAssignment("reasons_extracted"), {
    categoryId: undefined,
    categoryNameSnapshot: undefined,
  });
});
