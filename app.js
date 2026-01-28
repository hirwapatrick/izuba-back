// server.js
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";

import userAuth from "./middleware/auth.middleware.js";
import authRoutes from "./routes/Auth.js";
import connectDB from "./config/db.js"; 

dotenv.config();

// ----------------------
// 1️⃣ Express setup
// ----------------------
export const app = express();

app.use(cors());
app.use(express.json());

// ----------------------
// 2️⃣ Connect to MongoDB
// ----------------------
connectDB();

// ----------------------
// 3️⃣ Device data
// ----------------------
const DEVICE_KEYS = { bulbA: "123456", bulbB: "654321" };
const nodes = {
  bulbA: { id: "bulbA", isOn: false, energyBalance: 100, consumptionRate: 5, lastSeen: null },
  bulbB: { id: "bulbB", isOn: false, energyBalance: 0, consumptionRate: 5, lastSeen: null },
};

// ----------------------
// 4️⃣ Device auth middleware
// ----------------------
function deviceAuth(req, res, next) {
  const id = req.headers["x-device-id"];
  const key = req.headers["x-device-key"];
  if (!id || !key || DEVICE_KEYS[id] !== key)
    return res.status(401).json({ ok: false, message: "Unauthorized device" });
  req.device = nodes[id];
  next();
}

// ----------------------
// 5️⃣ WebSocket server
// ----------------------
const server = app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));
const wss = new WebSocketServer({ server });
const clients = {}; // keep track of connected devices

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "auth") {
        const { id, key } = data;
        if (DEVICE_KEYS[id] === key) {
          ws.deviceId = id;
          clients[id] = ws;
          console.log(`${id} authenticated over WS`);
          ws.send(JSON.stringify({ type: "status", isOn: nodes[id].isOn, energy: nodes[id].energyBalance }));
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
          ws.close();
        }
      }
    } catch (err) {
      console.error("WS message error", err);
    }
  });

  ws.on("close", () => {
    if (ws.deviceId) delete clients[ws.deviceId];
    console.log("WS connection closed");
  });
});

// ----------------------
// 6️⃣ Device routes
// ----------------------
app.post("/api/device/on", deviceAuth, (req, res) => {
  const d = req.device;
  if (d.energyBalance <= 0) return res.json({ ok: false, message: "No energy" });
  d.isOn = true;
  clients[d.id]?.send(JSON.stringify({ type: "status", isOn: d.isOn, energy: d.energyBalance }));
  res.json({ ok: true });
});

app.post("/api/device/off", deviceAuth, (req, res) => {
  const d = req.device;
  d.isOn = false;
  clients[d.id]?.send(JSON.stringify({ type: "status", isOn: d.isOn, energy: d.energyBalance }));
  res.json({ ok: true });
});

// ----------------------
// 7️⃣ Auth routes
// ----------------------
app.use("/api/auth", authRoutes);

// ----------------------
// 8️⃣ Energy sharing (user JWT protected)
// ----------------------
app.post("/api/share", userAuth, (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || amount <= 0) return res.status(400).json({ ok: false, message: "Invalid request" });
  if (!nodes[from] || !nodes[to]) return res.status(404).json({ ok: false, message: "Bulb not found" });
  if (req.user.bulbId !== from) return res.status(403).json({ ok: false, message: "Not authorized" });
  if (nodes[from].energyBalance < amount) return res.status(400).json({ ok: false, message: "Insufficient energy" });

  nodes[from].energyBalance -= amount;
  nodes[to].energyBalance += amount;
  if (nodes[to].energyBalance > 0) nodes[to].isOn = true;
  clients[to]?.send(JSON.stringify({ type: "status", isOn: nodes[to].isOn, energy: nodes[to].energyBalance }));

  res.json({
    ok: true,
    from,
    to,
    energyRemaining: nodes[from].energyBalance,
    energyReceived: nodes[to].energyBalance,
  });
});

// ----------------------
// 9️⃣ Energy consumption engine
// ----------------------
setInterval(() => {
  Object.values(nodes).forEach((node) => {
    if (node.isOn) {
      node.energyBalance -= node.consumptionRate;
      if (node.energyBalance <= 0) {
        node.energyBalance = 0;
        node.isOn = false;
        clients[node.id]?.send(JSON.stringify({ type: "status", isOn: node.isOn, energy: node.energyBalance }));
      }
    }
  });
}, 60 * 1000);
