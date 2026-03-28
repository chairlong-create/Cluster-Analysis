import { z } from "zod";

import type { ExtractionResult } from "./types";

const extractionResponseSchema = z.object({
  has_buy_block_reason: z.boolean(),
  buy_block_reason: z.string().optional().default(""),
  evidence_quote: z.string().optional().default(""),
  evidence_explanation: z.string().optional().default(""),
  confidence: z.number().min(0).max(1).optional().default(0),
});

export class ExtractionParseError extends Error {
  responseText: string;

  constructor(message: string, responseText: string) {
    super(message);
    this.name = "ExtractionParseError";
    this.responseText = responseText;
  }
}

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

function normalizeExtraction(payload: z.infer<typeof extractionResponseSchema>): ExtractionResult {
  return {
    hasTargetSignal: payload.has_buy_block_reason,
    analysisSummary: payload.buy_block_reason.trim(),
    evidenceQuote: payload.evidence_quote.trim(),
    evidenceExplanation: payload.evidence_explanation.trim(),
    confidence: payload.confidence,
  };
}

export function parseExtractionResponse(responseText: string): ExtractionResult {
  try {
    const payload = JSON.parse(responseText) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const jsonBlock = extractJsonBlock(content);
    const parsed = extractionResponseSchema.parse(JSON.parse(jsonBlock));
    return normalizeExtraction(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse extraction response";
    throw new ExtractionParseError(message, responseText);
  }
}
