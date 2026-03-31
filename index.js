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

// ==================== GEMINI ====================
// Modelos atualizados em 2026 - use um destes:
const MODEL_NAME = "gemini-2.0-flash";        // Recomendado (rápido e bom)
// const MODEL_NAME = "gemini-flash-latest";  // Alternativa (aponta para o mais recente Flash)
// const MODEL_NAME = "gemini-2.5-flash";     // Se quiser o mais novo

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

// ==================== WEBHOOK POST (Mensagens) ====================
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

    // Prompt melhorado
    const prompt = `Você é a Lis, atendente simpática e profissional da PlayPrime IPTV.

Planos disponíveis:
• 1 tela → R$ 30/mês
• 2 telas → R$ 50/mês
• 3 telas → R$ 70/mês

Link para falar com humano: https://wa.me/5521964816185

Responda de forma curta, educada e direta. Não invente informações.

Cliente disse: "${userText}"`;

    const result = await model.generateContent(prompt);
    let botResponse = result.response.text();

    // Limita tamanho da resposta (evita erro no WhatsApp)
    if (botResponse.length > 1500) {
      botResponse = botResponse.substring(0, 1497) + "...";
    }

    // Envia resposta para o WhatsApp
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

  } catch (error) {
    console.error("❌ ERRO NO GEMINI/WHATSAPP:", error.message);
    if (error.response?.data) {
      console.error("Detalhes:", JSON.stringify(error.response.data, null, 2));
    }
  }

  // Sempre retornar 200 para o Meta não reenviar a mensagem
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
