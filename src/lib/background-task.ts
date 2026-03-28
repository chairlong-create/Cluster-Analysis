type ErrorReporter = (error: unknown) => void;

export function launchBackgroundTask(task: () => Promise<void>, onError?: ErrorReporter) {
  setTimeout(() => {
    void task().catch((error) => {
      if (onError) {
        onError(error);
        return;
      }

      console.error("background task failed", error);
    });
  }, 0);
}
