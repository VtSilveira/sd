import { createServer, createConnection } from "net";
import { createInterface } from "readline";

if (process.argv.length !== 3) {
  console.error("Uso: node total_order_multicast.js <ID_DO_PROCESSO>");
  process.exit(1);
}

const PEERS = [
  { id: 1, host: "localhost", port: 8001 },
  { id: 2, host: "localhost", port: 8002 },
  { id: 3, host: "localhost", port: 8003 },
];

const myId = parseInt(process.argv[2]);

const me = PEERS.find((p) => p.id === myId);

let logicalClock = 0;

let messageQueue = [];

let deliveredMessages = [];

const ackBuffer = new Map();

const sockets = {};

let menuActive = false;

if (!me) {
  console.error(
    `ID de processo inválido: ${myId}. IDs válidos são ${PEERS.map(
      (p) => p.id
    ).join(", ")}.`
  );
  process.exit(1);
}

const log = (message) =>
  console.log(`[Processo ${myId} | Clock: ${logicalClock}] ${message}`);

const send = (socket, data) => {
  socket.write(JSON.stringify(data) + "\n");
};

const multicast = (message) => {
  log(`Multicasting: ${JSON.stringify(message.content || message.type)}`);

  PEERS.forEach((peer) => {
    if (peer.id === myId) {
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

const handleData = (data) => {
  logicalClock = Math.max(logicalClock, data.timestamp) + 1;

  log(
    `Recebeu dados, novo clock: ${logicalClock}. Dados: ${JSON.stringify(data)}`
  );

  switch (data.type) {
    case "MESSAGE":
      handleNewMessage(data);
      break;
    case "ACK":
      handleAck(data);
      break;
  }

  deliverMessages();
};

const handleNewMessage = (data) => {
  const messageIdentifier = `${data.timestamp}:${data.senderId}`;

  const queueEntry = {
    content: data.content,
    timestamp: data.timestamp,
    senderId: data.senderId,
    acks: new Set(),
  };

  if (ackBuffer.has(messageIdentifier)) {
    queueEntry.acks = ackBuffer.get(messageIdentifier);
    ackBuffer.delete(messageIdentifier);
  }

  messageQueue.push(queueEntry);

  messageQueue.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.senderId - b.senderId;
  });

  log(`Mensagem "${data.content}" de ${data.senderId} adicionada à fila.`);

  logicalClock++;
  const ackMessage = {
    type: "ACK",
    originalTimestamp: data.timestamp,
    originalSenderId: data.senderId,
    ackSenderId: myId,
    timestamp: logicalClock,
  };
  multicast(ackMessage);
};

const handleAck = (data) => {
  const messageIdentifier = `${data.originalTimestamp}:${data.originalSenderId}`;
  const messageInQueue = messageQueue.find(
    (m) =>
      m.timestamp === data.originalTimestamp &&
      m.senderId === data.originalSenderId
  );

  if (messageInQueue) {
    messageInQueue.acks.add(data.ackSenderId);
    log(
      `ACK de ${data.ackSenderId} para a mensagem "${messageInQueue.content}" recebido.`
    );
  } else {
    if (!ackBuffer.has(messageIdentifier)) {
      ackBuffer.set(messageIdentifier, new Set());
    }
    ackBuffer.get(messageIdentifier).add(data.ackSenderId);
    log(
      `ACK "adiantado" de ${data.ackSenderId} para a mensagem (${messageIdentifier}) armazenado.`
    );
  }
};

const deliverMessages = () => {
  while (messageQueue.length > 0) {
    const head = messageQueue[0];

    const allAcksReceived = PEERS.every((peer) => head.acks.has(peer.id));

    if (allAcksReceived) {
      const deliveredMsg = messageQueue.shift();
      deliveredMessages.push(deliveredMsg);
      console.log("--------------------------------------------------");
      log(
        `ENTREGUE: "${deliveredMsg.content}" (de ${deliveredMsg.senderId} @ T=${deliveredMsg.timestamp})`
      );
      console.log("--------------------------------------------------");
    } else {
      break;
    }
  }
};

const server = createServer((socket) => {
  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString();
    let boundary = buffer.indexOf("\n");
    while (boundary !== -1) {
      const jsonStr = buffer.substring(0, boundary);
      buffer = buffer.substring(boundary + 1);
      if (jsonStr) {
        try {
          const parsedData = JSON.parse(jsonStr);
          handleData(parsedData);
        } catch (e) {
          console.error("Erro ao parsear JSON:", e);
        }
      }
      boundary = buffer.indexOf("\n");
    }
  });
});

