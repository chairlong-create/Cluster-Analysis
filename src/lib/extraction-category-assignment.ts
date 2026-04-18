type ExtractionResultStatus = "reasons_extracted" | "no_buy_block_reason";

export function getExtractionCategoryAssignment(resultStatus: ExtractionResultStatus) {
  if (resultStatus === "no_buy_block_reason") {
    return {
      categoryId: null,
      categoryNameSnapshot: null,
    };
  }

  return {
    categoryId: undefined,
    categoryNameSnapshot: undefined,
  };
}
