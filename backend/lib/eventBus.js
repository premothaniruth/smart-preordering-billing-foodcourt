const { createClient } = require("redis");
const analyticsConfig = require("./analyticsConfig");

class EventBus {
  constructor(options = {}) {
    const {
      redisUrl = analyticsConfig.REDIS_URL,
      streamKey = analyticsConfig.ANALYTICS_STREAM,
      streamMaxLen = analyticsConfig.ANALYTICS_STREAM_MAX_LEN,
      eventApp = analyticsConfig.ANALYTICS_EVENT_APP,
    } = options;

    this.streamKey = streamKey;
    this.streamMaxLen = streamMaxLen;
    this.eventApp = eventApp;
    this.client = createClient({ url: redisUrl });

    this.client.on("error", (err) => {
      console.error("[EventBus] Redis error", err);
    });
  }

  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async disconnect() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async emit(eventType, payload = {}) {
    if (!eventType || typeof eventType !== "string") {
      throw new Error("eventType must be a non-empty string");
    }

    const event = {
      type: eventType,
      app: this.eventApp,
      ts: new Date().toISOString(),
      payload: JSON.stringify(payload),
    };

    await this.client.xAdd(this.streamKey, "*", event, {
      TRIM: {
        strategy: "MAXLEN",
        strategyModifier: "~",
        threshold: this.streamMaxLen,
      },
    });
  }
}

let sharedInstance;

const getEventBus = () => {
  if (!sharedInstance) {
    sharedInstance = new EventBus();
  }
  return sharedInstance;
};

module.exports = {
  EventBus,
  getEventBus,
};
