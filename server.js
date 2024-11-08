require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const { Client, GatewayIntentBits , ChannelType} = require('discord.js');
const { saveOrFetchThread, getChannelIdByWhatsappId, saveChannelId } = require('./pg')
// Cria uma nova instância do bot com as intents necessárias
const discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers
    ],
  });
  
  discord.login(process.env.TOKEN_DISCORD);

// Inicializando o servidor

const app = express();

async function sendMessageDiscord(guild, whatsappNumber, messageContent, userName) {
  let channelId = await getChannelIdByWhatsappId(whatsappNumber)
  let channel = null

  if(channelId) {
    channel = guild.channels.cache.get(channelId)
    if (!channel) {
      console.log(`Canal com ID ${channelId} não encontrado. Criando um novo canal...`);
    } else {
      console.log(`Canal já existe para ${userName} com ID: ${channelId}. Enviando mensagem...`);
    }
  }

  // Se o canal não existir, cria um novo
  if (!channel) {
    const channelName = `canal-${whatsappNumber}-${userName}`;
    console.log(`Criando novo canal para o ${userName}...`);
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: `Canal criado para o WhatsApp: ${whatsappNumber}`,
    });

    // Armazena o ID do novo canal no banco de dados
    await saveChannelId(whatsappNumber, channel.id);

    console.log(`Canal criado com ID: ${channel.id} e armazenado para ${userName}`);
  }

  // Envia a mensagem para o canal
  await channel.send(messageContent);
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuração Twilio e OpenAI
const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.API_KEY,
});

// Variáveis para controlar o temporizador e threads dos usuários
let messageAccumulator = {}; // Armazena as mensagens acumuladas por usuário
let timers = {}; // Armazena os temporizadores de cada usuário
let currentSteps = {}; // Armazena o estado atual de contagem regressiva por usuário
const timeSteps = [10, 10, 10, 10, 10]; // Temporizadores progressivos
let isProcessing = {}; // Armazena o estado de processamento de cada usuário

// Função que reseta o temporizador e acumula as mensagens para cada usuário
function resetTimer(newMessage, from, userName) {
  // Inicializa o acumulador de mensagens, se ainda não existir
  if (!messageAccumulator[from]) {
    messageAccumulator[from] = [];
  }
  messageAccumulator[from].push(newMessage); // Acumula as mensagens do usuário

  // Reseta o contador para o próximo valor
  if (timers[from]) {
    clearTimeout(timers[from]); // Limpa o temporizador anterior do usuário
  }

  // Se o step atual ultrapassar o limite, ele permanece no último step
  if (!currentSteps[from]) {
    currentSteps[from] = 0;
  }
  if (currentSteps[from] >= timeSteps.length) {
    currentSteps[from] = timeSteps.length - 1;
  }

  console.log(`Reseta o timer para ${timeSteps[currentSteps[from]]} segundos para o usuário: ${from}`);

  countdown(timeSteps[currentSteps[from]], async () => {
    if (!isProcessing[from]) {
      await processMessages(from, userName); // Processa as mensagens acumuladas quando o tempo termina
    }
  });

  currentSteps[from]++; // Incrementa o passo de contagem regressiva
}

// Função de contagem regressiva
function countdown(seconds, callback) {
  let timeLeft = seconds;

  const interval = setInterval(() => {
    readline.cursorTo(process.stdout, 0); // Move o cursor para o início da linha
    process.stdout.write(`Tempo restante: ${timeLeft}s`); // Escreve o tempo no terminal
    readline.clearLine(process.stdout, 1); // Limpa a linha anterior
    timeLeft--;

    if (timeLeft < 0) {
      clearInterval(interval);
      callback(); // Chama o callback quando o tempo termina
    }
  }, 1000);
}

