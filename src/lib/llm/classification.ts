import { z } from "zod";
import type { AppSettings } from "@/lib/app-config";
import {
  buildClassificationSystemPrompt,
  getClassificationUserPrompt,
} from "@/lib/prompts/classification";
import type { PromptSettings } from "@/lib/prompt-config";

type CategoryInput = {
  id: string;
  name: string;
  definition: string;
  isOther: number;
};

export type ClassificationOutput = {
  matchedCategoryId: string | null;
  matchedCategoryName: string;
  isOther: boolean;
  analysisSummary: string;
  evidenceQuote: string;
  evidenceExplanation: string;
  confidence: number;
};

export type ClassificationResponse = {
  result: ClassificationOutput;
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
  matched_category_name: z.string(),
  is_other: z.boolean(),
  buy_block_reason: z.string(),
  evidence_quote: z.string(),
  evidence_explanation: z.string(),
  confidence: z.number().min(0).max(1),
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

function mockClassify(input: {
  text: string;
  extractedReason: string;
  categories: CategoryInput[];
  analysisGoal: string;
  analysisFocusLabel: string;
}): ClassificationResponse {
  const content = `${input.text}\n${input.extractedReason}`;
  const otherCategory = input.categories.find((item) => item.isOther === 1);
  let matched = input.categories.find((item) => item.name.includes("年龄") || item.name.includes("时机"));
  let isOther = false;

  if (!matched) {
    matched = otherCategory;
    isOther = true;
  }

  if (!matched) {
    throw new Error("类别表缺少系统“其他”类别");
  }

  if (content.includes("价格") || content.includes("费用") || content.includes("太贵")) {
    matched =
      input.categories.find((item) => item.name.includes("价格")) ??
      otherCategory ??
      matched;
    isOther = matched.id === otherCategory?.id;
  } else if (content.includes("时间") || content.includes("没空")) {
    matched =
      input.categories.find((item) => item.name.includes("时间")) ??
      otherCategory ??
      matched;
    isOther = matched.id === otherCategory?.id;
  } else if (content.includes("还小") || content.includes("正式上学")) {
    matched =
      input.categories.find((item) => item.name.includes("年龄") || item.name.includes("时机")) ??
      otherCategory ??
      matched;
    isOther = matched.id === otherCategory?.id;
  }

  const result: ClassificationOutput = {
    matchedCategoryId: matched.id,
    matchedCategoryName: matched.name,
    isOther,
    analysisSummary: input.extractedReason || `当前对话未形成稳定的${input.analysisFocusLabel}信号。`,
    evidenceQuote: content.includes("正式上学还小")
      ? "这个正式上学还小"
      : input.text.slice(0, 40),
    evidenceExplanation: isOther
      ? "当前类别表中没有更合适的类别，因此暂归入其他。"
      : `对话内容与“${matched.name}”的定义最匹配。`,
    confidence: isOther ? 0.45 : 0.82,
  };

  return {
    result,
    log: {
      promptText: "[mock] classification prompt",
      responseText: JSON.stringify(result),
      status: "succeeded",
      latencyMs: 0,
      model: "mock-openai-compatible",
      provider: "mock",
    },
  };
}

export async function classifyDialogWithMiniMax(input: {
  text: string;
  extractedReason: string;
  categories: CategoryInput[];
  analysisGoal: string;
  analysisFocusLabel: string;
}, settings: AppSettings, promptSettings: PromptSettings): Promise<ClassificationResponse> {
  const apiKey = settings.llmApiKey;
  const baseUrl = settings.llmBaseUrl;
  const model = settings.llmModel;
  const systemPrompt = buildClassificationSystemPrompt(input, promptSettings);
  const userPrompt = getClassificationUserPrompt();

  if (!apiKey) {
    return mockClassify(input);
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
      result: {
        matchedCategoryId: null,
        matchedCategoryName: "其他",
        isOther: true,
        analysisSummary: input.extractedReason,
        evidenceQuote: "",
        evidenceExplanation: "",
        confidence: 0,
      },
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

  const matchedCategory =
    input.categories.find((item) => item.name === parsed.matched_category_name) ??
    input.categories.find((item) => item.isOther === 1) ??
    null;
  const otherCategory = input.categories.find((item) => item.isOther === 1) ?? null;
  const shouldFallbackToOther = parsed.is_other || matchedCategory?.isOther === 1;
  const finalCategory = shouldFallbackToOther ? (otherCategory ?? matchedCategory) : matchedCategory;

  return {
    result: {
      matchedCategoryId: finalCategory?.id ?? null,
      matchedCategoryName: finalCategory?.name ?? parsed.matched_category_name,
      isOther: shouldFallbackToOther,
      analysisSummary: parsed.buy_block_reason.trim(),
      evidenceQuote: parsed.evidence_quote.trim(),
      evidenceExplanation: parsed.evidence_explanation.trim(),
      confidence: parsed.confidence,
    },
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
