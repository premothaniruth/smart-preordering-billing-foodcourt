const fs = require("fs");
const path = require("path");

const TASKS_PATH = path.join(__dirname, "..", "data", "procurement_tasks.json");

const ensureStore = () => {
  if (!fs.existsSync(TASKS_PATH)) {
    fs.mkdirSync(path.dirname(TASKS_PATH), { recursive: true });
    fs.writeFileSync(TASKS_PATH, JSON.stringify([], null, 2));
  }
};

const readStore = () => {
  ensureStore();
  const raw = fs.readFileSync(TASKS_PATH, "utf8");
  return JSON.parse(raw || "[]");
};

const writeStore = (data) => {
  ensureStore();
  fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
};

const listTasks = (vendorId) => {
  const store = readStore();
  return store.filter((task) => String(task.vendorId) === String(vendorId));
};

const saveTask = (task) => {
  const store = readStore();
  const index = store.findIndex((existing) => existing.id === task.id);
  if (index >= 0) {
    store[index] = task;
  } else {
    store.push(task);
  }
  writeStore(store);
  return task;
};

const removeTasksForVendor = (vendorId) => {
  const store = readStore();
  const filtered = store.filter((task) => String(task.vendorId) !== String(vendorId));
  if (filtered.length !== store.length) {
    writeStore(filtered);
  }
};

const addTasksForVendor = (tasks = []) => {
  if (!Array.isArray(tasks) || tasks.length === 0) return;
  const store = readStore();
  const map = new Map(store.map((task) => [task.id, task]));
  tasks.forEach((task) => {
    if (!task || task.id == null) return;
    map.set(task.id, task);
  });
  writeStore(Array.from(map.values()));
};

const generateTaskId = () => `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const getTaskById = (taskId) => {
  const store = readStore();
  return store.find((task) => task.id === taskId) || null;
};

module.exports = {
  listTasks,
  saveTask,
  generateTaskId,
  getTaskById,
  removeTasksForVendor,
  addTasksForVendor,
};
