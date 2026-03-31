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
  console.error("❌ Faltando variáveis de ambiente (ACCESS_TOKEN, PHONE_NUMBER_ID ou GEMINI_API_KEY)");
}

// ==================== GEMINI - MODELO ATUALIZADO 2026 ====================
// Usando modelo com melhor suporte no free tier em março/2026
const MODEL_NAME = "gemini-2.5-flash-lite";   // Melhor opção atual para free tier

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME 
});

console.log(`🚀 Usando modelo Gemini: ${MODEL_NAME}`);

// ==================== WEBHOOK GET (Verificação Meta) ====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso pela Meta!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ==================== WEBHOOK POST (Mensagens do WhatsApp) ====================
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];

    if (!message || !message.text?.body) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const userText = message.text.body.trim();

    console.log(`📩 Mensagem de ${from}: ${userText}`);

    // Prompt da Lis (atendente)
    const prompt = `Você é a Lis, atendente simpática, educada e profissional da PlayPrime IPTV.

Planos disponíveis:
• 1 tela  → R$ 30/mês
• 2 telas → R$ 50/mês
• 3 telas → R$ 70/mês

Link para falar com humano: https://wa.me/5521964816185

Responda de forma curta, clara e educada. Não invente informações.

Cliente disse: "${userText}"`;

    const result = await model.generateContent(prompt);
    let botResponse = result.response.text();

    // Limita o tamanho da resposta para evitar erro no WhatsApp
    if (botResponse.length > 1500) {
      botResponse = botResponse.substring(0, 1497) + "...";
    }

    // Envia a resposta para o WhatsApp
    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: botResponse }
    }, {
      headers: { 
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    console.log(`✅ Resposta enviada para ${from}`);

  } catch (error) {
    console.error("❌ ERRO NO GEMINI/WHATSAPP:", error.message);

    if (error.response?.data) {
      console.error("Detalhes do erro:", JSON.stringify(error.response.data, null, 2));
    }

    // Se for erro de quota (429), avisa no console
    if (error.message.includes("429") || error.message.includes("quota")) {
      console.error("⚠️  QUOTA DO GEMINI ESGOTADA! Aguarde ou crie uma nova chave API.");
    }
  }

  // SEMPRE retornar 200 para o Meta não reenviar a mensagem
  res.sendStatus(200);
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`=====================================`);
  console.log(`🚀 LIS ONLINE - Porta ${PORT}`);
  console.log(`Modelo Gemini: ${MODEL_NAME}`);
  console.log(`=====================================`);
});
