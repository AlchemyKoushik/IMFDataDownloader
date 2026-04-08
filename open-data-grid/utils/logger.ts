type LogLevel = "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

const serialize = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
};

const writeLog = (level: LogLevel, message: string, meta?: LogMeta): void => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, serialize(value)])) } : {}),
  };

  if (level === "error") {
    console.error(JSON.stringify(entry));
    return;
  }

  if (level === "warn") {
    console.warn(JSON.stringify(entry));
    return;
  }

  console.info(JSON.stringify(entry));
};

export const logger = {
  info: (message: string, meta?: LogMeta): void => writeLog("info", message, meta),
  warn: (message: string, meta?: LogMeta): void => writeLog("warn", message, meta),
  error: (message: string, error?: unknown, meta?: LogMeta): void =>
    writeLog("error", message, {
      ...meta,
      ...(error !== undefined ? { error } : {}),
    }),
};
