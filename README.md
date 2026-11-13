# Chat Backend

A REST API built with only the assignment's core technologies:

- Node.js
- TypeScript with strict mode
- PostgreSQL for users, chats and chat memberships
- Firebase Firestore for messages, read receipts and last-seen pointers

The HTTP server uses Node.js built-in `http` module. SQL is executed directly using the PostgreSQL driver (`pg`); no ORM or web framework is used.

## Prerequisites

- Node.js 20.6 or newer (for built-in `--env-file`)
- PostgreSQL 14 or newer
- A Firebase project with Firestore enabled
- Firebase service-account credentials

## Quick setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in database and Firebase credential paths.
3. Create the PostgreSQL database named `chat_backend`.
4. Run `psql "$DATABASE_URL" -f database/schema.sql` (or execute the SQL file in your PostgreSQL client).
5. Put the Firebase service account JSON at the path set in `.env`.
6. Build: `npm run build`
7. Start: `npm start`

Development mode: `npm run dev`.

Detailed instructions and API examples: [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md).

## Endpoints

| Method | Endpoint                                | Description                      |
| ------ | --------------------------------------- | -------------------------------- |
| POST   | `/chat/create`                          | Create or retrieve 1:1 chat      |
| POST   | `/chat/:chatId/message/send`            | Send message                     |
| GET    | `/chat/:chatId/messages?limit=50`       | Read messages in timestamp order |
| POST   | `/chat/:chatId/message/:messageId/read` | Mark message read                |
| POST   | `/chat/:chatId/lastseen`                | Update last-seen message         |
| GET    | `/user/:userId/chats`                   | List user's chats                |
| PATCH  | `/chat/:chatId/message/:messageId`      | Bonus: edit own message          |
| DELETE | `/chat/:chatId/message/:messageId`      | Bonus: soft-delete own message   |

## Firestore layout

```text
chats/{chatId}/messages/{messageId}
  chatId, senderId, text, createdAt, readBy, edited, deleted

chats/{chatId}/lastSeen/{userId}
  userId, messageId, createdAt, updatedAt
```

## Important security note

The task contract does not specify authentication. The APIs accept user IDs in request bodies, so membership and sender ownership are checked but the IDs are not authenticated identities. For production, verify Firebase Authentication ID tokens and derive the caller's user ID from the verified token. The Admin SDK bypasses Firestore client security rules; keep service-account credentials secret.