// Função para processar as mensagens acumuladas
async function processMessages(from, userName) {
  if (messageAccumulator[from].length === 0) {
    return;
  }

  isProcessing[from] = true; // Inicia o processamento
  const assistant = 'asst_KnVqNQZsCjimPVnq96mAnMOJ';

  // Verifica se já existe um threadId para o usuário no arquivo JSON
  let thread = await saveOrFetchThread(from)

  const accumulatedContent = messageAccumulator[from].join(' '); // Junta todas as mensagens acumuladas
  await messageCreate(thread, accumulatedContent, userName); // Envia todas as mensagens acumuladas para a thread

  const createRun = await runCreate(thread, assistant);
  const runID = createRun.id;

  // Verifica o status e exibe a resposta gerada
  await checkRunStatus(thread, runID);
  await retrieveAssistantResponse(thread, from, userName);

  // Reset após o processamento
  messageAccumulator[from] = [];
  currentSteps[from] = 0; // Reseta o passo do tempo
  isProcessing[from] = false; // Libera o processamento para o próximo ciclo
}





// Função para adicionar mensagens na thread
async function messageCreate(thread, content, userName) {
  const dataAtual = new Date();

const opcoesFormato = {
  timeZone: 'America/Sao_Paulo', // Fuso horário para Mato Grosso do Sul (MS)
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'long' // Nome do dia da semana completo
};

const data = new Intl.DateTimeFormat('pt-BR', opcoesFormato).format(dataAtual);
    const date = `Horário em Cascavel PR: ${data}`
console.log(date);
   
  if (!content) {
    console.error('Erro: Conteúdo da mensagem vazio.');
    return;
  }

  const threadMessages = await openai.beta.threads.messages.create(
    thread,
    { role: "user", content: `Pergunta do Usuário: ${content}. \n ${date}\n Nome do usuário: ${userName}` },
    
  );
  return threadMessages;
}

// Função para criar o run
async function runCreate(thread, assistant) {
  const run = await openai.beta.threads.runs.create(
    thread,
    { assistant_id: assistant }
  );
  return run;
}

// Função para verificar o status do run
async function checkRunStatus(thread, run) {
  try {
    let isCompleted = false;
    
    while (!isCompleted) {
      const response = await openai.beta.threads.runs.retrieve(
        thread, run
      );
      console.log(`Status atual do run: ${response.status}`);
      if (response.status === 'completed') {
        isCompleted = true;
        console.log('Run completado com sucesso!');
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, 15000)); // Espera 10 segundos antes de checar novamente
    }
  } catch (error) {
    console.error('Erro ao verificar o status do run:', error);
  }
}

// Função para extrair todos os links do texto
function extractLinksFromText(text) {
  // Expressão regular para capturar URLs (http, https, etc.)
  const urlRegex = /(https?:\/\/[^\s\)]+)/g; 
  const links = text.match(urlRegex); // Extrai todos os links
  
  return links || [];  // Retorna um array de links ou um array vazio se não encontrar
}


const sendMediaToWhatsApp = async (to, mediaUrl) => {
  try {
    await client.messages.create({
      mediaUrl: [mediaUrl],  // Passa a URL da mídia
      from: 'whatsapp:+14155238886',  // Seu número de WhatsApp no Twilio
      to: to
    });
    console.log('Mídia enviada:', mediaUrl);
  } catch (error) {
    console.error('Erro ao enviar mídia:', error);
  }
};

// Função para processar e enviar os links um após o outro
const processAndSendMedia = async (to, responseText) => {
  const links = await extractLinksFromText(responseText); // Extrai todos os links
  console.log("Links extraídos:", links);

  if (links.length === 0 ) {
    console.log("Nenhum link encontrado.");
    return;
  }

  // Enviar cada link de forma sequencial
  
  for (const link of links) {
    await sendMediaToWhatsApp(to, link);
  }
}


function cleanMarkdown(text) {
  // Remove imagens: ![alt text](url)
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');

  // Remove links: [text](url)
  text = text.replace(/\[.*?\]\(.*?\)/g, '');

  // Remove qualquer URL simples
  text = text.replace(/https?:\/\/[^\s]+/g, '');

  // Remove cabeçalhos como **Texto** ou negritos
  text = text.replace(/\*\*(.*?)\*\*/g, '');

  // Remove linhas adicionais ou espaços extras
  return text.replace(/\s\s+/g, ' ').trim();
}


