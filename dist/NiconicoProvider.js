import { EventEmitter } from 'events';
import WebSocket from 'ws';
import protobuf from 'protobufjs/minimal.js';

class WebSocketClient extends EventEmitter {
  constructor(webSocketUrl) {
    super();
    this.webSocketUrl = webSocketUrl;
  }
  ws = null;
  keepSeatInterval = null;
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
    this.keepSeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ type: "keepSeat" }));
    }, intervalSec * 1e3);
  }
  stopKeepSeat() {
    if (this.keepSeatInterval) {
      clearInterval(this.keepSeatInterval);
      this.keepSeatInterval = null;
    }
  }
}

const { Reader } = protobuf;
function readLengthDelimitedMessage(buffer) {
  if (buffer.length === 0) return null;
  try {
    const reader = new Reader(buffer);
    const messageLength = reader.uint32();
    const headerSize = reader.pos;
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
  const reader = new Reader(data);
  const result = {};
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType !== 2) {
      reader.skipType(wireType);
      continue;
    }
    const len = reader.uint32();
    const subData = reader.buf.slice(reader.pos, reader.pos + len);
    reader.pos += len;
    switch (field) {
      case 1:
      // segment (MessageSegment)
      case 3:
        if (!result.segmentUri) {
          result.segmentUri = parseMessageSegmentUri(subData);
        }
        break;
      case 4:
        result.nextAt = parseReadyForNext(subData);
        break;
    }
  }
  return result;
}
function parseMessageSegmentUri(data) {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 3 && wireType === 2) {
      return reader.string();
    }
    reader.skipType(wireType);
  }
  return void 0;
}
function parseReadyForNext(data) {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 1 && wireType === 0) {
      const v = reader.int64();
      const num = typeof v === "number" ? v : Number(v);
      return String(num);
    }
    reader.skipType(wireType);
  }
  return void 0;
}
function parseChunkedMessage(data) {
  const reader = new Reader(data);
  const result = { chats: [] };
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 2 && wireType === 2) {
      const len = reader.uint32();
      const msgData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      const chat = parseNicoliveMessage(msgData);
      if (chat) result.chats.push(chat);
    } else {
      reader.skipType(wireType);
    }
  }
  return result;
}
function parseNicoliveMessage(data) {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 1 && wireType === 2) {
      const len = reader.uint32();
      const chatData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      return parseChat(chatData);
    }
    reader.skipType(wireType);
  }
  return null;
}
function parseChat(data) {
  const reader = new Reader(data);
  const chat = { no: 0, vpos: 0, content: "" };
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    switch (field) {
      case 1:
        if (wireType === 2) {
          chat.content = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 2:
        if (wireType === 2) {
          chat.name = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 3:
        if (wireType === 0) {
          chat.vpos = reader.int32();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 5:
        if (wireType === 0) {
          const v = reader.int64();
          chat.rawUserId = typeof v === "number" ? v : Number(v);
        } else {
          reader.skipType(wireType);
        }
        break;
      case 6:
        if (wireType === 2) {
          chat.hashedUserId = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 8:
        if (wireType === 0) {
          chat.no = reader.int32();
        } else {
          reader.skipType(wireType);
        }
        break;
      default:
        reader.skipType(wireType);
        break;
    }
  }
  return chat;
}

class MessageStream extends EventEmitter {
  constructor(viewUri, cookies) {
    super();
    this.viewUri = viewUri;
    this.cookies = cookies;
  }
  buffer = new Uint8Array(0);
  controller = null;
  /** ストリーミング開始（at パラメータ指定） */
  async start(at = "now") {
    const separator = this.viewUri.includes("?") ? "&" : "?";
    const uri = `${this.viewUri}${separator}at=${at}`;
    this.controller = new AbortController();
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
      if (!response.ok || !response.body) {
        throw new Error(`Message server returned ${response.status}`);
      }
      const reader = response.body.getReader();
      await this.readStream(reader);
    } catch (error) {
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
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.handleData(value);
      }
      this.emit("end");
    } catch (error) {
      if (error.name !== "AbortError") {
        this.emit("error", error);
      }
    }
  }
  /** @internal テスト用に公開 */
  handleData(chunk) {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);
    const { messages, remaining } = extractMessages(combined);
    this.buffer = new Uint8Array(remaining);
    for (const msg of messages) {
      try {
        const entry = parseChunkedEntry(msg);
        this.emitEntry(entry);
      } catch {
      }
    }
  }
  emitEntry(entry) {
    if (entry.segmentUri) {
      this.emit("segment", entry.segmentUri);
    }
    if (entry.nextAt) {
      this.emit("next", entry.nextAt);
    }
  }
}

