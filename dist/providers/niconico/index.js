var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/providers/niconico/NiconicoProvider.ts
import { EventEmitter as EventEmitter5 } from "events";

// src/providers/niconico/WebSocketClient.ts
import { EventEmitter } from "events";
import WebSocket from "ws";
var WebSocketClient = class extends EventEmitter {
  constructor(webSocketUrl) {
    super();
    this.webSocketUrl = webSocketUrl;
    __publicField(this, "ws", null);
    __publicField(this, "keepSeatInterval", null);
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.webSocketUrl);
      this.ws.on("open", () => {
        this.sendStartWatching();
        this.emit("open");
        resolve();
      });
      this.ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch {
        }
      });
      this.ws.on("error", (error) => {
        this.emit("error", error);
        reject(error);
      });
      this.ws.on("close", () => {
        this.stopKeepSeat();
        this.emit("close");
      });
    });
  }
  disconnect() {
    this.stopKeepSeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  sendStartWatching() {
    this.ws?.send(
      JSON.stringify({
        type: "startWatching",
        data: {
          stream: {
            quality: "abr",
            protocol: "hls",
            latency: "low",
            chasePlay: false
          },
          room: {
            protocol: "webSocket",
            commentable: false
          },
          reconnect: false
        }
      })
    );
  }
  handleMessage(message) {
    switch (message.type) {
      case "messageServer":
        if (message.data?.viewUri) {
          this.emit("messageServer", message.data.viewUri);
        }
        break;
      case "seat":
        this.startKeepSeat(message.data?.keepIntervalSec ?? 30);
        break;
      case "ping":
        this.ws?.send(JSON.stringify({ type: "pong" }));
        break;
      case "disconnect":
        this.emit("disconnect", message.data?.reason ?? "unknown");
        break;
      case "error":
        this.emit("error", new Error(message.data?.message ?? "WebSocket error"));
        break;
    }
  }
  startKeepSeat(intervalSec) {
    this.stopKeepSeat();
    const clamped = Math.max(10, Math.min(300, Number(intervalSec) || 30));
    this.keepSeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ type: "keepSeat" }));
    }, clamped * 1e3);
  }
  stopKeepSeat() {
    if (this.keepSeatInterval) {
      clearInterval(this.keepSeatInterval);
      this.keepSeatInterval = null;
    }
  }
};

// src/providers/niconico/MessageStream.ts
import { EventEmitter as EventEmitter2 } from "events";

