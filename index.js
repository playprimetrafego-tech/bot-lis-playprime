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

// ==================== MEMÓRIA TEMPORÁRIA ====================
// mensagens já processadas
const processedMessages = new Map();

// cooldown por usuário
const userCooldown = new Map();

// pausa atendimento automático quando humano assumir
const humanPausedUsers = new Map();

// histórico simples por usuário
const conversationHistory = new Map();

// ==================== CONFIGS ====================
const MESSAGE_TTL_MS = 10 * 60 * 1000;      // 10 min
const COOLDOWN_MS = 4000;                   // 4 segundos
const HUMAN_PAUSE_MS = 30 * 60 * 1000;      // 30 min
const HISTORY_LIMIT = 10;                   // últimas 10 falas

// ==================== HELPERS ====================
function cleanupMemory() {
  const now = Date.now();

  for (const [messageId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_TTL_MS) {
      processedMessages.delete(messageId);
    }
  }

  for (const [user, timestamp] of userCooldown.entries()) {
    if (now - timestamp > 60 * 1000) {
      userCooldown.delete(user);
    }
  }

  for (const [user, timestamp] of humanPausedUsers.entries()) {
    if (now - timestamp > HUMAN_PAUSE_MS) {
      humanPausedUsers.delete(user);
      console.log(`🤖 Atendimento automático reativado para ${user}`);
    }
  }
}

function addToHistory(user, role, content) {
  if (!conversationHistory.has(user)) {
    conversationHistory.set(user, []);
  }

  const history = conversationHistory.get(user);
  history.push({ role, content });

  if (history.length > HISTORY_LIMIT) {
    history.shift();
  }
}

function getHistoryMessages(user) {
  const history = conversationHistory.get(user) || [];
  return history.map(item => ({
    role: item.role,
    content: item.content
  }));
}

function isHumanPauseActive(user) {
  const pausedAt = humanPausedUsers.get(user);
  if (!pausedAt) return false;

  const now = Date.now();
  if (now - pausedAt > HUMAN_PAUSE_MS) {
    humanPausedUsers.delete(user);
    return false;
  }

  return true;
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
  res.sendStatus(200);

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const status = value?.statuses?.[0];

    // Ignora status de entrega/leitura
    if (status) return;

    if (!message) return;
    if (message.type !== "text") return;
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

    if (lastMessageTime && now - lastMessageTime < COOLDOWN_MS) {
      console.log(`⚠️ Cooldown ativo para ${from}, ignorando mensagem`);
      return;
    }
    userCooldown.set(from, now);

    // ==================== PAUSA QUANDO HUMANO ASSUME ====================
    if (isHumanPauseActive(from)) {
      console.log(`⏸️ Bot pausado para ${from} porque humano assumiu`);
      return;
    }

    console.log(`📩 Mensagem de ${from}: ${userText}`);

    // guarda fala do cliente
    addToHistory(from, "user", userText);

    const systemPrompt = `
Você é a Lis, atendente da PlayPrime.

Regras:
- Seja simpática, objetiva e natural.
- Responda curto e de forma humana.
- Não repita saudação em toda mensagem.
- Nunca envie duas mensagens iguais.
- Se o cliente demonstrar que não precisa mais de ajuda, apenas encerre educadamente.
- Se o cliente quiser atendimento humano, informe que vai encaminhar.
- Se a conversa já estiver em andamento, responda direto ao ponto.
- Seu objetivo é ajudar e converter, sem parecer robô.
`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...getHistoryMessages(from)
    ];

    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages,
      max_tokens: 180,
    });

    let resposta = completion.choices?.[0]?.message?.content?.trim();

    if (!resposta) {
      resposta = "Oi! Como posso te ajudar?";
    }

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
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    // guarda fala da assistente
    addToHistory(from, "assistant", resposta);

    console.log(`✅ Resposta enviada para ${from}`);

  } catch (error) {
    console.error("❌ ERRO:", error.response?.data || error.message);
  }
});

// ==================== ROTA PARA PAUSAR BOT MANUALMENTE ====================
// Você pode chamar essa rota quando assumir atendimento humano
app.post("/pause-bot", express.json(), (req, res) => {
  try {
    const { user } = req.body;

    if (!user) {
      return res.status(400).json({ error: "Número do usuário é obrigatório" });
    }

    humanPausedUsers.set(user, Date.now());
    console.log(`⏸️ Bot pausado manualmente para ${user}`);

    return res.json({
      success: true,
      message: `Bot pausado para ${user} por 30 minutos`
    });
  } catch (error) {
    console.error("❌ ERRO AO PAUSAR BOT:", error.message);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// ==================== ROTA PARA REATIVAR BOT ====================
app.post("/resume-bot", express.json(), (req, res) => {
  try {
    const { user } = req.body;

    if (!user) {
      return res.status(400).json({ error: "Número do usuário é obrigatório" });
    }

    humanPausedUsers.delete(user);
    console.log(`▶️ Bot reativado manualmente para ${user}`);

    return res.json({
      success: true,
      message: `Bot reativado para ${user}`
    });
  } catch (error) {
    console.error("❌ ERRO AO REATIVAR BOT:", error.message);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// ==================== ROTA DE TESTE ====================
app.get("/", (req, res) => {
  res.send("LIS ONLINE ✅");
});

// ==================== INICIAR ====================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 LIS ONLINE | Modelo: ${MODEL_NAME} | Porta: ${PORT}`);
});
