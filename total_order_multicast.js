import { createServer, createConnection } from 'net';
import { createInterface } from 'readline';

// --- Configuração dos Processos (Peers) ---
// Cada processo no grupo precisa conhecer todos os outros.
const PEERS = [
    { id: 1, host: 'localhost', port: 8001 },
    { id: 2, host: 'localhost', port: 8002 },
    { id: 3, host: 'localhost', port: 8003 },
];

// --- Verificação dos Argumentos da Linha de Comando ---
if (process.argv.length !== 3) {
    console.error('Uso: node total_order_multicast.js <ID_DO_PROCESSO>');
    process.exit(1);
}

const myId = parseInt(process.argv[2]);
const me = PEERS.find(p => p.id === myId);

if (!me) {
    console.error(`ID de processo inválido: ${myId}. IDs válidos são ${PEERS.map(p => p.id).join(', ')}.`);
    process.exit(1);
}

// --- Estado do Processo ---
let logicalClock = 0;
// Fila de mensagens recebidas, aguardando para serem entregues.
// Cada item: { message, timestamp, senderId, acks: Set<number> }
let messageQueue = [];
// Histórico de mensagens que já foram entregues à aplicação.
let deliveredMessages = [];
// Buffer para ACKs que chegam antes da mensagem original.
// Chave: "timestamp:senderId", Valor: Set<number> de IDs que enviaram ACK.
const ackBuffer = new Map();
const sockets = {}; // Armazena as conexões TCP de saída para outros processos.

let menuActive = false; // Flag para garantir que o menu seja mostrado apenas uma vez.

// --- Funções Auxiliares ---

// Função para logar com o ID do processo e o tempo do relógio.
const log = (message) => console.log(`[Processo ${myId} | Clock: ${logicalClock}] ${message}`);

// Envia dados para um socket específico, garantindo que seja um JSON delimitado por nova linha.
const send = (socket, data) => {
    socket.write(JSON.stringify(data) + '\n');
};

// Faz o multicast de uma mensagem para todos os processos no grupo (incluindo ele mesmo).
const multicast = (message) => {
    log(`Multicasting: ${JSON.stringify(message.content || message.type)}`);
    PEERS.forEach(peer => {
        if (peer.id === myId) {
            // Se for para si mesmo, processa localmente.
            handleData(message);
        } else {
            const socket = sockets[peer.id];
            if (socket && !socket.destroyed) {
                send(socket, message);
            } else {
                console.error(`Socket para o processo ${peer.id} não está conectado.`);
            }
        }
    });
};

// Função principal para processar mensagens recebidas (seja localmente ou pela rede).
const handleData = (data) => {
    // Atualiza o relógio lógico de acordo com a regra de Lamport.
    logicalClock = Math.max(logicalClock, data.timestamp) + 1;
    log(`Recebeu dados, novo clock: ${logicalClock}. Dados: ${JSON.stringify(data)}`);

    switch (data.type) {
        case 'MESSAGE':
            handleNewMessage(data);
            break;
        case 'ACK':
            handleAck(data);
            break;
    }

    // Após qualquer mudança (nova mensagem ou novo ACK), tenta entregar mensagens.
    deliverMessages();
};

const handleNewMessage = (data) => {
    const messageIdentifier = `${data.timestamp}:${data.senderId}`;

    // Cria a entrada da mensagem para a fila.
    const queueEntry = {
        content: data.content,
        timestamp: data.timestamp,
        senderId: data.senderId,
        acks: new Set(),
    };

    // Verifica se já existem ACKs "adiantados" para esta mensagem no buffer.
    if (ackBuffer.has(messageIdentifier)) {
        queueEntry.acks = ackBuffer.get(messageIdentifier);
        ackBuffer.delete(messageIdentifier); // Remove do buffer, pois agora a mensagem chegou.
    }

    messageQueue.push(queueEntry);

    // Mantém a fila ordenada por timestamp (e por ID do remetente como desempate).
    messageQueue.sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
            return a.timestamp - b.timestamp;
        }
        return a.senderId - b.senderId;
    });

    log(`Mensagem "${data.content}" de ${data.senderId} adicionada à fila.`);

    // Envia um ACK para esta mensagem.
    logicalClock++;
    const ackMessage = {
        type: 'ACK',
        originalTimestamp: data.timestamp,
        originalSenderId: data.senderId,
        ackSenderId: myId,
        timestamp: logicalClock, // Timestamp do ACK.
    };
    multicast(ackMessage);
};

const handleAck = (data) => {
    const messageIdentifier = `${data.originalTimestamp}:${data.originalSenderId}`;
    const messageInQueue = messageQueue.find(
        m => m.timestamp === data.originalTimestamp && m.senderId === data.originalSenderId
    );

    if (messageInQueue) {
        // Se a mensagem já está na fila, adiciona o ACK.
        messageInQueue.acks.add(data.ackSenderId);
        log(`ACK de ${data.ackSenderId} para a mensagem "${messageInQueue.content}" recebido.`);
    } else {
        // Se a mensagem ainda não chegou, armazena o ACK no buffer.
        if (!ackBuffer.has(messageIdentifier)) {
            ackBuffer.set(messageIdentifier, new Set());
        }
        ackBuffer.get(messageIdentifier).add(data.ackSenderId);
        log(`ACK "adiantado" de ${data.ackSenderId} para a mensagem (${messageIdentifier}) armazenado.`);
    }
};

