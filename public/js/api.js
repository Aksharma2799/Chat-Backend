const API = {
  baseUrl: "",

  async request(url, options = {}) {
    const response = await fetch(`${this.baseUrl}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error("Server returned an invalid response");
    }

    if (!response.ok || result.success === false) {
      throw new Error(result.message || `Request failed: ${response.status}`);
    }

    return result;
  },

  getMessages(chatId) {
    return this.request(
      `/chat/${encodeURIComponent(chatId)}/messages?limit=50`,
    );
  },

  sendMessage(chatId, senderId, text) {
    return this.request(`/chat/${encodeURIComponent(chatId)}/message/send`, {
      method: "POST",
      body: JSON.stringify({ senderId, text }),
    });
  },

  getUserChats(userId) {
    return this.request(`/user/${encodeURIComponent(userId)}/chats`);
  },

  getUsers() {
    return this.request("/users");
  },

  createUser(displayName, email) {
    return this.request("/users", {
      method: "POST",
      body: JSON.stringify({ displayName, email }),
    });
  },

  createOrGetChat(userAId, userBId) {
    return this.request("/chat/create", {
      method: "POST",
      body: JSON.stringify({ userAId, userBId }),
    });
  },
};
