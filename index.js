const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// =========================================================
// 🛡️ CONFIGURAÇÕES (PEGANDO TUDO DO PAINEL DO RENDER)
// =========================================================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "lis_token_123"; 
const ACCESS_TOKEN = process.env.ACCESS_TOKEN; 
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// CONFIGURAÇÃO DO MOTOR GEMINI (NOME CORRIGIDO PARA EVITAR 404)
const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 1. VALIDAÇÃO DO WEBHOOK
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
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

    // Contexto da Lis
    const systemInstruction = "Você é a Lis, atendente da PlayPrime IPTV. Planos: 1 tela R$30, 2 telas R$50, 3 telas R$70. Seja vendedora e use emojis. Link: https://wa.me/5521964816185";

    // Chamada para o Gemini (Motor 1.5 Flash)
    const prompt = `${systemInstruction}\n\nUsuário diz: ${text}`;
    const result = await model.generateContent(prompt);
    const resposta = result.response.text();

    // 3. ENVIO PARA WHATSAPP
    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: resposta },
    }, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ ERRO NO SISTEMA:", error.message);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("=====================================");
  console.log("🚀 LIS ONLINE COM GEMINI 1.5 FLASH!");
  console.log("=====================================");
});
