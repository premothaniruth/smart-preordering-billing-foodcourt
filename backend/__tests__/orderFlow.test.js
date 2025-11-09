const request = require("supertest");
const path = require("path");
const fs = require("fs");

const TEST_PORT = 3999;

describe("/order integration", () => {
  const originalEnv = {
    PORT: process.env.PORT,
    JWT_SECRET: process.env.JWT_SECRET,
    RUN_SERVER: process.env.RUN_SERVER,
  };

  let app;
  let server;

  beforeAll(() => {
    process.env.PORT = TEST_PORT;
    process.env.JWT_SECRET = "test-secret";
    process.env.RUN_SERVER = "false";

    jest.resetModules();
    ({ app, server } = require("../index"));
  });

  afterAll(() => {
    if (server && typeof server.close === "function") {
      try {
        server.close();
      } catch (error) {
        // ignore cleanup errors in tests
      }
    }

    process.env.PORT = originalEnv.PORT;
    process.env.JWT_SECRET = originalEnv.JWT_SECRET;
    process.env.RUN_SERVER = originalEnv.RUN_SERVER;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("returns 400 when shopId is invalid", async () => {
    const response = await request(app)
      .post("/order")
      .send({
        shopId: "999999",
        items: [],
        user: "integration-test-user",
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ message: "Invalid shopId" });
  });
});
