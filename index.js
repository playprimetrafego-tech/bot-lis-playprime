const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// ==================== CONFIGURAÇÕES ====================
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "lis_token_123";
const PORT = process.env.PORT || 10000;

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID || !OPENAI_API_KEY) {
  console.error("❌ Faltando variáveis de ambiente!");
}

// ==================== OPENAI ====================
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const MODEL_NAME = "gpt-4o-mini";
console.log(`🚀 Usando modelo: ${MODEL_NAME}`);

// ==================== CONTROLE ANTI-LOOP ====================
// Guarda mensagens já processadas
const processedMessages = new Map();

// Guarda último tempo de mensagem por usuário
const userCooldown = new Map();

// Limpa memória periodicamente
function cleanupMemory() {
  const now = Date.now();

  for (const [messageId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > 10 * 60 * 1000) {
      processedMessages.delete(messageId);
    }
  }

  for (const [user, timestamp] of userCooldown.entries()) {
    if (now - timestamp > 60 * 1000) {
      userCooldown.delete(user);
    }
  }
}

setInterval(cleanupMemory, 60 * 1000);

// ==================== WEBHOOK GET ====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado pela Meta");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ==================== WEBHOOK POST ====================
app.post("/webhook", async (req, res) => {
  // Responde rápido pra Meta evitar reenvio do mesmo evento
  res.sendStatus(200);

  try {
    const change = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    // Ignora se não houver mensagem
    if (!message) return;

    // Ignora mensagens que não sejam texto
    if (message.type !== "text") return;

    // Ignora mensagens sem conteúdo
    if (!message.text?.body?.trim()) return;

    const messageId = message.id;
    const from = message.from;
    const userText = message.text.body.trim();

    // ==================== ANTI-DUPLICAÇÃO ====================
    if (processedMessages.has(messageId)) {
      console.log(`⚠️ Mensagem duplicada ignorada: ${messageId}`);
      return;
    }
    processedMessages.set(messageId, Date.now());

    // ==================== ANTI-FLOOD ====================
    const now = Date.now();
    const lastMessageTime = userCooldown.get(from);

    if (lastMessageTime && now - lastMessageTime < 4000) {
      console.log(`⚠️ Cooldown ativo para ${from}, ignorando mensagem`);
      return;
    }

    userCooldown.set(from, now);

    console.log(`📩 Mensagem de ${from}: ${userText}`);

    // ==================== PROMPT ====================
    const prompt = `Você é a Lis, atendente da PlayPrime.

Regras:
- Seja simpática, objetiva e natural.
- Nunca repita saudação sem necessidade.
- Não envie várias mensagens iguais.
- Responda sempre de forma curta.
- Se o cliente disser que já foi ajudado, agradeça e encerre educadamente.
- Não insista se a conversa já terminou.

Cliente: "${userText}"`;

    // ==================== OPENAI REQUEST ====================
    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content:
            "Você é uma atendente educada, simpática e objetiva. Não repita cumprimento em toda mensagem. Se a conversa já estiver em andamento, responda direto ao ponto."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 150,
    });

    let resposta = completion.choices?.[0]?.message?.content?.trim();

    if (!resposta) {
      resposta = "Oi! Como posso te ajudar?";
    }

    if (resposta.length > 1500) {
      resposta = resposta.substring(0, 1497) + "...";
    }

    // ==================== ENVIO WHATSAPP ====================
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: resposta }
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Resposta enviada");

  } catch (error) {
    console.error("❌ ERRO:", error.response?.data || error.message);
  }
});

// ==================== INICIAR ====================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 LIS ONLINE | Modelo: ${MODEL_NAME} | Porta: ${PORT}`);
});
