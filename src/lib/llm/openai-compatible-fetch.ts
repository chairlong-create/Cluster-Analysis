type FetchWithBurstRateRetryOptions = RequestInit & {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: number[];
  rateLimitKey?: string;
  minIntervalMs?: number;
};

const nextAllowedRequestAtByKey = new Map<string, number>();

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function scheduleRateLimitedStart(
  key: string | undefined,
  minIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
) {
  if (!key || minIntervalMs <= 0) {
    return;
  }

  const now = Date.now();
  const nextAllowedAt = nextAllowedRequestAtByKey.get(key) ?? now;
  const scheduledAt = Math.max(now, nextAllowedAt);
  nextAllowedRequestAtByKey.set(key, scheduledAt + minIntervalMs);

  const waitMs = scheduledAt - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function isBurstRateResponse(response: Response) {
  if (response.ok) {
    return false;
  }

  const responseText = await response.clone().text();
  return (
    responseText.includes("limit_burst_rate") ||
    responseText.includes("Request rate increased too quickly")
  );
}

export async function fetchWithBurstRateRetry(
  input: string,
  {
    fetchImpl = fetch,
    sleep = defaultSleep,
    retryDelaysMs = [500, 1200],
    rateLimitKey,
    minIntervalMs = 0,
    ...init
  }: FetchWithBurstRateRetryOptions,
) {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    await scheduleRateLimitedStart(rateLimitKey, minIntervalMs, sleep);

    const response = await fetchImpl(input, init);
    if (!(await isBurstRateResponse(response)) || attempt === retryDelaysMs.length) {
      return response;
    }

    await sleep(retryDelaysMs[attempt] ?? 0);
  }

  throw new Error("unreachable");
}
