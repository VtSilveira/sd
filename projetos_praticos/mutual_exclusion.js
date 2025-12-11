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

const resources = {
  r1: {
    state: "RELEASED", // RELEASED, WANTED, HELD
    my_timestamp: null,
    replies_received: new Set(),
    deferred_queue: [],
  },
  r2: {
    state: "RELEASED", // RELEASED, WANTED, HELD
    my_timestamp: null,
    replies_received: new Set(),
    deferred_queue: [],
  },
};

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
    const socket = sockets[peer.id];

    if (peer.id === myId) {
      handleData(message);
    } else if (socket && !socket.destroyed) {
      send(socket, message);
    } else {
      console.error(`Socket para o processo ${peer.id} não está conectado.`);
    }
  });
};

const handleData = (data) => {
  logicalClock = Math.max(logicalClock, data.timestamp) + 1;

  log(
    `Recebeu dados, novo clock: ${logicalClock}. Dados: ${JSON.stringify(data)}`
  );

  switch (data.type) {
    case "REQUEST":
      handleResourceRequest(data);
      break;
    case "REPLY":
      handleResourceReply(data);
      break;
  }
};

const requestResource = (resourceId) => {
  if (!resources[resourceId]) {
    log(`Erro: Recurso "${resourceId}" desconhecido.`);
    return;
  }

  const resource = resources[resourceId];

  if (resource.state !== "RELEASED") {
    log(`Erro: Já solicitou ou está com o recurso "${resourceId}".`);
    return;
  }

  logicalClock++;
  resource.state = "WANTED";
  resource.my_timestamp = logicalClock;
  resource.replies_received.add(myId); // Adiciona o próprio "reply"

  log(
    `Solicitando recurso "${resourceId}" com timestamp ${resource.my_timestamp}`
  );

  const requestMessage = {
    type: "REQUEST",
    resourceId: resourceId,
    senderId: myId,
    timestamp: resource.my_timestamp,
  };

  multicast(requestMessage);
};

const releaseResource = (resourceId) => {
  if (!resources[resourceId]) {
    log(`Erro: Recurso "${resourceId}" desconhecido.`);
    return;
  }

  const resource = resources[resourceId];

  if (resource.state !== "HELD") {
    log(`Erro: Você não está com o recurso "${resourceId}" para liberá-lo.`);
    return;
  }

  resource.state = "RELEASED";
  resource.my_timestamp = null;
  resource.replies_received.clear();

  log(`Recurso "${resourceId}" liberado.`);
  log(
    `Enviando replies para a fila de espera: [${resource.deferred_queue
      .map((p) => p.senderId)
      .join(", ")}]`
  );

  resource.deferred_queue.forEach((req) => {
    logicalClock++;
    const replyMessage = {
      type: "REPLY",
      resourceId: resourceId,
      senderId: myId,
      timestamp: logicalClock,
      recipientId: req.senderId,
      status: "OK",
    };

    const peer = PEERS.find((p) => p.id === req.senderId);
    if (peer) {
      if (peer.id === myId) {
        handleData(replyMessage);
      } else {
        const socket = sockets[peer.id];
        if (socket && !socket.destroyed) {
          send(socket, replyMessage);
        }
      }
    }
  });

  resource.deferred_queue = [];
};

