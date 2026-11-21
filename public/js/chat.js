(() => {
  const config = window.CHAT_CONFIG || {};

  const chatId = config.chatId;
  const userId = config.userId;
  const otherUserId = config.otherUserId;

  const messagesContainer = document.getElementById("messages");
  const messageForm = document.getElementById("message-form");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.getElementById("send-button");
  const toast = document.getElementById("toast");
  const chatList = document.getElementById("chat-list");
  const chatCount = document.getElementById("chat-count");
  const userSwitcher = document.getElementById("user-switcher");
  const newChatUser = document.getElementById("new-chat-user");
  const addUserForm = document.getElementById("add-user-form");

  let lastMessageId = null;
  let polling = false;
  let pollTimer = null;
  let users = [];

  const escapeHTML = (value) => {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[char],
    );
  };

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");

    setTimeout(() => toast.classList.add("hidden"), 2500);
  }

  function normalizeList(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.data?.messages)) {
      return result.data.messages;
    }
    if (Array.isArray(result?.messages)) return result.messages;
    return [];
  }

  function getUserName(user) {
    return user.displayName || user.display_name || user.email || "Unknown user";
  }

  function getUserLabel(user) {
    const name = getUserName(user);
    return user.email ? `${name} (${user.email})` : `${name} · ${user.id.slice(0, 8)}`;
  }

  function setCurrentUserDisplay(user) {
    const name = user ? getUserName(user) : "No account selected";
    document.getElementById("current-user-name").textContent = name;
    document.getElementById("current-user-avatar").textContent =
      name.charAt(0).toUpperCase();
  }

  function fillUserControls() {
    userSwitcher.replaceChildren();
    const accountPlaceholder = new Option(
      users.length ? "Select a demo account..." : "No users yet",
      "",
    );
    userSwitcher.add(accountPlaceholder);

    users.forEach((user) => {
      userSwitcher.add(new Option(getUserLabel(user), user.id));
    });
    userSwitcher.value = users.some((user) => user.id === userId) ? userId : "";

    newChatUser.replaceChildren();
    const otherUsers = users.filter((user) => user.id !== userId);
    newChatUser.add(
      new Option(
        otherUsers.length ? "Start a new chat..." : "Add another user first",
        "",
      ),
    );
    otherUsers.forEach((user) => {
      newChatUser.add(new Option(getUserLabel(user), user.id));
    });
    newChatUser.disabled = !userId || otherUsers.length === 0;
  }

  async function loadUsers() {
    try {
      users = normalizeList(await API.getUsers());
      fillUserControls();

      const currentUser = users.find((user) => user.id === userId);
      setCurrentUserDisplay(currentUser);

      const otherUser = users.find((user) => user.id === otherUserId);
      if (otherUser) {
        const name = getUserName(otherUser);
        document.getElementById("chat-user-name").textContent = name;
        document.getElementById("chat-user-avatar").textContent =
          name.charAt(0).toUpperCase();
      }
    } catch (error) {
      console.error("Loading users failed:", error);
      showToast(error.message);
      userSwitcher.replaceChildren(new Option("Unable to load users", ""));
      newChatUser.replaceChildren(new Option("Unable to load users", ""));
      newChatUser.disabled = true;
      setCurrentUserDisplay(null);
    }
  }

  function openChat(selectedChatId, selectedOtherUserId) {
    const currentUser = users.find((user) => user.id === userId);
    const otherUser = users.find((user) => user.id === selectedOtherUserId);
    const params = new URLSearchParams({
      chatId: selectedChatId,
      userId,
      otherUserId: selectedOtherUserId,
    });

    if (currentUser) params.set("currentUserName", getUserName(currentUser));
    if (otherUser) params.set("otherUserName", getUserName(otherUser));

    window.location.assign(`/chat-ui?${params.toString()}`);
  }

  function renderChats(chats) {
    chatList.replaceChildren();
    chatCount.textContent = `${chats.length} chat${chats.length === 1 ? "" : "s"}`;

    if (chats.length === 0) {
      const empty = document.createElement("p");
      empty.className = "p-4 text-sm text-slate-400";
      empty.textContent = userId
        ? "No conversations yet. Start one above."
        : "Select a demo account to see its conversations.";
      chatList.appendChild(empty);
      return;
    }

    chats.forEach((chat) => {
      const members = chat.memberIds || chat.member_ids || [];
      const otherId = members.find((memberId) => memberId !== userId);
      if (!otherId) return;

      const otherUser = users.find((user) => user.id === otherId);
      const name = otherUser ? getUserName(otherUser) : "Unknown user";
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "w-full rounded-xl px-4 py-3 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800";
      button.dataset.chatName = name.toLowerCase();

      const title = document.createElement("p");
      title.className = "truncate text-sm font-semibold";
      title.textContent = name;

      const subtitle = document.createElement("p");
      subtitle.className = "mt-1 truncate text-xs text-slate-400";
      subtitle.textContent = "Open conversation";

      button.append(title, subtitle);
      button.addEventListener("click", () => openChat(chat.chatId, otherId));
      chatList.appendChild(button);
    });
  }

  async function loadUserChats() {
    if (!userId) {
      renderChats([]);
      return;
    }

    try {
      const result = await API.getUserChats(userId);
      renderChats(normalizeList(result));
    } catch (error) {
      console.error("Loading conversations failed:", error);
      chatList.replaceChildren();
      chatCount.textContent = "Error";
      showToast(error.message);
    }
  }

  function initializeUserManagement() {
    userSwitcher.addEventListener("change", () => {
      if (userSwitcher.value) {
        window.location.assign(
          `/chat-ui?userId=${encodeURIComponent(userSwitcher.value)}`,
        );
      }
    });

    document.getElementById("new-chat-user").addEventListener("change", async () => {
      const otherId = newChatUser.value;
      if (!otherId) return;

      newChatUser.disabled = true;
      try {
        const result = await API.createOrGetChat(userId, otherId);
        openChat(result.data.chatId, otherId);
      } catch (error) {
        console.error("Creating conversation failed:", error);
        showToast(error.message);
      } finally {
        newChatUser.value = "";
        newChatUser.disabled = false;
      }
    });

    document.getElementById("add-user-toggle").addEventListener("click", () => {
      addUserForm.classList.toggle("hidden");
      if (!addUserForm.classList.contains("hidden")) {
        addUserForm.elements.namedItem("displayName").focus();
      }
    });

    addUserForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = document.getElementById("create-user-button");
      const formData = new FormData(addUserForm);
      const displayName = String(formData.get("displayName") || "").trim();
      const email = String(formData.get("email") || "").trim();
      submitButton.disabled = true;

      try {
        const result = await API.createUser(displayName, email || null);
        window.location.assign(
          `/chat-ui?userId=${encodeURIComponent(result.data.id)}`,
        );
      } catch (error) {
        console.error("Creating user failed:", error);
        showToast(error.message);
      } finally {
        submitButton.disabled = false;
      }
    });

    document.getElementById("chat-search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      chatList.querySelectorAll("button[data-chat-name]").forEach((button) => {
        button.classList.toggle(
          "hidden",
          !button.dataset.chatName.includes(query),
        );
      });
    });
  }

  function renderMessage(message) {
    const mine = message.senderId === userId;

    const wrapper = document.createElement("div");
    wrapper.className = `flex ${mine ? "justify-end" : "justify-start"}`;

    const bubble = document.createElement("div");
    bubble.className = mine
      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-3 text-white shadow-sm md:max-w-[70%]"
      : "max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-slate-800 shadow-sm md:max-w-[70%] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

    const text = document.createElement("p");
    text.className = "whitespace-pre-wrap break-words text-sm";
    text.textContent = message.deleted
      ? "This message was deleted"
      : message.text || "";

    const meta = document.createElement("div");
    meta.className = `mt-2 flex items-center justify-end gap-2 text-[10px] ${
      mine ? "text-indigo-100" : "text-slate-400"
    }`;

    const date = message.createdAt ? new Date(message.createdAt) : null;

    const time = document.createElement("span");
    time.textContent =
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

    meta.appendChild(time);

    if (mine) {
      const receipt = document.createElement("span");
      const readBy = message.readBy || [];

      receipt.textContent = readBy.includes(otherUserId) ? "✓✓ Read" : "✓ Sent";

      meta.appendChild(receipt);
    }

    bubble.append(text, meta);
    wrapper.appendChild(bubble);

    return wrapper;
  }

  async function loadMessages({ initial = false } = {}) {
    if (!chatId || polling) return;

    polling = true;

    try {
      const result = await API.getMessages(chatId);
      const messages = normalizeList(result);

      if (initial) {
        messagesContainer.innerHTML = "";
      }

      const newestId = messages.length
        ? messages[messages.length - 1].id ||
          messages[messages.length - 1].messageId
        : null;

      if (initial || newestId !== lastMessageId) {
        messagesContainer.innerHTML = "";

        if (messages.length === 0) {
          const empty = document.createElement("p");
          empty.className = "m-auto text-sm text-slate-400";
          empty.textContent = "No messages yet. Say hello!";
          messagesContainer.appendChild(empty);
        } else {
          messages.forEach((message) => {
            messagesContainer.appendChild(renderMessage(message));
          });
        }

        lastMessageId = newestId;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    } catch (error) {
      console.error("Loading messages failed:", error);
      if (initial) showToast(error.message);
    } finally {
      polling = false;
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    const text = messageInput.value.trim();

    if (!text || !chatId || !userId) return;

    sendButton.disabled = true;

    try {
      await API.sendMessage(chatId, userId, text);

      messageInput.value = "";
      messageInput.style.height = "auto";

      await loadMessages({ initial: true });
    } catch (error) {
      console.error("Sending message failed:", error);
      showToast(error.message);
    } finally {
      sendButton.disabled = false;
      messageInput.focus();
    }
  }

  function initializeTheme() {
    const toggle = document.getElementById("theme-toggle");
    const icon = document.getElementById("theme-icon");

    const savedTheme = localStorage.getItem("chat-theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;

    const dark = savedTheme ? savedTheme === "dark" : prefersDark;

    document.documentElement.classList.toggle("dark", dark);
    icon.textContent = dark ? "☀" : "☾";

    toggle.addEventListener("click", () => {
      const isDark = document.documentElement.classList.toggle("dark");

      localStorage.setItem("chat-theme", isDark ? "dark" : "light");

      icon.textContent = isDark ? "☀" : "☾";
    });
  }

  function initializeComposer() {
    messageForm.addEventListener("submit", sendMessage);

    messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        messageForm.requestSubmit();
      }
    });

    messageInput.addEventListener("input", () => {
      messageInput.style.height = "auto";
      messageInput.style.height = `${Math.min(messageInput.scrollHeight, 128)}px`;
    });
  }

  function initializeRefresh() {
    document.getElementById("refresh-chat").addEventListener("click", () => {
      loadMessages({ initial: true });
    });
  }

  function initializeMobileLayout() {
    const sidebar = document.getElementById("sidebar");
    const chatArea = document.getElementById("chat-area");
    const emptyState = document.getElementById("empty-state");
    const hasChatContext = Boolean(chatId && userId && otherUserId);
    const isMobile = window.innerWidth < 768;

    sidebar.classList.toggle("hidden", isMobile && hasChatContext);
    chatArea.classList.toggle("hidden", !hasChatContext);
    emptyState.classList.toggle("hidden", hasChatContext || isMobile);

    document.getElementById("back-to-chats").addEventListener("click", () => {
      chatArea.classList.add("hidden");
      sidebar.classList.remove("hidden");
    });
  }

  async function initialize() {
    initializeTheme();
    initializeComposer();
    initializeRefresh();
    initializeUserManagement();
    initializeMobileLayout();

    await loadUsers();
    await loadUserChats();

    if (!chatId || !userId || !otherUserId) return;

    await loadMessages({ initial: true });

    // Refresh messages every 3 seconds.
    pollTimer = setInterval(() => {
      loadMessages();
    }, 3000);
  }

  window.addEventListener("beforeunload", () => {
    if (pollTimer) clearInterval(pollTimer);
  });

  initialize();
})();