// src/providers/niconico/ProtobufParser.ts
import protobuf from "protobufjs/minimal.js";
import proto from "@n-air-app/nicolive-comment-protobuf";
var { Reader } = protobuf;
var { ChunkedEntry, ChunkedMessage, PackedSegment } = proto.dwango.nicolive.chat.service.edge;
var { SimpleNotificationV2 } = proto.dwango.nicolive.chat.data.atoms;
var NotificationType = SimpleNotificationV2.NotificationType;
var MAX_MESSAGE_SIZE = 16 * 1024 * 1024;
var NOTIFICATION_TYPE_MAP = Object.fromEntries(
  Object.entries(NotificationType).filter(([, v]) => typeof v === "number" && v !== NotificationType.EMOTION).map(([k, v]) => [v, k.toLowerCase()])
);
function readLengthDelimitedMessage(buffer) {
  if (buffer.length === 0) return null;
  try {
    const reader = new Reader(buffer);
    const messageLength = reader.uint32();
    const headerSize = reader.pos;
    if (messageLength > MAX_MESSAGE_SIZE) {
      throw new Error(`Message size ${messageLength} exceeds limit ${MAX_MESSAGE_SIZE}`);
    }
    if (buffer.length < headerSize + messageLength) return null;
    const message = buffer.slice(headerSize, headerSize + messageLength);
    return { message, bytesRead: headerSize + messageLength };
  } catch {
    return null;
  }
}
function extractMessages(buffer) {
  const messages = [];
  let offset = 0;
  while (offset < buffer.length) {
    const result = readLengthDelimitedMessage(buffer.slice(offset));
    if (!result) break;
    messages.push(result.message);
    offset += result.bytesRead;
  }
  return { messages, remaining: buffer.slice(offset) };
}
function parseChunkedEntry(data) {
  const entry = ChunkedEntry.decode(data);
  const result = {};
  const seg = entry.segment ?? entry.previous;
  if (seg?.uri) result.segmentUri = seg.uri;
  if (entry.backward?.segment?.uri) {
    result.backward = { segmentUri: entry.backward.segment.uri };
  }
  if (entry.next?.at != null) {
    result.nextAt = String(Number(entry.next.at));
  }
  return result;
}
function parseChunkedMessage(data) {
  return convertChunkedMessage(ChunkedMessage.decode(data));
}
function convertChunkedMessage(msg) {
  const result = {
    chats: [],
    gifts: [],
    emotions: [],
    notifications: []
  };
  const payload = msg.payload;
  if (payload === "message" && msg.message) {
    processNicoliveMessage(msg.message, result);
  } else if (payload === "state" && msg.state) {
    const op = msg.state.marquee?.display?.operatorComment;
    if (op) result.operatorComment = op;
  } else if (payload === "signal" && msg.signal === ChunkedMessage.Signal.Flushed) {
    result.signal = "flushed";
  }
  return result;
}
function processNicoliveMessage(nicoliveMsg, result) {
  const data = nicoliveMsg.data;
  if (data === "chat" && nicoliveMsg.chat) {
    result.chats.push(nicoliveMsg.chat);
  } else if (data === "overflowedChat" && nicoliveMsg.overflowedChat) {
    result.chats.push(nicoliveMsg.overflowedChat);
  } else if (data === "simpleNotification" && nicoliveMsg.simpleNotification) {
    if (nicoliveMsg.simpleNotification.emotion) {
      result.emotions.push({ content: nicoliveMsg.simpleNotification.emotion });
    }
  } else if (data === "gift" && nicoliveMsg.gift) {
    result.gifts.push(nicoliveMsg.gift);
  } else if (data === "simpleNotificationV2" && nicoliveMsg.simpleNotificationV2) {
    const notif = nicoliveMsg.simpleNotificationV2;
    const type = notif.type ?? 0;
    if (type === NotificationType.EMOTION) {
      result.emotions.push({ content: notif.message ?? "" });
    } else {
      const typeName = NOTIFICATION_TYPE_MAP[type] ?? "unknown";
      result.notifications.push({ type: typeName, message: notif.message ?? "" });
    }
  }
}
function parsePackedSegment(data) {
  const packed = PackedSegment.decode(data);
  const result = { messages: [] };
  if (packed.messages) {
    for (const msg of packed.messages) {
      result.messages.push(convertChunkedMessage(msg));
    }
  }
  if (packed.next?.uri) {
    result.nextUri = packed.next.uri;
  }
  return result;
}

