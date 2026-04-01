const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
app.use(express.json());

// =============================
// CONFIGURAÇÕES
// =============================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

if (!VERIFY_TOKEN || !ACCESS_TOKEN || !PHONE_NUMBER_ID || !OPENAI_API_KEY) {
  console.error("❌ Faltam variáveis de ambiente. Verifique o Render.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// =============================
// MEMÓRIA
// =============================
const memory = {};
const MAX_HISTORY = 20;

// =============================
// FUNÇÕES AUXILIARES
// =============================
function ensureMemory(from) {
  if (!memory[from]) memory[from] = [];
}

function pushMemory(from, role, content) {
  ensureMemory(from);
  memory[from].push({ role, content });

  if (memory[from].length > MAX_HISTORY) {
    memory[from] = memory[from].slice(-MAX_HISTORY);
  }
}

async function sendWhatsAppText(to, body) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function getMediaUrl(mediaId) {
  const response = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    }
  );

  return response.data.url;
}

async function downloadWhatsAppMedia(mediaUrl, outputPath) {
  const response = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
  });

  fs.writeFileSync(outputPath, response.data);
}

async function transcribeAudioFromWhatsApp(audioId) {
  const mediaUrl = await getMediaUrl(audioId);

  const tempPath = path.join(os.tmpdir(), `audio-${Date.now()}.ogg`);
  await downloadWhatsAppMedia(mediaUrl, tempPath);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "gpt-4o-mini-transcribe",
    });

    return transcription.text?.trim() || "";
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

function buildSystemPrompt() {
  return `
Você é a Lis, atendente virtual da PlayPrime IPTV.

PERSONALIDADE:
- Humana, simpática, objetiva e natural
- Fala como uma pessoa real no WhatsApp
- Frases curtas e claras
- Nunca pareça robótica
- Seja acolhedora, mas sem enrolar

OBJETIVO:
- Entender o que a pessoa quer
- Conduzir a conversa para teste, planos e fechamento
- Fazer a conversa avançar de forma leve

PLANOS:
- 1 tela: R$30
- 2 telas: R$50
- 3 telas: R$70

REGRAS:
- Não repetir perguntas
- Não mandar texto gigante
- Usar o contexto da conversa
- Fazer no máximo uma pergunta por vez
- Sempre tentar avançar para a próxima etapa
- Se a pessoa demonstrar interesse, conduza para fechar
- Se a pessoa estiver em dúvida, responda curto e com segurança
- Não invente informações técnicas que não estão disponíveis
- Não use linguagem engessada de robô
- Evite excesso de emojis; use poucos e bem

FLUXO IDEAL:
1. Descobrir se quer teste, planos ou tirar dúvida
2. Entender onde vai usar (TV, celular, TV Box, etc.)
3. Oferecer teste se fizer sentido
4. Apresentar o plano adequado
5. Conduzir para fechamento

FECHAMENTO:
Quando a pessoa quiser comprar, diga exatamente:
"Perfeito 😊 vou te encaminhar para finalizarmos agora:
https://wa.me/5521964816185"

ESTILO DE RESPOSTA:
- Sempre responda em português do Brasil
- Respostas curtas
- Naturais
- Diretas
- Com tom comercial leve
`;
}

async function generateLisReply(from, userText) {
  pushMemory(from, "user", userText);

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      ...memory[from],
    ],
  });

  let reply =
    response.output_text?.trim() ||
    "Me fala se você quer teste grátis ou conhecer os planos. 😊";

  pushMemory(from, "assistant", reply);

  return reply;
}

// =============================
// VERIFICAÇÃO WEBHOOK
// =============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// =============================
// RECEBER MENSAGENS
// =============================
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    let text = "";

    if (message.type === "text") {
      text = message.text?.body?.trim() || "";
    } else if (message.type === "audio") {
      const audioId = message.audio?.id;

      if (!audioId) {
        await sendWhatsAppText(
          from,
          "Recebi seu áudio, mas não consegui processar. Pode me mandar em texto? 🙂"
        );
        return res.sendStatus(200);
      }

      text = await transcribeAudioFromWhatsApp(audioId);
    } else {
      await sendWhatsAppText(
        from,
        "No momento consigo te atender melhor por texto e áudio. Me manda sua dúvida que eu te ajudo. 😊"
      );
      return res.sendStatus(200);
    }

    if (!text) {
      await sendWhatsAppText(
        from,
        "Não consegui entender sua mensagem. Pode me mandar de novo em texto ou áudio? 🙂"
      );
      return res.sendStatus(200);
    }

    console.log("Cliente:", text);

    const reply = await generateLisReply(from, text);

    console.log("Lis:", reply);

    await sendWhatsAppText(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error("ERRO:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// =============================
// START
// =============================
app.listen(PORT, () => {
  console.log(`🔥 BOT RODANDO NA PORTA ${PORT}`);
});
