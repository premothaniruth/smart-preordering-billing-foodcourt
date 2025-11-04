const path = require("path");
const fs = require("fs");
const request = require("supertest");

const TEST_PORT = 3999;
const BACKEND_PATH = path.resolve(__dirname, "..", "index.js");

let app;
let server;

const dataDir = path.resolve(__dirname, "..", "data");
const ordersFile = path.join(dataDir, "orders.json");
const menuFile = path.join(dataDir, "menu.json");

const loadJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const saveJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

describe("/order integration", () => {
  const originalOrders = fs.readFileSync(ordersFile, "utf8");

  beforeAll(async () => {
    process.env.PORT = TEST_PORT;
    process.env.JWT_SECRET = "test-secret";
    const { default: importedApp } = await import(pathToFileURL(BACKEND_PATH));
  });
});
