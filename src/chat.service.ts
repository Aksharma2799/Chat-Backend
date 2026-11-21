import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore, pool } from "./config";
import { HttpError } from "./errors";
import { MessageDocument } from "./types";

const messagesRef = (chatId: string) =>
  firestore.collection("chats").doc(chatId).collection("messages");

export async function listUsers() {
  const result = await pool.query(
    `SELECT id, display_name AS "displayName", email
     FROM users
     ORDER BY display_name NULLS LAST, email NULLS LAST, id`
  );
  return result.rows;
}

export async function createUser(displayName: string, email: string | null) {
  const result = await pool.query(
    `INSERT INTO users (display_name, email)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, display_name AS "displayName", email`,
    [displayName, email]
  );
  if (result.rowCount === 0) {
    throw new HttpError(409, "A user with this email already exists");
  }
  return result.rows[0];
}

async function ensureMember(chatId: string, userId: string): Promise<void> {
  const result = await pool.query(
    "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",
    [chatId, userId]
  );
  if (result.rowCount === 0) throw new HttpError(403, "User is not a member of this chat");
}

async function ensureChat(chatId: string): Promise<void> {
  const result = await pool.query("SELECT id FROM chats WHERE id = $1", [chatId]);
  if (result.rowCount === 0) throw new HttpError(404, "Chat not found");
}

export async function createOrGetChat(userAId: string, userBId: string): Promise<{ chatId: string }> {
  if (userAId === userBId) throw new HttpError(400, "A chat requires two different users");

  const users = await pool.query(
    "SELECT id FROM users WHERE id = ANY($1::uuid[])",
    [[userAId, userBId]]
  );
  if (users.rowCount !== 2) throw new HttpError(404, "One or both users do not exist");

  const pairKey = [userAId, userBId].sort().join(":");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO chats (is_group, pair_key)
       VALUES (FALSE, $1)
       ON CONFLICT (pair_key) DO UPDATE SET pair_key = EXCLUDED.pair_key
       RETURNING id`,
      [pairKey]
    );
    const chatId = String(inserted.rows[0].id);
    await client.query(
      `INSERT INTO chat_members (chat_id, user_id)
       VALUES ($1, $2), ($1, $3)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [chatId, userAId, userBId]
    );
    await client.query("COMMIT");
    return { chatId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function sendMessage(chatId: string, senderId: string, text: string) {
  await ensureChat(chatId);
  await ensureMember(chatId, senderId);

  const ref = messagesRef(chatId).doc();
  const now = Timestamp.now();
  const message: MessageDocument = {
    chatId, senderId, text, createdAt: now, readBy: [senderId],
    edited: false, deleted: false
  };
  await ref.set(message);
  await pool.query("UPDATE chats SET updated_at = NOW() WHERE id = $1", [chatId]);
  return { messageId: ref.id, ...messageToJson(message, ref.id) };
}

function messageToJson(data: MessageDocument, id: string) {
  return {
    id,
    chatId: data.chatId,
    senderId: data.senderId,
    text: data.deleted ? "" : data.text,
    createdAt: data.createdAt.toDate().toISOString(),
    updatedAt: data.updatedAt?.toDate().toISOString() ?? null,
    readBy: data.readBy ?? [],
    edited: data.edited ?? false,
    deleted: data.deleted ?? false
  };
}

export async function getMessages(chatId: string, limit: number, before?: string) {
  await ensureChat(chatId);
  let query: FirebaseFirestore.Query = messagesRef(chatId).orderBy("createdAt", "desc").limit(limit);
  if (before) {
    const date = new Date(before);
    if (Number.isNaN(date.getTime())) throw new HttpError(400, "before must be a valid ISO date");
    query = query.where("createdAt", "<", Timestamp.fromDate(date));
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => messageToJson(doc.data() as MessageDocument, doc.id)).reverse();
}

export async function markRead(chatId: string, messageId: string, userId: string) {
  await ensureMember(chatId, userId);
  const ref = messagesRef(chatId).doc(messageId);
  await firestore.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    if (!doc.exists) throw new HttpError(404, "Message not found");
    transaction.update(ref, { readBy: FieldValue.arrayUnion(userId) });
  });
  return { chatId, messageId, userId, read: true };
}

export async function updateLastSeen(chatId: string, userId: string, messageId: string) {
  await ensureMember(chatId, userId);
  const messageRef = messagesRef(chatId).doc(messageId);
  const message = await messageRef.get();
  if (!message.exists) throw new HttpError(404, "Message not found");

  const lastSeenRef = firestore.collection("chats").doc(chatId).collection("lastSeen").doc(userId);
  const messageTime = (message.get("createdAt") as Timestamp).toMillis();
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(lastSeenRef);
    const currentTime = current.exists
      ? (current.get("createdAt") as Timestamp).toMillis()
      : -1;
    if (messageTime >= currentTime) {
      transaction.set(lastSeenRef, {
        userId, messageId, createdAt: message.get("createdAt"),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });
  return { chatId, userId, messageId, updated: true };
}

export async function listUserChats(userId: string) {
  const result = await pool.query(
    `SELECT c.id, c.is_group, c.created_at, c.updated_at,
       ARRAY(SELECT cm2.user_id FROM chat_members cm2 WHERE cm2.chat_id = c.id) AS member_ids
     FROM chats c
     INNER JOIN chat_members cm ON cm.chat_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.updated_at DESC`,
    [userId]
  );
  return result.rows.map((row: {
    id: string; is_group: boolean; created_at: Date; updated_at: Date; member_ids: string[];
  }) => ({
    chatId: row.id, isGroup: row.is_group, memberIds: row.member_ids,
    createdAt: row.created_at, updatedAt: row.updated_at
  }));
}

export async function editMessage(chatId: string, messageId: string, senderId: string, text: string) {
  await ensureMember(chatId, senderId);
  const ref = messagesRef(chatId).doc(messageId);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpError(404, "Message not found");
  if (doc.get("senderId") !== senderId) throw new HttpError(403, "Only the sender can edit this message");
  if (doc.get("deleted")) throw new HttpError(409, "Deleted messages cannot be edited");
  await ref.update({ text, edited: true, updatedAt: Timestamp.now() });
  const updated = await ref.get();
  return messageToJson(updated.data() as MessageDocument, updated.id);
}

export async function deleteMessage(chatId: string, messageId: string, senderId: string) {
  await ensureMember(chatId, senderId);
  const ref = messagesRef(chatId).doc(messageId);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpError(404, "Message not found");
  if (doc.get("senderId") !== senderId) throw new HttpError(403, "Only the sender can delete this message");
  await ref.update({ text: "", deleted: true, updatedAt: Timestamp.now() });
  return { chatId, messageId, deleted: true };
}
