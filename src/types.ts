export interface CreateChatBody {
  userAId: string;
  userBId: string;
}
export interface CreateUserBody {
  displayName: string;
  email?: string | null;
}
export interface SendMessageBody {
  senderId: string;
  text: string;
}
export interface UserBody {
  userId: string;
}
export interface LastSeenBody extends UserBody {
  messageId: string;
}
export interface EditMessageBody {
  senderId: string;
  text: string;
}
export interface DeleteMessageBody {
  senderId: string;
}
export interface ChatMemberRow {
  user_id: string;
}
export interface MessageDocument {
  chatId: string;
  senderId: string;
  text: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
  readBy: string[];
  edited: boolean;
  deleted: boolean;
}