server.listen(me.port, me.host, () => {
  log(`Servidor escutando em ${me.host}:${me.port}`);
  setTimeout(connectToPeers, 1000);
});

function attemptToShowMenu() {
  if (menuActive) return;

  const connectedPeers = Object.values(sockets).filter(
    (s) => s && !s.destroyed
  ).length;
  const requiredPeers = PEERS.length - 1;

  if (connectedPeers === requiredPeers) {
    menuActive = true;
    console.log(
      `\n[Processo ${myId}] Todos os processos estão conectados. Sistema pronto.`
    );
    showMenu();
  }
}

function connectToPeers() {
  log(
    `Aguardando conexão com os processos [${PEERS.filter((p) => p.id !== myId)
      .map((p) => p.id)
      .join(", ")}]...`
  );

  PEERS.forEach((peer) => {
    if (peer.id !== myId) {
      const socket = createConnection(
        { port: peer.port, host: peer.host },
        () => {
          log(`Conectado ao processo ${peer.id}`);
          sockets[peer.id] = socket;
          attemptToShowMenu();
        }
      );

      socket.on("error", (err) => {
        setTimeout(() => connectToPeer(peer), 3000);
      });

      socket.on("end", () => {
        log(`Desconectado do processo ${peer.id}.`);
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

  socket.on("error", () => {
    setTimeout(() => connectToPeer(peer), 3000);
  });

  socket.on("end", () => {
    log(`Desconectado do processo ${peer.id}.`);
  });
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function showMenu() {
  console.log("\n----------------------------------------");
  console.log("            *** MENU ***");
  console.log("1. Enviar nova mensagem multicast");
  console.log("2. Ver fila de mensagens (pendentes)");
  console.log("3. Ver mensagens entregues (histórico)");
  console.log("Pressione Ctrl+C para sair.");
  console.log("----------------------------------------");
  rl.question("Escolha uma opção > ", handleMenuChoice);
}

function handleMenuChoice(choice) {
  switch (choice.trim()) {
    case "1":
      rl.question("Digite a mensagem > ", handleMessageInput);
      break;
    case "2":
      viewMessageQueue();
      showMenu();
      break;
    case "3":
      viewDeliveredMessages();
      showMenu();
      break;
    default:
      console.log("Opção inválida. Tente novamente.");
      showMenu();
      break;
  }
}

function handleMessageInput(line) {
  const content = line.trim();

  if (content) {
    logicalClock++;

    const message = {
      type: "MESSAGE",
      content: content,
      senderId: myId,
      timestamp: logicalClock,
    };

    multicast(message);
  }

  setTimeout(showMenu, 100);
}

function viewMessageQueue() {
  log("--- Fila de Mensagens Atual ---");
  if (messageQueue.length === 0) {
    console.log(">> A fila está vazia.");
  } else {
    console.log('Formato: [Timestamp, Remetente] "Conteúdo" | ACKs recebidos');
    messageQueue.forEach((item, index) => {
      const isHead = index === 0 ? "=>" : "  ";
      const ackList = [...item.acks].sort().join(", ");
      console.log(
        `${isHead} ${index + 1}. [T:${item.timestamp}, De:${item.senderId}] "${
          item.content
        }" | ACKs: [${ackList}]`
      );
    });
  }
  console.log("---------------------------------");
}

function viewDeliveredMessages() {
  log("--- Histórico de Mensagens Entregues ---");
  if (deliveredMessages.length === 0) {
    console.log(">> Nenhuma mensagem foi entregue ainda.");
  } else {
    console.log('Formato: [Timestamp, Remetente] "Conteúdo"');
    deliveredMessages.forEach((item, index) => {
      console.log(
        `${index + 1}. [T:${item.timestamp}, De:${item.senderId}] "${
          item.content
        }"`
      );
    });
  }
  console.log("---------------------------------------");
}

rl.on("close", () => {
  log("Encerrando o processo.");
  process.exit(0);
});
