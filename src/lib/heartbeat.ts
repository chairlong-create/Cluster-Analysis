type HeartbeatOptions<T> = {
  intervalMs?: number;
  beat: () => void | Promise<void>;
  run: () => Promise<T>;
};

export async function withHeartbeat<T>({
  intervalMs = 1000,
  beat,
  run,
}: HeartbeatOptions<T>): Promise<T> {
  await beat();

  const timer = setInterval(() => {
    void beat();
  }, intervalMs);

  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}