// src/providers/niconico/MessageStream.ts
var MAX_BUFFER_SIZE = 16 * 1024 * 1024;
var CONNECT_TIMEOUT_MS = 3e4;
var INACTIVITY_TIMEOUT_MS = 6e4;
var MessageStream = class extends EventEmitter2 {
  constructor(viewUri, cookies) {
    super();
    this.viewUri = viewUri;
    this.cookies = cookies;
    __publicField(this, "buffer", new Uint8Array(0));
    __publicField(this, "controller", null);
  }
  /** ストリーミング開始（at パラメータ指定） */
  async start(at = "now") {
    const separator = this.viewUri.includes("?") ? "&" : "?";
    const uri = `${this.viewUri}${separator}at=${at}`;
    this.controller = new AbortController();
    const connectTimer = setTimeout(() => {
      this.controller?.abort();
    }, CONNECT_TIMEOUT_MS);
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Priority: "u=1, i"
      };
      if (this.cookies) headers["Cookie"] = this.cookies;
      const response = await fetch(uri, {
        headers,
        signal: this.controller.signal
      });
      clearTimeout(connectTimer);
      if (!response.ok || !response.body) {
        throw new Error(`Message server returned ${response.status}`);
      }
      const reader = response.body.getReader();
      await this.readStream(reader);
    } catch (error) {
      clearTimeout(connectTimer);
      if (error.name !== "AbortError") {
        this.emit("error", error);
      }
    }
  }
  stop() {
    this.controller?.abort();
    this.controller = null;
    this.buffer = new Uint8Array(0);
  }
  async readStream(reader) {
    let inactivityTimer = null;
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        this.stop();
        this.emit("error", new Error("Stream inactivity timeout"));
      }, INACTIVITY_TIMEOUT_MS);
    };
    try {
      resetInactivityTimer();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetInactivityTimer();
        this.handleData(value);
      }
      this.emit("end");
    } catch (error) {
      if (error.name !== "AbortError") {
        this.emit("error", error);
      }
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  }
  /** @internal テスト用に公開 */
  handleData(chunk) {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);
    const { messages, remaining } = extractMessages(combined);
    this.buffer = new Uint8Array(remaining);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = new Uint8Array(0);
      this.emit("error", new Error(`Buffer size exceeded limit (${MAX_BUFFER_SIZE} bytes)`));
      this.stop();
      return;
    }
    let nextAt;
    for (const msg of messages) {
      try {
        const entry = parseChunkedEntry(msg);
        if (entry.segmentUri) {
          this.emit("segment", entry.segmentUri);
        }
        if (entry.backward?.segmentUri) {
          this.emit("backward", entry.backward.segmentUri);
        }
        if (entry.nextAt) {
          nextAt = entry.nextAt;
        }
      } catch {
      }
    }
    if (nextAt) {
      this.emit("next", nextAt);
    }
  }
};

// src/providers/niconico/SegmentStream.ts
import { EventEmitter as EventEmitter3 } from "events";
var MAX_BUFFER_SIZE2 = 16 * 1024 * 1024;
var CONNECT_TIMEOUT_MS2 = 3e4;
var INACTIVITY_TIMEOUT_MS2 = 6e4;
var SegmentStream = class extends EventEmitter3 {
  constructor(segmentUri, cookies) {
    super();
    this.segmentUri = segmentUri;
    this.cookies = cookies;
    __publicField(this, "buffer", new Uint8Array(0));
    __publicField(this, "controller", null);
  }
  async start() {
    this.controller = new AbortController();
    const connectTimer = setTimeout(() => {
      this.controller?.abort();
    }, CONNECT_TIMEOUT_MS2);
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      };
      if (this.cookies) headers["Cookie"] = this.cookies;
      const response = await fetch(this.segmentUri, {
        headers,
        signal: this.controller.signal
      });
      clearTimeout(connectTimer);
      if (!response.ok || !response.body) {
        throw new Error(`Segment server returned ${response.status}`);
      }
      const reader = response.body.getReader();
      await this.readStream(reader);
    } catch (error) {
      clearTimeout(connectTimer);
      if (error.name !== "AbortError") {
        this.emit("error", error);
      }
    }
  }
  stop() {
    this.controller?.abort();
    this.controller = null;
    this.buffer = new Uint8Array(0);
  }
  async readStream(reader) {
    let inactivityTimer = null;
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        this.stop();
        this.emit("error", new Error("Stream inactivity timeout"));
      }, INACTIVITY_TIMEOUT_MS2);
    };
    try {
      resetInactivityTimer();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetInactivityTimer();
        this.handleData(value);
      }
      this.emit("end");
    } catch (error) {
      if (error.name !== "AbortError") {
        this.emit("error", error);
      }
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  }
  /** @internal テスト用に公開 */
  handleData(chunk) {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);
    const { messages, remaining } = extractMessages(combined);
    this.buffer = new Uint8Array(remaining);
    if (this.buffer.length > MAX_BUFFER_SIZE2) {
      this.buffer = new Uint8Array(0);
      this.emit("error", new Error(`Buffer size exceeded limit (${MAX_BUFFER_SIZE2} bytes)`));
      this.stop();
      return;
    }
    for (const msg of messages) {
      try {
        const result = parseChunkedMessage(msg);
        for (const chat of result.chats) {
          this.emit("chat", chat);
        }
        for (const gift of result.gifts) {
          this.emit("gift", gift);
        }
        for (const emotion of result.emotions) {
          this.emit("emotion", emotion);
        }
        for (const notification of result.notifications) {
          this.emit("notification", notification);
        }
        if (result.operatorComment) {
          this.emit("operatorComment", result.operatorComment);
        }
      } catch {
      }
    }
  }
};

