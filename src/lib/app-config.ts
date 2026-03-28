import { db } from "@/lib/db";

type ConfigKey =
  | "openai_compatible_api_key"
  | "openai_compatible_base_url"
  | "openai_compatible_model"
  | "minimax_api_key"
  | "minimax_base_url"
  | "minimax_model"
  | "extraction_concurrency"
  | "classify_concurrency";

export type AppSettings = {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  extractionConcurrency: number;
  classifyConcurrency: number;
};

const defaultSettings: AppSettings = {
  llmApiKey: process.env.OPENAI_COMPATIBLE_API_KEY || process.env.MINIMAX_API_KEY || "",
  llmBaseUrl:
    process.env.OPENAI_COMPATIBLE_BASE_URL ||
    process.env.MINIMAX_BASE_URL ||
    "https://api.minimaxi.com/v1",
  llmModel: process.env.OPENAI_COMPATIBLE_MODEL || process.env.MINIMAX_MODEL || "MiniMax-M2.5",
  extractionConcurrency: Number(process.env.EXTRACTION_CONCURRENCY || 5),
  classifyConcurrency: Number(process.env.CLASSIFY_CONCURRENCY || 5),
};

function getSettingValue(key: ConfigKey) {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? null;
}

function getCompatibleSettingValue(primaryKey: ConfigKey, legacyKey?: ConfigKey) {
  return getSettingValue(primaryKey) ?? (legacyKey ? getSettingValue(legacyKey) : null);
}

export function getAppSettings(): AppSettings {
  return {
    llmApiKey:
      getCompatibleSettingValue("openai_compatible_api_key", "minimax_api_key") ??
      defaultSettings.llmApiKey,
    llmBaseUrl:
      getCompatibleSettingValue("openai_compatible_base_url", "minimax_base_url") ??
      defaultSettings.llmBaseUrl,
    llmModel:
      getCompatibleSettingValue("openai_compatible_model", "minimax_model") ??
      defaultSettings.llmModel,
    extractionConcurrency: Number(
      getSettingValue("extraction_concurrency") ?? String(defaultSettings.extractionConcurrency),
    ),
    classifyConcurrency: Number(
      getSettingValue("classify_concurrency") ?? String(defaultSettings.classifyConcurrency),
    ),
  };
}

export function saveAppSettings(input: AppSettings) {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const transaction = db.transaction(() => {
    upsert.run({
      key: "openai_compatible_api_key",
      value: input.llmApiKey.trim(),
      updatedAt: now,
    });
    upsert.run({
      key: "openai_compatible_base_url",
      value: input.llmBaseUrl.trim(),
      updatedAt: now,
    });
    upsert.run({
      key: "openai_compatible_model",
      value: input.llmModel.trim(),
      updatedAt: now,
    });
    upsert.run({ key: "minimax_api_key", value: input.llmApiKey.trim(), updatedAt: now });
    upsert.run({ key: "minimax_base_url", value: input.llmBaseUrl.trim(), updatedAt: now });
    upsert.run({ key: "minimax_model", value: input.llmModel.trim(), updatedAt: now });
    upsert.run({
      key: "extraction_concurrency",
      value: String(input.extractionConcurrency),
      updatedAt: now,
    });
    upsert.run({
      key: "classify_concurrency",
      value: String(input.classifyConcurrency),
      updatedAt: now,
    });
  });

  transaction();
}