// Verifica se alguma mensagem na frente da fila pode ser entregue.
const deliverMessages = () => {
    while (messageQueue.length > 0) {
        const head = messageQueue[0];

        // Uma mensagem pode ser entregue se todos os processos enviaram um ACK para ela.
        const allAcksReceived = PEERS.every(peer => head.acks.has(peer.id));

        if (allAcksReceived) {
            // Remove da fila e move para a lista de entregues.
            const deliveredMsg = messageQueue.shift();
            deliveredMessages.push(deliveredMsg);
            console.log('--------------------------------------------------');
            log(`ENTREGUE: "${deliveredMsg.content}" (de ${deliveredMsg.senderId} @ T=${deliveredMsg.timestamp})`);
            console.log('--------------------------------------------------');
        } else {
            // Se a mensagem na cabeça da fila não pode ser entregue, nenhuma outra pode.
            break;
        }
    }
};

// --- Configuração do Servidor TCP ---
const server = createServer(socket => {
    let buffer = '';
    socket.on('data', data => {
        buffer += data.toString();
        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
            const jsonStr = buffer.substring(0, boundary);
            buffer = buffer.substring(boundary + 1);
            if (jsonStr) {
                try {
                    const parsedData = JSON.parse(jsonStr);
                    handleData(parsedData);
                } catch (e) {
                    console.error('Erro ao parsear JSON:', e);
                }
            }
            boundary = buffer.indexOf('\n');
        }
    });
});

server.listen(me.port, me.host, () => {
    log(`Servidor escutando em ${me.host}:${me.port}`);
    // Atraso para dar tempo aos outros servidores de subirem antes de tentar conectar.
    setTimeout(connectToPeers, 1000);
});

// --- Lógica de Conexão com outros Processos ---
function attemptToShowMenu() {
    if (menuActive) return;

    const connectedPeers = Object.values(sockets).filter(s => s && !s.destroyed).length;
    const requiredPeers = PEERS.length - 1;

    if (connectedPeers === requiredPeers) {
        menuActive = true;
        console.log(`\n[Processo ${myId}] Todos os processos estão conectados. Sistema pronto.`);
        showMenu();
    }
}

function connectToPeers() {
    log(`Aguardando conexão com os processos [${PEERS.filter(p => p.id !== myId).map(p => p.id).join(', ')}]...`);
    PEERS.forEach(peer => {
        if (peer.id !== myId) {
            const socket = createConnection({ port: peer.port, host: peer.host }, () => {
                log(`Conectado ao processo ${peer.id}`);
                sockets[peer.id] = socket;
                attemptToShowMenu();
            });

            socket.on('error', (err) => {
                setTimeout(() => connectToPeer(peer), 3000);
            });

            socket.on('end', () => {
                log(`Desconectado do processo ${peer.id}.`);
                // Poderíamos adicionar lógica para re-esconder o menu se um par cair.
            });
        }
    });
}

function connectToPeer(peer) {
    if (sockets[peer.id] && !sockets[peer.id].destroyed) return;

    const socket = createConnection({ port: peer.port, host: peer.host }, () => {
        log(`Reconectado ao processo ${peer.id}`);
        sockets[peer.id] = socket;
        attemptToShowMenu();
    });

    socket.on('error', () => {
        setTimeout(() => connectToPeer(peer), 3000);
    });

    socket.on('end', () => {
        log(`Desconectado do processo ${peer.id}.`);
    });
}


// --- Interface para Envio de Mensagens pelo Usuário ---
const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

function showMenu() {
    console.log('\n----------------------------------------');
    console.log('            *** MENU ***');
    console.log('1. Enviar nova mensagem multicast');
    console.log('2. Ver fila de mensagens (pendentes)');
    console.log('3. Ver mensagens entregues (histórico)');
    console.log('Pressione Ctrl+C para sair.');
    console.log('----------------------------------------');
    rl.question('Escolha uma opção > ', handleMenuChoice);
}

function handleMenuChoice(choice) {
    switch (choice.trim()) {
        case '1':
            rl.question('Digite a mensagem > ', handleMessageInput);
            break;
        case '2':
            viewMessageQueue();
            showMenu();
            break;
        case '3':
            viewDeliveredMessages();
            showMenu();
            break;
        default:
            console.log('Opção inválida. Tente novamente.');
            showMenu();
            break;
    }
}

function handleMessageInput(line) {
    const content = line.trim();
    if (content) {
        logicalClock++;
        const message = {
            type: 'MESSAGE',
            content: content,
            senderId: myId,
            timestamp: logicalClock,
        };
        multicast(message);
    }
    // Volta para o menu após o envio
    setTimeout(showMenu, 100); // Pequeno delay para a saída do multicast não se misturar com o menu
}

function viewMessageQueue() {
    log('--- Fila de Mensagens Atual ---');
    if (messageQueue.length === 0) {
        console.log('>> A fila está vazia.');
    } else {
        console.log('Formato: [Timestamp, Remetente] "Conteúdo" | ACKs recebidos');
        messageQueue.forEach((item, index) => {
            const isHead = index === 0 ? '=>' : '  ';
            const ackList = [...item.acks].sort().join(', ');
            console.log(
                `${isHead} ${index + 1}. [T:${item.timestamp}, De:${item.senderId}] "${item.content}" | ACKs: [${ackList}]`
            );
        });
    }
    console.log('---------------------------------');
}

function viewDeliveredMessages() {
    log('--- Histórico de Mensagens Entregues ---');
    if (deliveredMessages.length === 0) {
        console.log('>> Nenhuma mensagem foi entregue ainda.');
    } else {
        console.log('Formato: [Timestamp, Remetente] "Conteúdo"');
        deliveredMessages.forEach((item, index) => {
            console.log(
                `${index + 1}. [T:${item.timestamp}, De:${item.senderId}] "${item.content}"`
            );
        });
    }
    console.log('---------------------------------------');
}


rl.on('close', () => {
    log('Encerrando o processo.');
    process.exit(0);
});

// Inicia a aplicação mostrando o menu pela primeira vez.
// A chamada a showMenu() foi movida para a lógica de conexão.
