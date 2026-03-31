const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// ==================== CONFIGURAÇÕES ====================
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "lis_token_123";

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID || !GEMINI_API_KEY) {
  console.error("❌ Faltando variáveis de ambiente!");
}

// ==================== GEMINI ====================
const MODEL_NAME = "gemini-2.5-flash-lite";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

console.log(`🚀 Usando modelo: ${MODEL_NAME}`);

// ==================== WEBHOOK GET ====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado pela Meta");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ==================== WEBHOOK POST ====================
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];

    if (!message || !message.text?.body) return res.sendStatus(200);

    const from = message.from;
    const userText = message.text.body.trim();

    console.log(`📩 Mensagem de ${from}: ${userText}`);

    const prompt = `Você é a Lis, atendente da PlayPrime IPTV.

Planos:
• 1 tela → R$30
• 2 telas → R$50
• 3 telas → R$70

Link humano: https://wa.me/5521964816185

Responda curto e educado.
Cliente: "${userText}"`;

    const result = await model.generateContent(prompt);
    let resposta = result.response.text();

    if (resposta.length > 1500) resposta = resposta.substring(0, 1497) + "...";

    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: resposta }
    }, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    console.log(`✅ Resposta enviada`);

  } catch (error) {
    console.error("❌ ERRO:", error.message);

    // Mensagem automática quando chave bloqueada ou quota zerada
    let fallbackMsg = "Oi! Estou com muita demanda no momento. Por favor, tente novamente em alguns minutos ou fale direto com o suporte humano: https://wa.me/5521964816185";

    if (error.message.includes("leaked") || error.message.includes("403")) {
      fallbackMsg = "Desculpe, estou com problema técnico temporário. Fale com o suporte: https://wa.me/5521964816185";
    }

    try {
      await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: message.from,
        text: { body: fallbackMsg }
      }, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });
    } catch (e) {
      console.error("Falha ao enviar mensagem de fallback");
    }
  }

  res.sendStatus(200);
});

// ==================== INICIAR ====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 LIS ONLINE | Modelo: ${MODEL_NAME} | Porta: ${PORT}`);
});
