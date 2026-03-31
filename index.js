const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==================== CONFIGURAÇÕES ====================
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const KIMI_API_KEY = process.env.KIMI_API_KEY; // Nova variável
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "lis_token_123";

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID || !KIMI_API_KEY) {
  console.error("❌ Faltando variáveis de ambiente!");
  process.exit(1);
}

const MODEL_NAME = "kimi-k2-5";
console.log(`🚀 Usando modelo: ${MODEL_NAME}`);

// ==================== FUNÇÃO KIMI ====================
async function gerarRespostaLis(userText) {
  try {
    const response = await axios.post(
      "https://api.moonshot.cn/v1/chat/completions",
      {
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content: `Você é a Lis, atendente virtual da PlayPrime IPTV.
            
Regras:
- Seja direta, educada e humanizada
- Planos: 1 tela R$30 | 2 telas R$50 | 3 telas R$70
- Para suporte humano: https://wa.me/5521964816185
- Respostas curtas (máx 2-3 frases)`
          },
          {
            role: "user",
            content: userText
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          "Authorization": `Bearer ${KIMI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 10000 // 10 segundos timeout
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("❌ Erro na API Kimi:", error.response?.data || error.message);
    throw error;
  }
}

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
  let from = null;
  
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];

    if (!message || !message.text?.body) return res.sendStatus(200);

    from = message.from;
    const userText = message.text.body.trim();

    console.log(`📩 Mensagem de ${from}: ${userText}`);

    // Usando Kimi em vez de Gemini
    let resposta = await gerarRespostaLis(userText);

    // Limita tamanho para WhatsApp
    if (resposta.length > 1500) {
      resposta = resposta.substring(0, 1497) + "...";
    }

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: resposta }
      },
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      }
    );

    console.log(`✅ Resposta enviada para ${from}`);

  } catch (error) {
    console.error("❌ ERRO:", error.message);
    
    // Fallback para suporte humano
    if (from) {
      const fallbackMsg = "Oi! Estou com instabilidade técnica no momento. Por favor, fale com o suporte humano: https://wa.me/5521964816185";

      try {
        await axios.post(
          `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: fallbackMsg }
          },
          {
            headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
          }
        );
        console.log("📤 Fallback enviado");
      } catch (e) {
        console.error("❌ Falha no fallback:", e.message);
      }
    }
  }

  res.sendStatus(200);
});

// ==================== HEALTH CHECK ====================
app.get("/", (req, res) => {
  res.json({ 
    status: "LIS ONLINE", 
    modelo: MODEL_NAME, 
    timestamp: new Date().toISOString() 
  });
});

// ==================== INICIAR ====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 LIS ONLINE | Modelo: ${MODEL_NAME} | Porta: ${PORT}`);
});
