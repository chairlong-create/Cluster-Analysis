import { z } from "zod";

import type { AppSettings } from "@/lib/app-config";
import { buildCategoryMergeSystemPrompt, getCategoryMergeUserPrompt } from "@/lib/prompts/category-merge";
import type { PromptSettings } from "@/lib/prompt-config";

type MergeCategoryInput = {
  name: string;
  definition: string;
  hitCount: number;
};

type MergeCategoryOutput = {
  name: string;
  definition: string;
  sourceCategoryNames: string[];
};

export type CategoryMergeResponse = {
  mergedCategories: MergeCategoryOutput[];
  log: {
    promptText: string;
    responseText: string;
    status: "succeeded" | "failed";
    latencyMs: number;
    model: string;
    provider: string;
  };
};

const responseSchema = z.object({
  merged_categories: z.array(
    z.object({
      name: z.string(),
      definition: z.string(),
      source_category_names: z.array(z.string()).min(1),
    }),
  ),
});

function extractJsonBlock(content: string) {
  const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    return objectMatch[0].trim();
  }

  return content.trim();
}

function createMockMerge(categories: MergeCategoryInput[], maxTargetCount: number): CategoryMergeResponse {
  const promptText = "[mock] category merge prompt";

  const mergedCategories =
    categories.length <= maxTargetCount
      ? categories.map((category) => ({
          name: category.name,
          definition: category.definition,
          sourceCategoryNames: [category.name],
        }))
      : [
          {
            name: categories[0]?.name || "合并类别",
            definition: categories[0]?.definition || "由多个近义类别合并得到。",
            sourceCategoryNames: categories.map((category) => category.name),
          },
        ];

  return {
    mergedCategories,
    log: {
      promptText,
      responseText: JSON.stringify({ merged_categories: mergedCategories }),
      status: "succeeded",
      latencyMs: 0,
      model: "mock-openai-compatible",
      provider: "mock",
    },
  };
}

export async function mergeCategoriesWithMiniMax(
  categories: MergeCategoryInput[],
  maxTargetCount: number,
  settings: AppSettings,
  promptSettings: PromptSettings,
): Promise<CategoryMergeResponse> {
  const apiKey = settings.llmApiKey;
  const baseUrl = settings.llmBaseUrl;
  const model = settings.llmModel;
  const systemPrompt = buildCategoryMergeSystemPrompt(categories, maxTargetCount, promptSettings);
  const userPrompt = getCategoryMergeUserPrompt();

  if (!apiKey) {
    return createMockMerge(categories, maxTargetCount);
  }

  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_object",
      },
    }),
    cache: "no-store",
  });

  const latencyMs = Date.now() - startedAt;
  const responseText = await response.text();

  if (!response.ok) {
    return {
      mergedCategories: [],
      log: {
        promptText: systemPrompt,
        responseText,
        status: "failed",
        latencyMs,
        model,
        provider: "OpenAI-compatible",
      },
    };
  }

  const payload = JSON.parse(responseText) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const parsed = responseSchema.parse(JSON.parse(extractJsonBlock(content)));

  return {
    mergedCategories: parsed.merged_categories.map((item) => ({
      name: item.name.trim(),
      definition: item.definition.trim(),
      sourceCategoryNames: item.source_category_names.map((name) => name.trim()).filter(Boolean),
    })),
    log: {
      promptText: systemPrompt,
      responseText,
      status: "succeeded",
      latencyMs,
      model,
      provider: "OpenAI-compatible",
    },
  };
}