// Função para recuperar a resposta do assistente e fragmentar a mensagem
async function retrieveAssistantResponse(threadId, to, userName) {
  const messages = await openai.beta.threads.messages.list(threadId);
  const assistantMessage = messages.data.find(message => message.role === 'assistant');
  
  if (assistantMessage && assistantMessage.content.length > 0) {
    let responseText = assistantMessage.content[0].text.value;
   
 
    const server = '1303379760797450260'
   const guild = discord.guilds.cache.get(server)

   if(!guild){
    return res.status(500).json({error: 'Servidor não encontrado para o bot'})
  } 

  try {
    const agente = `Resposta do agente: ${responseText}`
    await sendMessageDiscord(guild, to, agente, userName)
  }catch (error) {
    console.error('Erro ao processar a mensagem: ', error)
  }

      if (responseText.includes('#R')) {
        responseText = responseText.replace('#R', '');

        const serverId = '1303379837284651090'; // Substitua pelo ID do servidor correto
const channelId = '1303379837284651093'; // Substitua pelo ID do canal correto
     // Busca o servidor específico
const guild = discord.guilds.cache.get(serverId);

if (guild) {
  // Busca o canal específico dentro do servidor
  const canal = guild.channels.cache.get(channelId);
  if (canal) {
    canal.send(`O ${userName} fez uma ultima analise:
      \nSegue os dados coletados: 
      
      \n${responseText}`);
  } else {
    console.log('Canal não encontrado no servidor especificado');
  }
} else {
  console.log('Servidor não encontrado');
}
      }


 



    if (responseText.toLowerCase().includes('.jpg') || 
    responseText.toLowerCase().includes('.jpeg') ||
    responseText.toLowerCase().includes('.png') || 
    responseText.toLowerCase().includes('.gif') || 
    responseText.toLowerCase().includes('.mp4') || 
    responseText.toLowerCase().includes('.pdf')) {
    
    await processAndSendMedia(to, responseText)

    console.log(responseText)


} 
/**Tratamento de texto caso tenha midias  */
if (responseText.includes('arquivosdemidia.s3.amazonaws.com') ) {
  responseText = await cleanMarkdown(responseText)
   }

// Fragmenta a mensagem em pedaços menores
const fragments = splitMessageBySentences(responseText, 200); // Ajusta o tamanho máximo por fragmento

// Simula a entrega dos fragmentos com intervalos de 2 segundos
simulateMessageDelivery(fragments, 5000, to);

 } else {
    console.log('No assistant response found.');
  }
}

function splitMessageBySentences(message, maxLength) {
    let fragments = [];
    
    // Remove números no começo de listas, como "1.", "2)" etc.
    let cleanedMessage = message.replace(/^\d+\.\s|\d+\)\s/gm, '');  // Remove números no início de cada linha
    
    // Ajusta o negrito do WhatsApp: transforma **negrito** em *negrito* para manter o padrão do WhatsApp
    cleanedMessage = cleanedMessage.replace(/\*\*(.*?)\*\*/g, '*$1*');

    cleanedMessage = cleanedMessage.replace(/【\d+:\d+†[^\]]+\】/g, '');
  

    let sentences = cleanedMessage.split(/(?<=[.!?])\s+/); // Fragmenta sentenças

  

    let currentFragment = '';
    for (let i = 0; i < sentences.length; i++) {
        let sentence = sentences[i];

        // Adiciona a sentença ao fragmento atual
        if ((currentFragment + sentence).length > maxLength) {
            fragments.push(currentFragment.trim()); // Adiciona o fragmento acumulado
            currentFragment = ''; // Limpa para começar o novo fragmento
        }
        currentFragment += sentence + ' '; // Continua acumulando sentenças
    }

    // Adiciona o fragmento final se houver
    if (currentFragment.trim().length > 0) {
        fragments.push(currentFragment.trim());
    }
   
    return fragments;
}



// Função que simula a entrega dos fragmentos com intervalos
function simulateMessageDelivery(fragments, interval, to) {
  fragments.forEach((fragment, index) => {


    setTimeout(() => {
      client.messages
        .create({
          body: fragment,
          from: 'whatsapp:+14155238886',  // Seu número de WhatsApp no Twilio
          to: to
        })
        .then((message) => {
          console.log(`Mensagens enviada com sucesso para ${to}. SID: ${message.sid}`);
        })
        .catch((err) => {
          console.error('Erro ao enviar fragmento:', err);
        });
    }, index * interval);  // Intervalo entre cada fragmento
  });
}