const handleResourceRequest = (data) => {
  const { resourceId, senderId, timestamp } = data;
  const resource = resources[resourceId];

  log(`Recebeu REQUEST para "${resourceId}" de ${senderId} (T=${timestamp})`);

  let should_defer = false;

  if (resource.state === "HELD") {
    should_defer = true;
    log(
      `Estou com "${resourceId}", respondendo BUSY para a requisição de ${senderId}.`
    );
  } else if (resource.state === "WANTED") {
    // Desempate: timestamp menor vence. Se igual, ID menor vence.
    if (
      resource.my_timestamp < timestamp ||
      (resource.my_timestamp === timestamp && myId < senderId)
    ) {
      should_defer = true;
      log(
        `Eu quero "${resourceId}" e minha prioridade é maior. Respondendo BUSY para ${senderId}. (Meu T=${resource.my_timestamp} vs T=${timestamp})`
      );
    }
  }

  const replyStatus = should_defer ? "BUSY" : "OK";

  if (should_defer) {
    resource.deferred_queue.push(data);
  }

  log(
    `Enviando REPLY '${replyStatus}' para ${senderId} sobre "${resourceId}".`
  );
  logicalClock++;
  const replyMessage = {
    type: "REPLY",
    resourceId: resourceId,
    senderId: myId,
    timestamp: logicalClock,
    recipientId: senderId,
    status: replyStatus, // 'OK' ou 'BUSY'
  };

  const peer = PEERS.find((p) => p.id === senderId);
  if (peer) {
    if (peer.id === myId) {
      handleData(replyMessage);
    } else {
      const socket = sockets[peer.id];
      if (socket && !socket.destroyed) {
        send(socket, replyMessage);
      }
    }
  }
};

const handleResourceReply = (data) => {
  const { resourceId, senderId, status } = data;
  const resource = resources[resourceId];

  if (resource.state !== "WANTED") {
    log(
      `Recebeu REPLY para "${resourceId}" de ${senderId}, mas não estou mais no estado WANTED. Ignorando.`
    );
    return;
  }

  if (status === "BUSY") {
    log(
      `Recebeu REPLY 'BUSY' para "${resourceId}" de ${senderId}. Aguardando...`
    );
    return;
  }

  log(`Recebeu REPLY 'OK' para "${resourceId}" de ${senderId}.`);
  resource.replies_received.add(senderId);

  log(
    `Replies 'OK' para "${resourceId}": [${[...resource.replies_received].join(
      ", "
    )}] (${resource.replies_received.size}/${PEERS.length})`
  );

  if (resource.replies_received.size === PEERS.length) {
    resource.state = "HELD";
    resource.my_timestamp = null;
    resource.replies_received.clear();
    console.log("--------------------------------------------------");
    log(`>>> ACESSO OBTIDO AO RECURSO "${resourceId}" <<<`);
    console.log("--------------------------------------------------");
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
  console.log("MENU: EXCLUSÃO MÚTUA (Ricart & Agrawala)");
  console.log("----------------------------------------");
  console.log("1. Solicitar recurso R1");
  console.log("2. Liberar recurso R1");
  console.log("3. Solicitar recurso R2");
  console.log("4. Liberar recurso R2");
  console.log("5. Ver estado dos recursos");
  console.log("Pressione Ctrl+C para sair.");
  console.log("----------------------------------------");
  rl.question("Escolha uma opção > ", handleMenuChoice);
}

function handleMenuChoice(choice) {
  switch (choice.trim()) {
    case "1":
      requestResource("r1");
      setTimeout(showMenu, 200);
      break;
    case "2":
      releaseResource("r1");
      setTimeout(showMenu, 200);
      break;
    case "3":
      requestResource("r2");
      setTimeout(showMenu, 200);
      break;
    case "4":
      releaseResource("r2");
      setTimeout(showMenu, 200);
      break;
    case "5":
      viewResourceStatus();
      setTimeout(showMenu, 200);
      break;
    default:
      console.log("Opção inválida. Tente novamente.");
      showMenu();
      break;
  }
}

function viewResourceStatus() {
  log("--- Estado dos Recursos ---");
  for (const resourceId in resources) {
    const resource = resources[resourceId];
    console.log(`Recurso: ${resourceId.toUpperCase()}`);
    console.log(`  - Estado: ${resource.state}`);
    if (resource.state === "WANTED") {
      console.log(`  - Timestamp da Requisição: ${resource.my_timestamp}`);
      console.log(
        `  - Replies Recebidos: ${resource.replies_received.size}/${PEERS.length}`
      );
    }
    if (resource.deferred_queue.length > 0) {
      console.log(
        `  - Fila de Espera: [${resource.deferred_queue
          .map((r) => `P${r.senderId}@T${r.timestamp}`)
          .join(", ")}]`
      );
    }
  }
  console.log("---------------------------");
}

rl.on("close", () => {
  log("Encerrando o processo.");
  process.exit(0);
});
