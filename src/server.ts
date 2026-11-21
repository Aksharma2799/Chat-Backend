
import * as ejs from "ejs";
import pathModule from "node:path";
import { readFile } from "node:fs/promises";

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
  CreateUserBody,
  SendMessageBody,
  UserBody,
  LastSeenBody,
  EditMessageBody,
  DeleteMessageBody
} from "./types";

// ==========================================
// REQUEST HANDLER
// ==========================================

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

    // ==========================================
    // FRONTEND: STATIC FILES
    // ==========================================

    const staticFiles: Record<string, string> = {
      "/css/output.css": "public/css/output.css",
      "/js/api.js": "public/js/api.js",
      "/js/chat.js": "public/js/chat.js"
    };

    if (method === "GET" && staticFiles[path]) {
      try {
        const filePath = pathModule.resolve(
          process.cwd(),
          staticFiles[path]
        );

        const fileContent = await readFile(filePath);

        const contentType = path.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "application/javascript; charset=utf-8";

        res.writeHead(200, {
          "Content-Type": contentType
        });

        res.end(fileContent);

      } catch (error) {
        console.error("Static file error:", error);

        sendJson(res, 404, {
          success: false,
          message: "Static file not found"
        });
      }

      return;
    }

    // ==========================================
    // FRONTEND: EJS CHAT PAGE
    // ==========================================

    if (method === "GET" && path === "/chat-ui") {

      try {
        const chatId = url.searchParams.get("chatId");
        const userId = url.searchParams.get("userId");
        const otherUserId = url.searchParams.get("otherUserId");

        const currentUserName =
          url.searchParams.get("currentUserName") || "";

        const otherUserName =
          url.searchParams.get("otherUserName") || "";

        const validChatId = chatId ? requireUuid(chatId, "chatId") : null;
        const validUserId = userId ? requireUuid(userId, "userId") : null;
        const validOtherUserId = otherUserId
          ? requireUuid(otherUserId, "otherUserId")
          : null;

        const html = await ejs.renderFile(
          pathModule.resolve(
            process.cwd(),
            "views/chat.ejs"
          ),
          {
            chatId: validChatId,
            userId: validUserId,
            otherUserId: validOtherUserId,
            currentUserName,
            otherUserName
          }
        );

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8"
        });

        res.end(html);

      } catch (error) {
        console.error("EJS rendering error:", error);

        if (error instanceof HttpError) {
          sendJson(res, error.status, {
            success: false,
            message: error.message
          });

          return;
        }

        sendJson(res, 500, {
          success: false,
          message: "Unable to render chat page"
        });
      }

      return;
    }

    // ==========================================
    // HEALTH CHECK
    // ==========================================

    if (method === "GET" && path === "/") {
      sendJson(res, 200, {
        success: true,
        message: "Chat backend is running",
        health: "/health",
        frontend: "/chat-ui"
      });

      return;
    }

    if (method === "GET" && path === "/health") {
      sendJson(res, 200, {
        success: true,
        status: "ok"
      });

      return;
    }

    // ==========================================
    // USERS
    // ==========================================

    if (method === "GET" && path === "/users") {
      const data = await chatService.listUsers();

      sendJson(res, 200, {
        success: true,
        data
      });

      return;
    }

    if (method === "POST" && path === "/users") {
      const body = await readJson<CreateUserBody>(req);
      const displayName = requireString(body.displayName, "displayName", 120);
      const email = body.email
        ? requireString(body.email, "email", 255)
        : null;
      const data = await chatService.createUser(displayName, email);

      sendJson(res, 201, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // CREATE OR GET CHAT
    // POST /chat/create
    // ==========================================

    if (method === "POST" && path === "/chat/create") {

      const body = await readJson<CreateChatBody>(req);

      const data = await chatService.createOrGetChat(
        requireUuid(body.userAId, "userAId"),
        requireUuid(body.userBId, "userBId")
      );

      sendJson(res, 200, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // SEND MESSAGE
    // POST /chat/:chatId/message/send
    // ==========================================

    let match = path.match(
      /^\/chat\/([0-9a-f-]+)\/message\/send$/i
    );

    if (method === "POST" && match) {

      const body = await readJson<SendMessageBody>(req);

      const data = await chatService.sendMessage(
        requireUuid(match[1], "chatId"),
        requireUuid(body.senderId, "senderId"),
        requireString(body.text, "text")
      );

      sendJson(res, 201, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // GET CHAT MESSAGES
    // GET /chat/:chatId/messages
    // ==========================================

    match = path.match(
      /^\/chat\/([0-9a-f-]+)\/messages$/i
    );

    if (method === "GET" && match) {

      const chatId = requireUuid(match[1], "chatId");

      const rawLimit =
        url.searchParams.get("limit") ?? "50";

      const limit = Number(rawLimit);

      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new HttpError(
          400,
          "limit must be an integer between 1 and 100"
        );
      }

      const before =
        url.searchParams.get("before") ?? undefined;

      const data = await chatService.getMessages(
        chatId,
        limit,
        before
      );

      sendJson(res, 200, {
        success: true,
        data,
        pagination: {
          limit,
          before: before ?? null
        }
      });

      return;
    }

    // ==========================================
    // MARK MESSAGE AS READ
    // POST /chat/:chatId/message/:messageId/read
    // ==========================================

    match = path.match(
      /^\/chat\/([0-9a-f-]+)\/message\/([^/]+)\/read$/i
    );

    if (method === "POST" && match) {

      const body = await readJson<UserBody>(req);

      const data = await chatService.markRead(
        requireUuid(match[1], "chatId"),
        requireString(match[2], "messageId"),
        requireUuid(body.userId, "userId")
      );

      sendJson(res, 200, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // UPDATE LAST SEEN
    // POST /chat/:chatId/lastseen
    // ==========================================

    match = path.match(
      /^\/chat\/([0-9a-f-]+)\/lastseen$/i
    );

    if (method === "POST" && match) {

      const body = await readJson<LastSeenBody>(req);

      const data = await chatService.updateLastSeen(
        requireUuid(match[1], "chatId"),
        requireUuid(body.userId, "userId"),
        requireString(body.messageId, "messageId")
      );

      sendJson(res, 200, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // GET USER CHATS
    // GET /user/:userId/chats
    // ==========================================

    match = path.match(
      /^\/user\/([0-9a-f-]+)\/chats$/i
    );

    if (method === "GET" && match) {

      const data = await chatService.listUserChats(
        requireUuid(match[1], "userId")
      );

      sendJson(res, 200, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // EDIT MESSAGE
    // PATCH /chat/:chatId/message/:messageId
    // ==========================================

    match = path.match(
      /^\/chat\/([0-9a-f-]+)\/message\/([^/]+)$/i
    );

    if (method === "PATCH" && match) {

      const body = await readJson<EditMessageBody>(req);

      const data = await chatService.editMessage(
        requireUuid(match[1], "chatId"),
        requireString(match[2], "messageId"),
        requireUuid(body.senderId, "senderId"),
        requireString(body.text, "text")
      );

      sendJson(res, 200, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // DELETE MESSAGE
    // DELETE /chat/:chatId/message/:messageId
    // ==========================================

    if (method === "DELETE" && match) {

      const body = await readJson<DeleteMessageBody>(req);

      const data = await chatService.deleteMessage(
        requireUuid(match[1], "chatId"),
        requireString(match[2], "messageId"),
        requireUuid(body.senderId, "senderId")
      );

      sendJson(res, 200, {
        success: true,
        data
      });

      return;
    }

    // ==========================================
    // ROUTE NOT FOUND
    // ==========================================

    sendJson(res, 404, {
      success: false,
      message: "Route not found"
    });

  } catch (error) {

    // ==========================================
    // ERROR HANDLING
    // ==========================================

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

// ==========================================
// CREATE HTTP SERVER
// ==========================================

const server = createServer((req, res) => {
  void handle(req, res);
});

// ==========================================
// START SERVER
// ==========================================

server.listen(config.port, () => {
  console.log(
    `Chat backend listening at http://localhost:${config.port}`
  );

  console.log(
    `Chat UI available at http://localhost:${config.port}/chat-ui`
  );
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

async function shutdown(): Promise<void> {

  server.close();

  await pool.end();

  process.exit(0);
}

process.on("SIGINT", () => void shutdown());

process.on("SIGTERM", () => void shutdown());
