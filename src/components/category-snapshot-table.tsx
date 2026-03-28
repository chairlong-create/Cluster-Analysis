"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  createCategoryInlineAction,
  deleteCategoryInlineAction,
  updateCategoryInlineAction,
} from "@/app/actions";
import type { CategorySummary } from "@/components/task-workspace-types";

type CategorySnapshotTableProps = {
  taskId: string;
  categories: CategorySummary[];
  analysisFocusLabel: string;
  disabled?: boolean;
};

type DraftState = {
  name: string;
  definition: string;
};

const NEW_ROW_ID = "__new__";

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="iconSvg">
      <path
        d="M11.9 1.6a1.5 1.5 0 0 1 2.1 2.1l-7.7 7.7-3.2.7.7-3.2 7.7-7.7Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="iconSvg">
      <path
        d="M2.8 4.2h10.4M6.2 2.8h3.6M5 4.2v7.3m3-7.3v7.3m3-7.3v7.3M4.4 13.2h7.2a.8.8 0 0 0 .8-.8V4.2H3.6v8.2c0 .4.4.8.8.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="iconSvg">
      <path
        d="m3 8 3.1 3.1L13 4.3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="iconSvg">
      <path
        d="M4 4 12 12M12 4 4 12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="iconSvg">
      <path
        d="M8 3v10M3 8h10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function CategorySnapshotTable({
  taskId,
  categories,
  analysisFocusLabel,
  disabled = false,
}: CategorySnapshotTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>({ name: "", definition: "" });
  const [inlineError, setInlineError] = useState<string | null>(null);

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const effectiveDisabled = disabled || isPending;

  function beginEdit(categoryId: string) {
    if (effectiveDisabled) {
      return;
    }

    const category = categoryMap.get(categoryId);
    if (!category) {
      return;
    }

    setEditingId(categoryId);
    setDraft({
      name: category.name,
      definition: category.definition,
    });
    setInlineError(null);
  }

  function beginCreate() {
    if (effectiveDisabled) {
      return;
    }

    setEditingId(NEW_ROW_ID);
    setDraft({
      name: "",
      definition: "",
    });
    setInlineError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft({ name: "", definition: "" });
    setInlineError(null);
  }

  function saveCurrent() {
    if (!editingId || effectiveDisabled) {
      return;
    }

    const payload = {
      taskId,
      name: draft.name,
      definition: draft.definition,
    };

    startTransition(async () => {
      const result =
        editingId === NEW_ROW_ID
          ? await createCategoryInlineAction(payload)
          : await updateCategoryInlineAction({
              ...payload,
              categoryId: editingId,
            });

      if (!result.ok) {
        setInlineError(result.error);
        return;
      }

      cancelEdit();
      router.refresh();
    });
  }

  function deleteCategory(categoryId: string, categoryName: string, hitCount: number) {
    if (effectiveDisabled) {
      return;
    }

    const confirmed = window.confirm(
      hitCount > 0
        ? `确认拆解类别“${categoryName}”吗？\n\n该类别下的 ${hitCount} 条记录会回到“其他”，之后你可以通过“处理全部其他”重新拆分这些记录。`
        : `确认删除类别“${categoryName}”吗？\n\n这个类别当前没有命中记录，删除后不会影响已有分析结果。`,
    );

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await deleteCategoryInlineAction({
        taskId,
        categoryId,
      });

      if (!result.ok) {
        setInlineError(result.error);
        return;
      }

      if (editingId === categoryId) {
        cancelEdit();
      }

      router.refresh();
    });
  }

  return (
    <div className="tableWrap compactTableWrap">
      <table className="dataTable compactDataTable categorySnapshotTable">
        <thead>
          <tr>
            <th>类别名称</th>
            <th>类别定义</th>
            <th>命中数</th>
            <th className="actionsCell">操作</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => {
            const isEditing = editingId === category.id;
            const isOther = category.isOther === 1;

            return (
              <tr
                key={category.id}
                className={[
                  "categoryRow",
                  isEditing ? "categoryRowEditing" : "",
                  isOther ? "categoryRowSystem" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <td className="categoryNameCell">
                  {isEditing && !isOther ? (
                    <input
                      className="categoryInlineInput"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder={`${analysisFocusLabel}类别名称`}
                      disabled={effectiveDisabled}
                    />
                  ) : (
                    <div className="categoryNameStack">
                      <span className="categoryNameText">{category.name}</span>
                      {isOther ? <span className="categorySystemBadge">系统保留</span> : null}
                    </div>
                  )}
                </td>
                <td className="wrapCell">
                  {isEditing ? (
                    <div className="inlineEditCell">
                      {isOther ? <p className="inlineReadonlyLabel">类别名称固定为“其他”</p> : null}
                      <textarea
                        className="categoryInlineTextarea"
                        value={draft.definition}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, definition: event.target.value }))
                        }
                        rows={3}
                        placeholder={`描述这个${analysisFocusLabel}类别的命中标准`}
                        disabled={effectiveDisabled}
                      />
                      {inlineError ? <p className="inlineErrorText">{inlineError}</p> : null}
                    </div>
                  ) : (
                    <span className="categoryDefinitionText">{category.definition}</span>
                  )}
                </td>
                <td>
                  <span className="categoryHitBadge">{category.hitCount}</span>
                </td>
                <td className="actionsCell">
                  <div className="rowActions">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="iconActionButton"
                          onClick={saveCurrent}
                          disabled={effectiveDisabled}
                          aria-label="保存类别"
                          title="保存"
                        >
                          <SaveIcon />
                        </button>
                        <button
                          type="button"
                          className="iconActionButton iconActionButtonMuted"
                          onClick={cancelEdit}
                          disabled={effectiveDisabled}
                          aria-label="取消编辑"
                          title="取消"
                        >
                          <CancelIcon />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="iconActionButton"
                          onClick={() => beginEdit(category.id)}
                          disabled={effectiveDisabled}
                          aria-label={`编辑类别 ${category.name}`}
                          title="编辑"
                        >
                          <EditIcon />
                        </button>
                        {!isOther ? (
                          <button
                            type="button"
                            className="iconActionButton iconActionButtonDanger"
                            onClick={() => deleteCategory(category.id, category.name, category.hitCount)}
                            disabled={effectiveDisabled}
                            aria-label={`删除类别 ${category.name}`}
                            title="删除"
                          >
                            <DeleteIcon />
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}

          {editingId === NEW_ROW_ID ? (
            <tr className="newCategoryRow categoryRow categoryRowEditing">
              <td>
                <input
                  className="categoryInlineInput"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder={`${analysisFocusLabel}类别名称`}
                  disabled={effectiveDisabled}
                />
              </td>
              <td className="wrapCell">
                <div className="inlineEditCell">
                  <textarea
                    className="categoryInlineTextarea"
                    value={draft.definition}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, definition: event.target.value }))
                    }
                    rows={3}
                    placeholder={`描述这个${analysisFocusLabel}类别的命中标准`}
                    disabled={effectiveDisabled}
                  />
                  {inlineError ? <p className="inlineErrorText">{inlineError}</p> : null}
                </div>
              </td>
              <td>新建</td>
              <td className="actionsCell">
                <div className="rowActions">
                  <button
                    type="button"
                    className="iconActionButton"
                    onClick={saveCurrent}
                    disabled={effectiveDisabled}
                    aria-label="保存新类别"
                    title="保存"
                  >
                    <SaveIcon />
                  </button>
                  <button
                    type="button"
                    className="iconActionButton iconActionButtonMuted"
                    onClick={cancelEdit}
                    disabled={effectiveDisabled}
                    aria-label="取消新增类别"
                    title="取消"
                  >
                    <CancelIcon />
                  </button>
                </div>
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="categoryAddCell">
              <button
                type="button"
                className="categoryAddButton"
                onClick={beginCreate}
                disabled={effectiveDisabled || editingId !== null}
              >
                <AddIcon />
                <span>新增类别</span>
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
