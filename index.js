const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
app.use(express.json());

// =============================
// CONFIG
// =============================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "lis_token_123";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const PORT = process.env.PORT || 3000;

// =============================
// MEMÓRIA + CONTROLE
// =============================
const memory = {};
const MAX_HISTORY = 20;

// anti duplicação
const processedMessages = new Set();
const processingUsers = new Set();

// =============================
// FUNÇÕES
// =============================
function pushMemory(from, role, content) {
  if (!memory[from]) memory[from] = [];

  memory[from].push({ role, content });

  if (memory[from].length > MAX_HISTORY) {
    memory[from] = memory[from].slice(-MAX_HISTORY);
  }
}

async function sendWhatsApp(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function getAudioText(audioId) {
  try {
    const media = await axios.get(
      `https://graph.facebook.com/v19.0/${audioId}`,
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      }
    );

    const url = media.data.url;

    const file = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    const temp = path.join(os.tmpdir(), `audio-${Date.now()}.ogg`);
    fs.writeFileSync(temp, file.data);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(temp),
      model: "gpt-4o-mini-transcribe",
    });

    fs.unlinkSync(temp);

    return transcription.text;
  } catch (e) {
    console.log("Erro áudio:", e.message);
    return "";
  }
}

function promptBase() {
  return `
Você é a Lis, atendente da PlayPrime IPTV.

Fale como humano no WhatsApp.
Seja simpática, direta e natural.

OBJETIVO:
Vender e conduzir a conversa.

PLANOS:
1 tela: R$30
2 telas: R$50
3 telas: R$70

REGRAS:
- Respostas curtas
- Não parecer robô
- Fazer 1 pergunta por vez
- Sempre avançar a conversa
- Não repetir perguntas

FECHAMENTO:
"Perfeito 😊 vou te encaminhar para finalizarmos agora:
https://wa.me/5521964816185"
`;
}

async function gerarResposta(from, text) {
  pushMemory(from, "user", text);

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: promptBase() },
      ...memory[from],
    ],
  });

  const reply =
    response.output_text ||
    "Você quer testar ou conhecer os planos? 😊";

  pushMemory(from, "assistant", reply);

  return reply;
}

// =============================
// WEBHOOK
// =============================
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const change = req.body.entry?.[0]?.changes?.[0]?.value;

    if (!change?.messages) return res.sendStatus(200);

    const message = change.messages[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const messageId = message.id;

    // =====================
    // ANTI DUPLICAÇÃO
    // =====================
    if (processedMessages.has(messageId)) {
      console.log("Duplicada ignorada");
      return res.sendStatus(200);
    }

    processedMessages.add(messageId);
    setTimeout(() => processedMessages.delete(messageId), 300000);

    // trava concorrência
    if (processingUsers.has(from)) {
      console.log("Já processando...");
      return res.sendStatus(200);
    }

    processingUsers.add(from);

    // =====================
    // TEXTO / ÁUDIO
    // =====================
    let text = "";

    if (message.type === "text") {
      text = message.text.body;
    }

    if (message.type === "audio") {
      text = await getAudioText(message.audio.id);
    }

    if (!text) {
      processingUsers.delete(from);
      return res.sendStatus(200);
    }

    console.log("Cliente:", text);

    const resposta = await gerarResposta(from, text);

    console.log("Lis:", resposta);

    await sendWhatsApp(from, resposta);

    processingUsers.delete(from);

    res.sendStatus(200);
  } catch (e) {
    console.log("ERRO:", e.message);
    res.sendStatus(200);
  }
});

// =============================
app.get("/", (req, res) => {
  res.send("Lis rodando ✅");
});

// =============================
app.listen(PORT, () => {
  console.log("🔥 Rodando na porta", PORT);
});
