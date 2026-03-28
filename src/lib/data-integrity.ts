import { db } from "@/lib/db";

export function repairOtherCategoryReferences(taskId: string) {
  const otherCategory = db
    .prepare(`
      SELECT id
      FROM categories
      WHERE task_id = ? AND is_other = 1 AND status = 'active'
      LIMIT 1
    `)
    .get(taskId) as { id: string } | undefined;

  if (!otherCategory) {
    return { repairedCount: 0 };
  }

  const result = db
    .prepare(`
      UPDATE dialog_analysis_results
      SET
        category_id = @otherCategoryId,
        result_status = CASE
          WHEN result_status IS NULL OR result_status = '' OR result_status = 'classified'
            THEN 'classified_other'
          ELSE result_status
        END,
        updated_at = @updatedAt
      WHERE task_id = @taskId
        AND category_name_snapshot = '其他'
        AND (category_id IS NULL OR category_id <> @otherCategoryId)
    `)
    .run({
      taskId,
      otherCategoryId: otherCategory.id,
      updatedAt: new Date().toISOString(),
    });

  return { repairedCount: result.changes };
}
