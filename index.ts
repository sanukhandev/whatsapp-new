import express from "express";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";

const app = express();
app.use(express.json());

let sock: WASocket;

// ==========================
// 1️⃣  Initialize WhatsApp Connection
// ==========================
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth");

  sock = makeWASocket({
    auth: state,
    browser: ["MyApp", "Chrome", "1.0.0"],
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Scan this QR Code with your WhatsApp:");
      console.log(qr);
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log("Connection closed. Reconnecting:", shouldReconnect);
      if (shouldReconnect) startSock();
    } else if (connection === "open") {
      console.log("✅ WhatsApp connected successfully!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // Forward incoming messages to external API
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg || !msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid!;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    console.log("📩 Received:", { sender, text });

    try {
      // Call unified chat API
      const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ZW1pcmF0ZXM6c2VjdXJlMTIzIUVtaXJhdGVzQ29ubmVjdA==',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: sender,
          text: text,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log("✅ Message forwarded successfully");
    } catch (err) {
      console.error("❌ Failed to forward message:", err instanceof Error ? err.message : String(err));
    }
  });

  return sock;
}

// Initialize WhatsApp connection
startSock();

// ==========================
// 3️⃣  Express API to send WhatsApp messages
// ==========================
app.post("/send", async (req, res) => {
  try {
    const { number, message } = req.body;
    if (!number || !message)
      return res.status(400).json({ error: "number and message are required" });

    if (!sock) {
      return res.status(503).json({ error: "WhatsApp not connected yet" });
    }

    const jid = number.includes("@s.whatsapp.net")
      ? number
      : `${number}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });
    console.log(`📤 Message sent to ${jid}: ${message}`);

    return res.json({ success: true });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ==========================
// 4️⃣  Start Server
// ==========================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
