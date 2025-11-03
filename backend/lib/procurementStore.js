const fs = require("fs");
const path = require("path");

const ordersFile = path.join(__dirname, "..", "data", "procurement_orders.json");
const templatesFile = path.join(__dirname, "..", "data", "procurement_templates.json");

const ensureFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
};

const readJson = (filePath) => {
  ensureFile(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw || "[]");
};

const writeJson = (filePath, data) => {
  ensureFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const normalizeVendorId = (vendorId) => String(vendorId);
const normalizeTemplateId = (id) => String(id);

const listTemplates = (vendorId) => {
  const templates = readJson(templatesFile);
  return templates.filter((tpl) => normalizeVendorId(tpl.vendorId) === normalizeVendorId(vendorId));
};

const saveTemplate = (template) => {
  const templates = readJson(templatesFile);
  const key = normalizeTemplateId(template.id);
  const idx = templates.findIndex((tpl) => normalizeTemplateId(tpl.id) === key);
  if (idx >= 0) {
    templates[idx] = template;
  } else {
    templates.push(template);
  }
  writeJson(templatesFile, templates);
  return template;
};

const deleteTemplate = (vendorId, templateId) => {
  const templates = readJson(templatesFile);
  const filtered = templates.filter(
    (tpl) => normalizeVendorId(tpl.vendorId) !== normalizeVendorId(vendorId) || normalizeTemplateId(tpl.id) !== normalizeTemplateId(templateId)
  );
  writeJson(templatesFile, filtered);
};

const generateTemplateId = () => `tpl-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const listOrders = (vendorId) => {
  const orders = readJson(ordersFile);
  return orders.filter((order) => normalizeVendorId(order.vendorId) === normalizeVendorId(vendorId));
};

const saveOrder = (order) => {
  const orders = readJson(ordersFile);
  orders.push(order);
  writeJson(ordersFile, orders);
  return order;
};

module.exports = {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  generateTemplateId,
  listOrders,
  saveOrder,
};