// Fila para armazenar os áudios recebidos
let audioQueue = [];
let isProcessingAudio = false; // Controle para verificar se o áudio está sendo processado

// Função para adicionar áudios na fila
function addToQueue(mediaUrl, From, ProfileName) {
  audioQueue.push({ mediaUrl, From }); // Adiciona o áudio à fila
  processAudioQueue(ProfileName); // Inicia o processamento da fila
}

// Função que processa a fila de áudios
async function processAudioQueue(ProfileName) {
  if (isProcessingAudio || audioQueue.length === 0) {
    // Se já estiver processando ou a fila estiver vazia, retorna
    return;
  }

  isProcessingAudio = true; // Sinaliza que o processamento começou

  const { mediaUrl, From } = audioQueue.shift(); // Remove o primeiro item da fila
  try {
    const filePath = await downloadAudioTwilio(mediaUrl, From); // Faz o download do áudio
    const transcricao = await transcreverAudio(filePath); // Transcreve o áudio
    console.log('Transcrição:', transcricao);
    

     
    const server = '1303379760797450260'
   const guild = discord.guilds.cache.get(server)

    if (!guild) {
      return console.log('Servidor não encontrado para o contato.')
    }
  
    try {
       const transcriptionsAudio = `Audio transcrito do contato ${ProfileName}: ${transcricao}`
      await sendMessageDiscord(guild, From, transcriptionsAudio, ProfileName);
    } catch (error) {
      console.error('Erro ao processar a mensagem:', error);
    }

    if (!fs.existsSync(filePath)) {
      console.error('Arquivo não encontrado no caminho:', filePath);
      return;
    }

    resetTimer(transcricao, From)

  } catch (error) {
    console.error('Erro ao processar o áudio:', error);
  } finally {
    isProcessingAudio = false; // Finaliza o processamento atual
    processAudioQueue(); // Processa o próximo item na fila (se houver)
  }
}

// Função para fazer o download da mídia (atualizada para salvar em /tmp)
async function downloadAudioTwilio(MediaUrl0, From) {
  const dir = '/tmp';
  const fileName = `${From}-${Date.now()}.ogg`;
  const filePath = path.resolve(dir, fileName);

  // Verifica se o diretório existe e o cria se necessário
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    // Função para tentar baixar o áudio
    const attemptDownload = async () => {
      try {
        const response = await axios({
          url: MediaUrl0,
          method: 'GET',
          responseType: 'stream',
          auth: {
            username: process.env.ACCOUNT_SID,
            password: process.env.AUTH_TOKEN,
          },
        });

        // Verifica o status da resposta
        if (response.status === 200) {
          clearInterval(intervalId); // Para o intervalo ao encontrar o áudio
          console.log(`Áudio disponível, prosseguindo com o download: ${filePath}`);

          const writer = fs.createWriteStream(filePath);
          response.data.pipe(writer);

          writer.on('finish', () => {
            console.log(`Áudio baixado com sucesso: ${filePath}`);
            resolve(filePath); // Resolve a Promise com o caminho do arquivo baixado
          });

          writer.on('error', (err) => {
            console.error('Erro ao salvar a mídia:', err);
            reject(err); // Rejeita a Promise em caso de erro ao salvar
          });
        } else {
          console.log(`Status inesperado ao verificar áudio: ${response.status}`);
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log('Áudio ainda não disponível, tentando novamente em 2 segundos...');
        } else {
          console.error('Erro ao tentar baixar o áudio:', error);
          clearInterval(intervalId); // Para o intervalo em caso de erro irreversível
          reject(error); // Rejeita a Promise em caso de erro
        }
      }
    };

      // Define um intervalo para verificar a disponibilidade do áudio a cada 2 segundos
      const intervalId = setInterval(attemptDownload, 2000);
    });
  }