// src/providers/niconico/BackwardStream.ts
import { EventEmitter as EventEmitter4 } from "events";
var MAX_CHAIN_DEPTH = 50;
var FETCH_DELAY_MS = 100;
var MAX_RESPONSE_SIZE = 16 * 1024 * 1024;
var CONNECT_TIMEOUT_MS3 = 3e4;
var BackwardStream = class extends EventEmitter4 {
  constructor(initialUri, cookies) {
    super();
    this.initialUri = initialUri;
    this.cookies = cookies;
    __publicField(this, "stopped", false);
  }
  async start() {
    const segments = [];
    let uri = this.initialUri;
    let depth = 0;
    while (uri && !this.stopped && depth < MAX_CHAIN_DEPTH) {
      try {
        const data = await this.fetchSegment(uri);
        const packed = parsePackedSegment(data);
        segments.push(packed.messages);
        uri = packed.nextUri;
        depth++;
        if (uri && !this.stopped) {
          await delay(FETCH_DELAY_MS);
        }
      } catch (error) {
        if (!this.stopped) {
          this.emit("error", error);
        }
        break;
      }
    }
    if (this.stopped) return;
    for (let i = segments.length - 1; i >= 0; i--) {
      for (const msg of segments[i]) {
        if (this.stopped) return;
        for (const chat of msg.chats) {
          this.emit("chat", chat);
        }
        for (const gift of msg.gifts) {
          this.emit("gift", gift);
        }
        for (const emotion of msg.emotions) {
          this.emit("emotion", emotion);
        }
        for (const notification of msg.notifications) {
          this.emit("notification", notification);
        }
        if (msg.operatorComment) {
          this.emit("operatorComment", msg.operatorComment);
        }
      }
    }
    if (!this.stopped) {
      this.emit("end");
    }
  }
  stop() {
    this.stopped = true;
  }
  async fetchSegment(uri) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS3);
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      };
      if (this.cookies) headers["Cookie"] = this.cookies;
      const response = await fetch(uri, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`Backward segment server returned ${response.status}`);
      }
      const buf = await response.arrayBuffer();
      if (buf.byteLength > MAX_RESPONSE_SIZE) {
        throw new Error(`Response size ${buf.byteLength} exceeds limit ${MAX_RESPONSE_SIZE}`);
      }
      return new Uint8Array(buf);
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }
};
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/providers/niconico/NiconicoProvider.ts
var NiconicoProvider = class extends EventEmitter5 {
  constructor(options) {
    super();
    __publicField(this, "liveId");
    __publicField(this, "cookies");
    __publicField(this, "maxRetries");
    __publicField(this, "retryIntervalMs");
    __publicField(this, "fetchBacklog");
    __publicField(this, "backlogEvents");
    __publicField(this, "wsClient", null);
    __publicField(this, "messageStream", null);
    __publicField(this, "segmentStreams", []);
    __publicField(this, "fetchedSegments", /* @__PURE__ */ new Set());
    __publicField(this, "backwardStream", null);
    __publicField(this, "backlogFetched", false);
    __publicField(this, "seenChatNos", /* @__PURE__ */ new Set());
    __publicField(this, "state", "disconnected");
    __publicField(this, "intentionalDisconnect", false);
    __publicField(this, "_metadata", null);
    __publicField(this, "reconnectCount", 0);
    __publicField(this, "reconnectTimer", null);
    this.liveId = options.liveId;
    this.cookies = options.cookies;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryIntervalMs = options.retryIntervalMs ?? 5e3;
    this.fetchBacklog = options.fetchBacklog ?? true;
    this.backlogEvents = new Set(options.backlogEvents ?? ["chat"]);
  }
  get metadata() {
    return this._metadata;
  }
  async connect() {
    this.intentionalDisconnect = false;
    this.setState("connecting");
    try {
      const { wsUrl, metadata } = await this.fetchWebSocketUrl();
      await this.connectWebSocket(wsUrl);
      this.reconnectCount = 0;
      this._metadata = metadata;
      this.setState("connected");
      this.emit("metadata", metadata);
      return metadata;
    } catch (error) {
      this.setState("error");
      throw error;
    }
  }
  async connectWebSocket(webSocketUrl) {
    this.wsClient = new WebSocketClient(webSocketUrl);
    this.wsClient.on("messageServer", (viewUri) => {
      this.startMessageStream(viewUri);
    });
    this.wsClient.on("disconnect", (reason) => {
      this.emit("error", new Error(`Disconnected: ${reason}`));
      this.setState("disconnected");
    });
    this.wsClient.on("error", (error) => {
      this.emit("error", error);
    });
    this.wsClient.on("close", () => {
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }
    });
    await this.wsClient.connect();
  }
  disconnect() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.wsClient?.disconnect();
    this.messageStream?.stop();
    for (const s of this.segmentStreams) s.stop();
    this.segmentStreams = [];
    this.fetchedSegments.clear();
    this.backwardStream?.stop();
    this.backwardStream = null;
    this.backlogFetched = false;
    this.seenChatNos.clear();
    this.wsClient = null;
    this.messageStream = null;
    this.setState("disconnected");
  }
  setState(state) {
    if (this.state !== state) {
      this.state = state;
      this.emit("stateChange", state);
    }
  }
  scheduleReconnect() {
    if (this.reconnectCount >= this.maxRetries) {
      this.emit("error", new Error(`Reconnection failed after ${this.maxRetries} attempts`));
      this.setState("disconnected");
      return;
    }
    this.reconnectCount++;
    this.setState("connecting");
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const { wsUrl, metadata } = await this.fetchWebSocketUrl();
        await this.connectWebSocket(wsUrl);
        this.reconnectCount = 0;
        this._metadata = metadata;
        this.setState("connected");
        this.emit("metadata", metadata);
      } catch {
        this.scheduleReconnect();
      }
    }, this.retryIntervalMs);
  }
  /** 放送ページのHTMLからWebSocket URLと放送者情報を取得する */
  async fetchWebSocketUrl() {
    const url = `https://live.nicovideo.jp/watch/${this.liveId}`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
    };
    if (this.cookies) headers["Cookie"] = this.cookies;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(3e4) });
    if (!response.ok) {
      throw new Error(`Failed to fetch broadcast page: ${response.status}`);
    }
    const html = await response.text();
    const match = html.match(/id="embedded-data"\s+data-props="([^"]+)"/);
    if (!match) {
      throw new Error("Could not find embedded data in the page");
    }
    const propsJson = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const props = JSON.parse(propsJson);
    const wsUrl = props.site?.relive?.webSocketUrl;
    if (!wsUrl) {
      throw new Error("WebSocket URL not found in broadcast data");
    }
    const program = props.program;
    const supplier = program?.supplier;
    const socialGroup = props.socialGroup;
    const stats = program?.statistics;
    const metadata = {
      title: program?.title ?? void 0,
      status: program?.status ?? void 0,
      description: program?.description ?? void 0,
      beginTime: program?.beginTime != null ? new Date(program.beginTime * 1e3) : void 0,
      endTime: program?.endTime != null ? new Date(program.endTime * 1e3) : void 0,
      thumbnailUrl: program?.screenshot?.urlSet?.large ?? program?.screenshot?.urlSet?.middle ?? program?.thumbnail?.small ?? void 0,
      tags: Array.isArray(program?.tag?.list) ? program.tag.list.map((t) => t.text) : void 0,
      watchCount: stats?.watchCount ?? void 0,
      commentCount: stats?.commentCount ?? void 0,
      broadcasterName: supplier?.name ?? void 0,
      broadcasterUserId: supplier?.programProviderId ?? void 0,
      broadcasterType: supplier?.supplierType ?? void 0,
      broadcasterIconUrl: supplier?.icons?.uri150x150 ?? supplier?.icons?.uri50x50 ?? void 0,
      socialGroupId: socialGroup?.id ?? void 0,
      socialGroupName: socialGroup?.name ?? void 0,
      socialGroupType: socialGroup?.type ?? void 0
    };
    return { wsUrl, metadata };
  }
  startMessageStream(viewUri) {
    this.replaceMessageStream(viewUri, "now");
  }
  replaceMessageStream(viewUri, at) {
    if (this.messageStream) {
      this.messageStream.removeAllListeners();
      this.messageStream.stop();
    }
    this.messageStream = new MessageStream(viewUri, this.cookies);
    this.messageStream.on("segment", (segmentUri) => {
      this.startSegmentStream(segmentUri);
    });
    this.messageStream.on("backward", (backwardUri) => {
      if (this.fetchBacklog) {
        this.startBackwardStream(backwardUri);
      }
    });
    this.messageStream.on("next", (nextAt) => {
      this.replaceMessageStream(viewUri, nextAt);
    });
    this.messageStream.on("error", (error) => {
      this.emit("error", error);
    });
    this.messageStream.on("end", () => {
      this.replaceMessageStream(viewUri, "now");
    });
    this.messageStream.start(at).catch((err) => this.emit("error", err));
  }
  startSegmentStream(segmentUri) {
    if (this.fetchedSegments.has(segmentUri)) return;
    this.fetchedSegments.add(segmentUri);
    const segment = new SegmentStream(segmentUri, this.cookies);
    segment.on("chat", (chat) => {
      if (this.isDuplicateChat(chat)) return;
      this.emit("comment", this.mapChat(chat));
    });
    segment.on("gift", (nicoGift) => {
      this.emit("gift", this.mapGift(nicoGift));
    });
    segment.on("emotion", (nicoEmotion) => {
      this.emit("emotion", this.mapEmotion(nicoEmotion));
    });
    segment.on("notification", (nicoNotif) => {
      this.emit("notification", this.mapNotification(nicoNotif));
    });
    segment.on("operatorComment", (nicoOp) => {
      this.emit("operatorComment", this.mapOperatorComment(nicoOp));
    });
    segment.on("error", (error) => {
      this.emit("error", error);
    });
    segment.on("end", () => {
      const idx = this.segmentStreams.indexOf(segment);
      if (idx >= 0) this.segmentStreams.splice(idx, 1);
    });
    this.segmentStreams.push(segment);
    segment.start().catch((err) => this.emit("error", err));
  }
  startBackwardStream(backwardUri) {
    if (this.backlogFetched) return;
    if (this.backwardStream) return;
    this.backlogFetched = true;
    const backward = new BackwardStream(backwardUri, this.cookies);
    this.backwardStream = backward;
    if (this.backlogEvents.has("chat")) {
      backward.on("chat", (chat) => {
        if (this.isDuplicateChat(chat)) return;
        this.emit("comment", this.mapChat(chat, true));
      });
    }
    if (this.backlogEvents.has("gift")) {
      backward.on("gift", (nicoGift) => {
        this.emit("gift", this.mapGift(nicoGift, true));
      });
    }
    if (this.backlogEvents.has("emotion")) {
      backward.on("emotion", (nicoEmotion) => {
        this.emit("emotion", this.mapEmotion(nicoEmotion, true));
      });
    }
    if (this.backlogEvents.has("notification")) {
      backward.on("notification", (nicoNotif) => {
        this.emit("notification", this.mapNotification(nicoNotif, true));
      });
    }
    if (this.backlogEvents.has("operatorComment")) {
      backward.on("operatorComment", (nicoOp) => {
        this.emit("operatorComment", this.mapOperatorComment(nicoOp, true));
      });
    }
    backward.on("error", (error) => {
      this.emit("error", error);
    });
    backward.on("end", () => {
      if (this.backwardStream === backward) {
        this.backwardStream = null;
      }
    });
    backward.start().catch((err) => this.emit("error", err));
  }
  /** chat.no ベースの重複排除（no > 0 のみ対象） */
  isDuplicateChat(chat) {
    if (chat.no <= 0) return false;
    if (this.seenChatNos.has(chat.no)) return true;
    this.seenChatNos.add(chat.no);
    return false;
  }
  mapChat(chat, isHistory) {
    const rawUserId = chat.rawUserId != null ? Number(chat.rawUserId) : void 0;
    const comment = {
      id: String(chat.no),
      content: chat.content,
      userId: chat.hashedUserId || (rawUserId ? String(rawUserId) : void 0),
      userName: chat.name?.startsWith("a:") ? void 0 : chat.name ?? void 0,
      userIcon: rawUserId ? `https://secure-dcdn.cdn.nimg.jp/nicoaccount/usericon/${Math.floor(rawUserId / 1e4)}/${rawUserId}.jpg` : void 0,
      timestamp: /* @__PURE__ */ new Date(),
      platform: "niconico",
      raw: chat
    };
    if (isHistory) comment.isHistory = true;
    return comment;
  }
  mapGift(nicoGift, isHistory) {
    const gift = {
      itemId: nicoGift.itemId,
      itemName: nicoGift.itemName,
      userId: nicoGift.advertiserUserId != null ? String(Number(nicoGift.advertiserUserId)) : void 0,
      userName: nicoGift.advertiserName,
      point: Number(nicoGift.point),
      message: nicoGift.message,
      timestamp: /* @__PURE__ */ new Date(),
      platform: "niconico",
      raw: nicoGift
    };
    if (isHistory) gift.isHistory = true;
    return gift;
  }
  mapEmotion(nicoEmotion, isHistory) {
    const emotion = {
      id: nicoEmotion.content,
      timestamp: /* @__PURE__ */ new Date(),
      platform: "niconico",
      raw: nicoEmotion
    };
    if (isHistory) emotion.isHistory = true;
    return emotion;
  }
  mapNotification(nicoNotif, isHistory) {
    const notification = {
      type: nicoNotif.type,
      message: nicoNotif.message,
      timestamp: /* @__PURE__ */ new Date(),
      platform: "niconico",
      raw: nicoNotif
    };
    if (isHistory) notification.isHistory = true;
    return notification;
  }
  mapOperatorComment(nicoOp, isHistory) {
    const operatorComment = {
      content: nicoOp.content,
      name: nicoOp.name ?? void 0,
      link: nicoOp.link ?? void 0,
      timestamp: /* @__PURE__ */ new Date(),
      platform: "niconico",
      raw: nicoOp
    };
    if (isHistory) operatorComment.isHistory = true;
    return operatorComment;
  }
};
export {
  BackwardStream,
  NiconicoProvider
};
//# sourceMappingURL=index.js.map