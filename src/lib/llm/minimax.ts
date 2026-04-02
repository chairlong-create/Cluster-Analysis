import type { AppSettings } from "@/lib/app-config";
import { parseExtractionResponse } from "@/lib/llm/extraction-parser";
import type { ExtractionRequest, ExtractionResult, ProviderExtractionResponse } from "@/lib/llm/types";
import { buildExtractionSystemPrompt, getExtractionUserPrompt } from "@/lib/prompts/extraction";
import type { PromptSettings } from "@/lib/prompt-config";

function createMockResponse(request: ExtractionRequest): ProviderExtractionResponse {
  const text = request.text.replace(/\s+/g, "");

  let result: ExtractionResult = {
    hasTargetSignal: true,
    analysisSummary: `${request.analysisFocusLabel}暂不明确，需进一步人工确认。`,
    evidenceQuote: request.text.slice(0, 60),
    evidenceExplanation: "当前未配置 OpenAI-compatible API Key，使用 mock 结果占位。",
    confidence: 0.35,
  };

  if (text.includes("太贵") || text.includes("价格") || text.includes("费用")) {
    result = {
      hasTargetSignal: true,
      analysisSummary: "用户对价格或费用存在顾虑。",
      evidenceQuote: "太贵 / 价格 / 费用",
      evidenceExplanation: "对话中出现了明确的价格顾虑词。",
      confidence: 0.62,
    };
  } else if (text.includes("没时间") || text.includes("没空") || text.includes("时间")) {
    result = {
      hasTargetSignal: true,
      analysisSummary: "用户当前时间安排不合适，无法投入课程。",
      evidenceQuote: "没时间 / 没空",
      evidenceExplanation: "对话中出现时间安排冲突信号。",
      confidence: 0.6,
    };
  } else if (text.includes("还小") || text.includes("太小") || text.includes("正式上学")) {
    result = {
      hasTargetSignal: true,
      analysisSummary: "用户认为孩子当前年龄或阶段还不适合报名。",
      evidenceQuote: "这个正式上学还小",
      evidenceExplanation: "用户直接表达了年龄和时机不合适。",
      confidence: 0.8,
    };
  } else if (text.includes("确认收货") || text.includes("安排好了") || text.includes("发货")) {
    result = {
      hasTargetSignal: false,
      analysisSummary: "",
      evidenceQuote: "",
      evidenceExplanation: "对话更像已成交后的服务流程，没有稳定的未购买原因。",
      confidence: 0.7,
    };
  }

  return {
    result,
    log: {
      promptText: "[mock] extraction prompt",
      responseText: JSON.stringify(result),
      status: "succeeded",
      latencyMs: 0,
      model: "mock-openai-compatible",
      provider: "mock",
    },
  };
}

export async function extractReasonWithMiniMax(
  request: ExtractionRequest,
  settings: AppSettings,
  promptSettings: PromptSettings,
): Promise<ProviderExtractionResponse> {
  const apiKey = settings.llmApiKey;
  const baseUrl = settings.llmBaseUrl;
  const model = settings.llmModel;
  const systemPrompt = buildExtractionSystemPrompt(request, promptSettings);
  const userPrompt = getExtractionUserPrompt();

  if (!apiKey) {
    return createMockResponse(request);
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
      result: {
        hasTargetSignal: false,
        analysisSummary: "",
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

  return {
    result: parseExtractionResponse(responseText),
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