async function transcreverAudio(filePath) {
  
    try {
      const audioStream = fs.createReadStream(filePath);

      // Faz a requisição para o OpenAI usando o arquivo como stream
      const response = await openai.audio.transcriptions.create({
        file: audioStream,
        model: 'whisper-1',
        response_format: 'text',
      });

      return response; // Retorna a resposta da transcrição
    } catch (error) {
      console.error("Erro ao transcrever o áudio:", error);
      
    }
  }


/** Logica para processamento de imagens  */
// Fila para armazenar as imagens recebidas
let imageQueue = [];
let isProcessingImage = false; // Controle para verificar se a imagem está sendo processada

// Função para adicionar imagens na fila
function addToQueueImage(mediaUrl, From, userName) {
  imageQueue.push({ mediaUrl, From }); // Adiciona a imagem à fila
  processImageQueue(userName); // Inicia o processamento da fila
}

// Função para verificar e processar as imagens acumuladas na fila
async function processImageQueue(userName) {
  if (isProcessingImage || imageQueue.length === 0) {
    // Se já estiver processando ou a fila estiver vazia, retorna
    return;
  }

  isProcessingImage = true; // Sinaliza que o processamento começou


  const { mediaUrl, From } = imageQueue.shift(); // Remove o primeiro item da fila

  try {
    const filePath = await downloadImageTwilio(mediaUrl, From, userName); // Faz o download da imagem
    
    if (!fs.existsSync(filePath)) {
      console.error('Arquivo não encontrado no caminho:', filePath);
      return;
    }

    await processMessageImage(filePath, From, userName);

    
  } catch (error) {
    console.error('Erro ao processar a imagem:', error);
  } finally {
    isProcessingImage = false; // Finaliza o processamento atual
    processImageQueue(); // Processa o próximo item na fila (se houver)
  }
}

// Função para fazer o download da imagem do Twilio

async function downloadImageTwilio(MediaUrl0, From, ProfileName) {
  const dir = '/tmp'; // Diretório temporário do Heroku
  const sanitizedFrom = From.replace(/\+/g, ''); // Remove caracteres especiais
  const fileName = `${sanitizedFrom}-${Date.now()}.jpeg`; // Nome do arquivo com timestamp
  const filePath = path.resolve(dir, fileName); // Caminho completo para o arquivo

  // Verifica se o diretório existe e o cria se necessário
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    // Função para tentar baixar a imagem
    const attemptDownload = async () => {
      try {
        const response = await axios({
          url: MediaUrl0,
          method: 'GET',
          responseType: 'stream',
          auth: {
            username: process.env.ACCOUNT_SID,
            password: process.env.AUTH_TOKEN,
          },
        });

        // Verifica o status da resposta
        if (response.status === 200) {
          clearInterval(intervalId); // Para o intervalo ao encontrar a imagem
          console.log(`Imagem disponível, prosseguindo com o download: ${filePath}`);

          const writer = fs.createWriteStream(filePath);
          response.data.pipe(writer);

          writer.on('finish', async () => {
            console.log('Imagem baixada e salva em /tmp:', filePath);

            // Envia uma mensagem para o Discord informando sobre a imagem
            try {
              const server = '1303783417867141140';
              const guild = discord.guilds.cache.get(server);
              if (!guild) {
                console.log('Servidor não encontrado para o contato.');
                return;
              }

              const imageFile = `Imagem enviada do contato ${ProfileName}: ${fileName}`;
              await handleWhatsappMessage(guild, From, imageFile, ProfileName);
              resolve(filePath); // Resolve a Promise com o caminho do arquivo salvo
            } catch (error) {
              console.error('Erro ao processar a mensagem para o Discord:', error);
              reject(error);
            }
          });

          writer.on('error', (err) => {
            console.error('Erro ao salvar a imagem:', err);
            reject(err); // Rejeita a Promise em caso de erro ao salvar
          });
        } else {
          console.log(`Status inesperado ao verificar imagem: ${response.status}`);
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log('Imagem ainda não disponível, tentando novamente em 2 segundos...');
        } else {
          console.error('Erro ao tentar baixar a imagem:', error);
          clearInterval(intervalId); // Para o intervalo em caso de erro irreversível
          reject(error); // Rejeita a Promise em caso de erro
        }
      }
    };

    // Define um intervalo para verificar a disponibilidade da imagem a cada 2 segundos
    const intervalId = setInterval(attemptDownload, 2000);
  });
}


