import { z } from "zod";
import { getAppSettings } from "@/lib/app-config";
import { buildClusteringSystemPrompt, getClusteringUserPrompt } from "@/lib/prompts/clustering";

type ClusterCandidate = {
  name: string;
  definition: string;
  exampleReasons: string[];
};

export type ClusterSuggestionResponse = {
  categories: ClusterCandidate[];
  log: {
    promptText: string;
    responseText: string;
    status: "succeeded" | "failed";
    latencyMs: number;
    model: string;
    provider: string;
  };
};

const looseClusterResponseSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string(),
        definition: z.string(),
        example_reasons: z.array(z.string()).default([]),
      }),
    )
    .min(1),
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

function normalizeCategories(
  categories: Array<{
    name: string;
    definition: string;
    example_reasons?: string[];
  }>,
) {
  const deduped = new Map<
    string,
    {
      name: string;
      definition: string;
      exampleReasons: string[];
    }
  >();

  for (const item of categories) {
    const name = item.name.trim();
    const definition = item.definition.trim();

    if (!name || !definition) {
      continue;
    }

    const key = name.toLowerCase();
    if (deduped.has(key)) {
      continue;
    }

    deduped.set(key, {
      name,
      definition,
      exampleReasons: (item.example_reasons ?? []).map((reason) => reason.trim()).filter(Boolean).slice(0, 5),
    });
  }

  return Array.from(deduped.values()).slice(0, 50);
}

function mockCluster(reasons: string[], analysisFocusLabel: string): ClusterSuggestionResponse {
  const lowered = reasons.join("\n");
  const categories: ClusterCandidate[] = [];

  if (lowered.includes("年龄") || lowered.includes("还小") || lowered.includes("阶段")) {
    categories.push({
      name: "年龄/时机不合适",
      definition: "用户认为孩子当前年龄、学段或报名时机不适合当前课程。",
      exampleReasons: reasons.filter((reason) => reason.includes("年龄") || reason.includes("还小") || reason.includes("阶段")).slice(0, 3),
    });
  }

  if (lowered.includes("价格") || lowered.includes("费用") || lowered.includes("太贵")) {
    categories.push({
      name: "价格顾虑",
      definition: "用户明确表示价格、费用或性价比不满足预期。",
      exampleReasons: reasons.filter((reason) => reason.includes("价格") || reason.includes("费用") || reason.includes("太贵")).slice(0, 3),
    });
  }

  if (lowered.includes("时间") || lowered.includes("没空")) {
    categories.push({
      name: "时间安排冲突",
      definition: "用户因上课时间、家庭安排或精力不足而无法报名。",
      exampleReasons: reasons.filter((reason) => reason.includes("时间") || reason.includes("没空")).slice(0, 3),
    });
  }

  if (!categories.length) {
    categories.push({
      name: "待进一步细分",
      definition: `当前样本中的${analysisFocusLabel}表述分散，暂时只形成一个待细分的大类。`,
      exampleReasons: reasons.slice(0, 3),
    });
  }

  return {
    categories,
    log: {
      promptText: buildClusteringSystemPrompt(reasons, `分析对话中的${analysisFocusLabel}`, analysisFocusLabel),
      responseText: JSON.stringify({ categories }),
      status: "succeeded",
      latencyMs: 0,
      model: "mock-openai-compatible",
      provider: "mock",
    },
  };
}

export async function clusterReasonsWithMiniMax(
  reasons: string[],
  analysisGoal: string,
  analysisFocusLabel: string,
): Promise<ClusterSuggestionResponse> {
  const settings = getAppSettings();
  const apiKey = settings.llmApiKey;
  const baseUrl = settings.llmBaseUrl;
  const model = settings.llmModel;
  const systemPrompt = buildClusteringSystemPrompt(reasons, analysisGoal, analysisFocusLabel);
  const userPrompt = getClusteringUserPrompt();

  if (!apiKey) {
    return mockCluster(reasons, analysisFocusLabel);
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
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
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
      categories: [],
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

  try {
    const parsed = looseClusterResponseSchema.parse(JSON.parse(extractJsonBlock(content)));
    const normalizedCategories = normalizeCategories(parsed.categories);

    if (!normalizedCategories.length) {
      throw new Error("聚类结果为空");
    }

    return {
      categories: normalizedCategories,
      log: {
        promptText: systemPrompt,
        responseText:
          parsed.categories.length > normalizedCategories.length
            ? `${responseText}\n\n[cluster-normalized]\noriginal_categories=${parsed.categories.length}, normalized_categories=${normalizedCategories.length}`
            : responseText,
        status: "succeeded",
        latencyMs,
        model,
        provider: "OpenAI-compatible",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "聚类结果解析失败";

    return {
      categories: [],
      log: {
        promptText: systemPrompt,
        responseText: `${responseText}\n\n[cluster-parse-error]\n${message}`,
        status: "failed",
        latencyMs,
        model,
        provider: "OpenAI-compatible",
      },
    };
  }
}
