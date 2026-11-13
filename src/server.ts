import {
  createServer,
  IncomingMessage,
  ServerResponse
} from "node:http";

import { config, pool } from "./config";
import { HttpError } from "./errors";
import {
  readJson,
  requireString,
  requireUuid,
  sendJson
} from "./helpers";

import * as chatService from "./chat.service";

import {
  CreateChatBody,
  SendMessageBody,
  UserBody,
  LastSeenBody,
  EditMessageBody,
  DeleteMessageBody
} from "./types";

async function handle(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const method = req.method ?? "GET";
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    );
    const path = url.pathname;

    if (method === "GET" && path === "/") {
      sendJson(res, 200, {
        success: true,
        message: "Chat backend is running",
        health: "/health"
      });
      return;
    }

    if (method === "GET" && path === "/health") {
      sendJson(res, 200, { success: true, status: "ok" });
      return;
    }

    if (method === "POST" && path === "/chat/create") {
      const body = await readJson<CreateChatBody>(req);
      const data = await chatService.createOrGetChat(
        requireUuid(body.userAId, "userAId"),
        requireUuid(body.userBId, "userBId")
      );
      sendJson(res, 200, { success: true, data });
      return;
    }

    let match = path.match(/^\/chat\/([0-9a-f-]+)\/message\/send$/i);
    if (method === "POST" && match) {
      const body = await readJson<SendMessageBody>(req);
      const data = await chatService.sendMessage(
        requireUuid(match[1], "chatId"),
        requireUuid(body.senderId, "senderId"),
        requireString(body.text, "text")
      );
      sendJson(res, 201, { success: true, data });
      return;
    }

    match = path.match(/^\/chat\/([0-9a-f-]+)\/messages$/i);
    if (method === "GET" && match) {
      const chatId = requireUuid(match[1], "chatId");
      const rawLimit = url.searchParams.get("limit") ?? "50";
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new HttpError(400, "limit must be an integer between 1 and 100");
      }
      const before = url.searchParams.get("before") ?? undefined;
      const data = await chatService.getMessages(chatId, limit, before);
      sendJson(res, 200, {
        success: true,
        data,
        pagination: { limit, before: before ?? null }
      });
      return;
    }

    match = path.match(/^\/chat\/([0-9a-f-]+)\/message\/([^/]+)\/read$/i);
    if (method === "POST" && match) {
      const body = await readJson<UserBody>(req);
      const data = await chatService.markRead(
        requireUuid(match[1], "chatId"),
        requireString(match[2], "messageId"),
        requireUuid(body.userId, "userId")
      );
      sendJson(res, 200, { success: true, data });
      return;
    }

    match = path.match(/^\/chat\/([0-9a-f-]+)\/lastseen$/i);
    if (method === "POST" && match) {
      const body = await readJson<LastSeenBody>(req);
      const data = await chatService.updateLastSeen(
        requireUuid(match[1], "chatId"),
        requireUuid(body.userId, "userId"),
        requireString(body.messageId, "messageId")
      );
      sendJson(res, 200, { success: true, data });
      return;
    }

    match = path.match(/^\/user\/([0-9a-f-]+)\/chats$/i);
    if (method === "GET" && match) {
      const data = await chatService.listUserChats(
        requireUuid(match[1], "userId")
      );
      sendJson(res, 200, { success: true, data });
      return;
    }

    match = path.match(/^\/chat\/([0-9a-f-]+)\/message\/([^/]+)$/i);
    if (method === "PATCH" && match) {
      const body = await readJson<EditMessageBody>(req);
      const data = await chatService.editMessage(
        requireUuid(match[1], "chatId"),
        requireString(match[2], "messageId"),
        requireUuid(body.senderId, "senderId"),
        requireString(body.text, "text")
      );
      sendJson(res, 200, { success: true, data });
      return;
    }

    if (method === "DELETE" && match) {
      const body = await readJson<DeleteMessageBody>(req);
      const data = await chatService.deleteMessage(
        requireUuid(match[1], "chatId"),
        requireString(match[2], "messageId"),
        requireUuid(body.senderId, "senderId")
      );
      sendJson(res, 200, { success: true, data });
      return;
    }

    sendJson(res, 404, {
      success: false,
      message: "Route not found"
    });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        success: false,
        message: error.message
      });
      return;
    }

    console.error(error);
    sendJson(res, 500, {
      success: false,
      message: "Internal server error"
    });
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(config.port, () => {
  console.log(`Chat backend listening at http://localhost:${config.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
