// app.js
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
// 3️⃣ Device registry (IN-MEMORY)
// ----------------------
const DEVICE_KEYS = {
  bulbA: "123456",
  bulbB: "654321",
};

const nodes = {
  bulbA: {
    id: "bulbA",
    isOn: false,
    energyBalance: 100000000000000,
    consumptionRate: 0.1, // energy per second
    lastSeen: null,
  },
  bulbB: {
    id: "bulbB",
    isOn: false,
    energyBalance: 0,
    consumptionRate: 0.1,
    lastSeen: null,
  },
};

// ----------------------
// 4️⃣ Device auth middleware (REST)
// ----------------------
function deviceAuth(req, res, next) {
  const id = req.headers["x-device-id"];
  const key = req.headers["x-device-key"];

  if (!id || !key || DEVICE_KEYS[id] !== key) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized device",
    });
  }

  req.device = nodes[id];
  next();
}

// ----------------------
// 5️⃣ Start HTTP server
// ----------------------
const server = app.listen(process.env.PORT, () =>
  console.log(`🚀 Server running on port ${process.env.PORT}`)
);

// ----------------------
// 6️⃣ WebSocket server
// ----------------------
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = {}; // deviceId => ws

wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // -------- DEVICE AUTH --------
      if (data.type === "auth") {
        const { id, key } = data;

        if (DEVICE_KEYS[id] !== key) {
          ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
          ws.close();
          return;
        }

        ws.deviceId = id;
        clients[id] = ws;
        nodes[id].lastSeen = Date.now();

        console.log(`✅ ${id} authenticated`);

        ws.send(
          JSON.stringify({
            type: "status",
            isOn: nodes[id].isOn,
            energy: nodes[id].energyBalance,
          })
        );
      }

      // -------- HEARTBEAT --------
      if (data.type === "heartbeat" && ws.deviceId) {
        nodes[ws.deviceId].lastSeen = Date.now();
      }

      // -------- DEVICE STATUS ACK --------
      if (data.type === "device-status" && ws.deviceId) {
        nodes[ws.deviceId].isOn = data.isOn;
        nodes[ws.deviceId].lastSeen = Date.now();
      }
    } catch (err) {
      console.error("❌ WS message error", err);
    }
  });

  ws.on("close", () => {
    if (ws.deviceId) {
      console.log(`❌ ${ws.deviceId} disconnected`);
      delete clients[ws.deviceId];
    }
  });
});

// ----------------------
// 7️⃣ Welcome route
// ----------------------
app.get("/", (req, res) => {
  res.send("Welcome to IzubaSmartHub API!");
});

// ----------------------
// 8️⃣ Device control API (ignore energy, allow on/off freely)
// ----------------------
app.post("/api/device/on", deviceAuth, (req, res) => {
  const d = req.device;
  d.isOn = true;

  clients[d.id]?.send(
    JSON.stringify({ type: "status", isOn: true, energy: d.energyBalance })
  );

  res.json({ ok: true, device: d.id, isOn: true });
});

app.post("/api/device/off", deviceAuth, (req, res) => {
  const d = req.device;
  d.isOn = false;

  clients[d.id]?.send(
    JSON.stringify({ type: "status", isOn: false, energy: d.energyBalance })
  );

  res.json({ ok: true, device: d.id, isOn: false });
});

// ----------------------
// 9️⃣ Auth routes (JWT users)
// ----------------------
app.use("/api/auth", authRoutes);

// ----------------------
// 🔟 Energy sharing (JWT protected)
// ----------------------
app.post("/api/share", userAuth, (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || amount <= 0)
    return res.status(400).json({ ok: false, message: "Invalid request" });

  if (!nodes[from] || !nodes[to])
    return res.status(404).json({ ok: false, message: "Bulb not found" });

  if (req.user.bulbId !== from)
    return res.status(403).json({ ok: false, message: "Not authorized" });

  nodes[from].energyBalance -= amount;
  nodes[to].energyBalance += amount;
  nodes[to].isOn = true;

  clients[to]?.send(
    JSON.stringify({
      type: "status",
      isOn: true,
      energy: nodes[to].energyBalance,
    })
  );

  res.json({
    ok: true,
    from,
    to,
    energyRemaining: nodes[from].energyBalance,
    energyReceived: nodes[to].energyBalance,
  });
});

// ----------------------
// 1️⃣1️⃣ Energy consumption engine (PER SECOND)
// ----------------------
setInterval(() => {
  Object.values(nodes).forEach((node) => {
    if (node.isOn) {
      node.energyBalance -= node.consumptionRate;

      // ⚡ Only update energy, do NOT turn off
      clients[node.id]?.send(
        JSON.stringify({
          type: "energy-update",
          energy: Number(node.energyBalance.toFixed(2)),
        })
      );
    }
  });
}, 1000);

// ----------------------
// 1️⃣2️⃣ Helper: device online check
// ----------------------
export function isDeviceOnline(id) {
  return nodes[id]?.lastSeen && Date.now() - nodes[id].lastSeen < 30000;
}