async function uploadImageToOpenAI(filePath) {
  try {
    // Cria um stream para o arquivo
    const fileStream = fs.createReadStream(filePath);

    // Faz o upload do arquivo para OpenAI
    const uploadedFile = await openai.files.create({
      file: fileStream,
      purpose: "vision", // ou "fine-tune", dependendo da finalidade
    });

    console.log('Arquivo enviado para OpenAI, file_id:', uploadedFile.id);
    return uploadedFile.id; // Retorna o ID do arquivo
  } catch (error) {
    console.error('Erro ao enviar o arquivo para OpenAI:', error);
    throw error;
  }
}

async function messageThreadImage(threadIdR, fileId) {
      
  const messageThread = await openai.beta.threads.messages.create(
     threadIdR, // thread ID
     {
       role: "user", // Defina o papel do remetente da mensagem
       content: [
         {
           type: "image_file", // tipo de conteúdo
           image_file: {
             file_id: fileId, // Usando o file_id retornado após o upload
           },
         },
       ],
     }
   );
   return messageThread.id
 } 
async function processMessageImage(filePath, from, userName) {
 
  
  try {
    const assistant = 'asst_KnVqNQZsCjimPVnq96mAnMOJ';
   
    
  // Verifica se já existe um threadId para o usuário no arquivo JSON
  let thread = await saveOrFetchThread(from)


    // Verifica se o arquivo existe antes de tentar processá-lo
    if (!fs.existsSync(filePath)) {
      console.error('Arquivo não encontrado no caminho:', filePath);
      return;
    }

    const fileId = await uploadImageToOpenAI(filePath); // Obtenha o file_id

    if (!fileId) {
      throw new Error('fileId não definido após o upload da imagem.');
    }
    

    // Tenta enviar a mensagem com o file_id obtido após o upload
    console.log('Tentando enviar arquivo com file_id:', fileId);

   await messageThreadImage(thread, fileId)
    const createRun = await runCreate(thread, assistant);
   const runID = createRun.id;
 
   // Verifica o status e exibe a resposta gerada
   await checkRunStatus(thread, runID);
   await retrieveAssistantResponse( thread, from, userName);
   
    
  } catch (error) {
    console.error('Erro ao processar mensagem com imagem:', error);
    throw error; // Lança o erro para ser tratado fora desta função
  }



}





// Endpoint que receberá as mensagens do Twilio
app.post('/', async (req, res) => {
  const { Body, From, MessageType, NumMedia, MediaUrl0, ProfileName } = req.body; // Captura o corpo da mensagem e o número do remetente

  if (!From) {
    console.error('Erro: Mensagem ou número do remetente ausente.');
    return res.status(400).send('Mensagem ou número do remetente ausente.');
  }

  console.log(`Mensagem recebida de ${From}: ${Body}`);
  
  if (MessageType === 'text' && NumMedia == 0) {
    resetTimer(Body, From, ProfileName ); // Reseta o timer sempre que uma nova mensagem é recebida
    
    const server = '1303379760797450260'
   const guild = discord.guilds.cache.get(server)

   if(!guild){
    return res.status(500).json({error: 'Servidor não encontrado para o bot'})
  } 

  try {
    const questionUser = `Pergunta do contato: ${Body}`
    await sendMessageDiscord(guild, From, questionUser, ProfileName)
  }catch (error) {
    console.error('Erro ao processar a mensagem: ', error)
  }
  }
  
  if (MessageType === 'audio' && NumMedia == 1) {
    addToQueue(MediaUrl0, From, ProfileName);
  }

  if (MessageType === 'image' && NumMedia == 1) {
    addToQueueImage(MediaUrl0, From, ProfileName) 
  }


  res.status(200).send('Mensagem recebida e processamento iniciado.');
});

const port = process.env.PORT || 3000;  // Heroku vai definir process.env.PORT

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