class SegmentStream extends EventEmitter {
  constructor(segmentUri, cookies) {
    super();
    this.segmentUri = segmentUri;
    this.cookies = cookies;
  }
  buffer = new Uint8Array(0);
  controller = null;
  async start() {
    this.controller = new AbortController();
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      };
      if (this.cookies) headers["Cookie"] = this.cookies;
      const response = await fetch(this.segmentUri, {
        headers,
        signal: this.controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(`Segment server returned ${response.status}`);
      }
      const reader = response.body.getReader();
      await this.readStream(reader);
    } catch (error) {
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
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.handleData(value);
      }
      this.emit("end");
    } catch (error) {
      if (error.name !== "AbortError") {
        this.emit("error", error);
      }
    }
  }
  /** @internal テスト用に公開 */
  handleData(chunk) {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);
    const { messages, remaining } = extractMessages(combined);
    this.buffer = new Uint8Array(remaining);
    for (const msg of messages) {
      try {
        const result = parseChunkedMessage(msg);
        for (const chat of result.chats) {
          this.emit("chat", chat);
        }
      } catch {
      }
    }
  }
}

class NiconicoProvider extends EventEmitter {
  liveId;
  cookies;
  maxRetries;
  retryIntervalMs;
  wsClient = null;
  messageStream = null;
  segmentStreams = [];
  fetchedSegments = /* @__PURE__ */ new Set();
  state = "disconnected";
  intentionalDisconnect = false;
  reconnectCount = 0;
  reconnectTimer = null;
  constructor(options) {
    super();
    this.liveId = options.liveId;
    this.cookies = options.cookies;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryIntervalMs = options.retryIntervalMs ?? 5e3;
  }
  async connect() {
    this.intentionalDisconnect = false;
    this.setState("connecting");
    try {
      const webSocketUrl = await this.fetchWebSocketUrl();
      await this.connectWebSocket(webSocketUrl);
      this.reconnectCount = 0;
      this.setState("connected");
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
        const webSocketUrl = await this.fetchWebSocketUrl();
        await this.connectWebSocket(webSocketUrl);
        this.reconnectCount = 0;
        this.setState("connected");
      } catch {
        this.scheduleReconnect();
      }
    }, this.retryIntervalMs);
  }
  /** 放送ページのHTMLからWebSocket URLを取得する */
  async fetchWebSocketUrl() {
    const url = `https://live.nicovideo.jp/watch/${this.liveId}`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
    };
    if (this.cookies) headers["Cookie"] = this.cookies;
    const response = await fetch(url, { headers });
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
    return wsUrl;
  }
  startMessageStream(viewUri) {
    this.messageStream?.stop();
    this.messageStream = new MessageStream(viewUri, this.cookies);
    this.messageStream.on("segment", (segmentUri) => {
      this.startSegmentStream(segmentUri);
    });
    this.messageStream.on("next", (nextAt) => {
      this.messageStream?.stop();
      this.messageStream = new MessageStream(viewUri, this.cookies);
      this.setupMessageStreamHandlers(viewUri);
      this.messageStream.start(nextAt).catch((err) => this.emit("error", err));
    });
    this.messageStream.on("error", (error) => {
      this.emit("error", error);
    });
    this.messageStream.start("now").catch((err) => this.emit("error", err));
  }
  setupMessageStreamHandlers(viewUri) {
    if (!this.messageStream) return;
    this.messageStream.on("segment", (segmentUri) => {
      this.startSegmentStream(segmentUri);
    });
    this.messageStream.on("next", (nextAt) => {
      this.messageStream?.stop();
      this.messageStream = new MessageStream(viewUri, this.cookies);
      this.setupMessageStreamHandlers(viewUri);
      this.messageStream.start(nextAt).catch((err) => this.emit("error", err));
    });
    this.messageStream.on("error", (error) => {
      this.emit("error", error);
    });
  }
  startSegmentStream(segmentUri) {
    if (this.fetchedSegments.has(segmentUri)) return;
    this.fetchedSegments.add(segmentUri);
    const segment = new SegmentStream(segmentUri, this.cookies);
    segment.on("chat", (chat) => {
      const comment = {
        id: String(chat.no),
        content: chat.content,
        userId: chat.hashedUserId || (chat.rawUserId ? String(chat.rawUserId) : void 0),
        timestamp: /* @__PURE__ */ new Date(),
        platform: "niconico",
        raw: chat
      };
      this.emit("comment", comment);
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
}

export { NiconicoProvider as N };
//# sourceMappingURL=NiconicoProvider.js.map
