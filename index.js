const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// =========================================================
// 🛡️ CONFIGURAÇÕES VIA AMBIENTE (RENDER)
// =========================================================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "lis_token_123"; 
const ACCESS_TOKEN = process.env.ACCESS_TOKEN; 
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// Inicialização Única do Gemini
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// 1. VALIDAÇÃO DO WEBHOOK (META)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VALIDADO!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 2. PROCESSAMENTO DE MENSAGENS
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message || !message.text) return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    console.log(`📩 Mensagem de ${from}: ${text}`);

    // Instruções da Lis
    const systemInstruction = "Você é a Lis, atendente da PlayPrime IPTV. Planos: 1 tela R$30, 2 telas R$50, 3 telas R$70. Seja vendedora e use emojis. Link: https://wa.me/5521964816185";

    // Resposta do Gemini
    const prompt = `${systemInstruction}\n\nUsuário: ${text}`;
    const result = await model.generateContent(prompt);
    const resposta = result.response.text();

    // 3. ENVIO WHATSAPP
    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: resposta },
    }, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ ERRO NO PROCESSAMENTO:", error.message);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("=====================================");
  console.log("🚀 SISTEMA ATUALIZADO: LIS + GEMINI ONLINE!");
  console.log("=====================================");
});
