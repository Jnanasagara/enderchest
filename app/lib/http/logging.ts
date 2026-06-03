type LogLevel = "info" | "warn" | "error";

type LogPayload = {
  level: LogLevel;
  message: string;
  requestId?: string;
  context?: Record<string, unknown>;
};

function emitLog(payload: LogPayload): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    ...payload,
  });

  if (payload.level === "error") {
    console.error(line);
    return;
  }

  if (payload.level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function logInfo(message: string, context?: Record<string, unknown>): void {
  emitLog({ level: "info", message, context });
}

export function logWarn(message: string, context?: Record<string, unknown>): void {
  emitLog({ level: "warn", message, context });
}

export function logError(
  message: string,
  context?: Record<string, unknown>
): void {
  emitLog({ level: "error", message, context });
}
