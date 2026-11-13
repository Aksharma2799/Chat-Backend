import { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./errors";

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new HttpError(413, "Request body too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

export function requireString(
  value: unknown,
  field: string,
  maxLength = 10000,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new HttpError(
      400,
      `${field} must be a non-empty string (max ${maxLength} characters)`,
    );
  }
  return value.trim();
}

export function requireUuid(value: unknown, field: string): string {
  const result = requireString(value, field, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  ) {
    throw new HttpError(400, `${field} must be a valid UUID`);
  }
  return result;
}

export function routeMatch(path: string, pattern: RegExp): RegExpMatchArray {
  const match = path.match(pattern);
  if (!match) throw new HttpError(404, "Route not found");
  return match;
}
