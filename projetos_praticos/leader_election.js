import { createServer, createConnection } from "net";
import { createInterface } from "readline";

if (process.argv.length !== 3) {
  console.error("Uso: node mutual_exclusion.js <ID_DO_PROCESSO>");
  process.exit(1);
}

const PEERS = [
  { id: 1, host: "localhost", port: 8001 },
  { id: 2, host: "localhost", port: 8002 },
  { id: 3, host: "localhost", port: 8003 },
  { id: 4, host: "localhost", port: 8004 },
  { id: 5, host: "localhost", port: 8005 },
];

const myId = parseInt(process.argv[2]);

const me = PEERS.find((p) => p.id === myId);

let logicalClock = 0; // Pode ser mantido para timestamps, embora não seja central.

// --- NOVOS ESTADOS PARA ELEIÇÃO ---
let currentLeader = null;
let electionInProgress = false;
const ELECTION_TIMEOUT = 5000; // 5 segundos para esperar por uma resposta 'OK'
let electionTimer = null;
let heartbeatInterval = null;

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
    // A mensagem agora é enviada para todos, incluindo a si mesmo,
    // para simplificar o tratamento e garantir que o clock lógico seja manuseado de forma consistente.
    const socket = sockets[peer.id];

    if (peer.id === myId) {
      handleData(message);
    } else if (socket && !socket.destroyed) {
      send(socket, message);
    } else {
      // Não logar erro para processos offline, isso é esperado.
      // console.error(`Socket para o processo ${peer.id} não está conectado.`);
    }
  });
};

const handleData = (data) => {
  // Atualiza o clock lógico com base no timestamp da mensagem recebida
  logicalClock = Math.max(logicalClock, data.timestamp || 0) + 1;

  // Log removido daqui para não poluir com PING/PONG
  // log(`Recebeu dados: ${JSON.stringify(data)}`);

  switch (data.type) {
    case "ELECTION":
      handleElectionMessage(data);
      break;
    case "OK":
      handleOkMessage(data);
      break;
    case "COORDINATOR":
      handleCoordinatorMessage(data);
      break;
    case "PING":
      handlePing(data);
      break;
    case "PONG":
      // No momento, PONG é só para manter a conexão viva, sem lógica extra.
      break;
    default:
      log(`Recebeu mensagem de tipo desconhecido: ${data.type}`);
  }
};

const startElection = () => {
  if (electionInProgress) {
    log("Uma eleição já está em progresso. Aguardando resultado.");
    return;
  }

  log("Iniciando eleição...");
  electionInProgress = true;

  // Mensagens são enviadas apenas para processos com ID MENOR
  const lowerIdPeers = PEERS.filter((p) => p.id < myId);

  if (lowerIdPeers.length === 0) {
    // Se não há ninguém com ID menor, eu sou o líder.
    log("Nenhum processo com ID menor. Eu sou o líder.");
    becomeLeader();
    return;
  }

  log(
    `Enviando mensagem ELECTION para processos [${lowerIdPeers
      .map((p) => p.id)
      .join(", ")}]`
  );
  lowerIdPeers.forEach((peer) => {
    const socket = sockets[peer.id];
    if (socket && !socket.destroyed) {
      send(socket, { type: "ELECTION", senderId: myId });
    }
  });

  // Inicia um timer. Se não receber 'OK' a tempo, vira o líder.
  clearTimeout(electionTimer);
  electionTimer = setTimeout(() => {
    if (electionInProgress) {
      log("Timeout da eleição. Nenhum 'OK' recebido. Assumindo liderança.");
      becomeLeader();
    }
  }, ELECTION_TIMEOUT);
};

const handleElectionMessage = (data) => {
  const { senderId } = data;
  log(`Recebeu ELECTION de ${senderId}.`);

  // Responde com OK para mostrar que estou vivo
  const socket = sockets[senderId];
  if (socket && !socket.destroyed) {
    send(socket, { type: "OK", senderId: myId });
  }

  // Inicia minha própria eleição, já que há uma disputa
  startElection();
};

const handleOkMessage = (data) => {
  const { senderId } = data;
  log(`Recebeu 'OK' de ${senderId}, um processo com ID menor.`);

  // Como alguém com ID menor respondeu, eu não serei o líder.
  // Cancelo meu timeout e apenas aguardo a mensagem do novo coordenador.
  electionInProgress = false;
  clearTimeout(electionTimer);
};

const handleCoordinatorMessage = (data) => {
  const { leaderId } = data;

  if (leaderId === currentLeader) {
    // Anúncio redundante, apenas ignora.
    return;
  }

  log(`Processo ${leaderId} é o novo líder.`);
  currentLeader = leaderId;
  electionInProgress = false;
  clearTimeout(electionTimer);

  // Inicia (ou reinicia) o heartbeat para o novo líder
  setupHeartbeat();
};

const becomeLeader = () => {
  currentLeader = myId;
  electionInProgress = false;
  clearTimeout(electionTimer);
  log("Anunciando-me como o novo líder (COORDINATOR).");

  const message = {
    type: "COORDINATOR",
    leaderId: myId,
    timestamp: logicalClock++,
  };
  multicast(message);

  // O líder não precisa de heartbeat para si mesmo
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
};

const handlePing = (data) => {
  const { senderId } = data;
  const socket = sockets[senderId];
  if (socket && !socket.destroyed) {
    send(socket, { type: "PONG", senderId: myId });
  }
};

const setupHeartbeat = () => {
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;

  // Apenas processos não-líderes precisam verificar o líder
  if (myId !== currentLeader && currentLeader !== null) {
    heartbeatInterval = setInterval(() => {
      const leaderSocket = sockets[currentLeader];
      if (leaderSocket && !leaderSocket.destroyed) {
        // log(`Enviando PING para o líder ${currentLeader}`); // Log muito verboso, desativado
        send(leaderSocket, { type: "PING", senderId: myId });
      } else {
        log(`Falha ao enviar PING: líder ${currentLeader} parece ter falhado.`);
        clearInterval(heartbeatInterval);
        startElection();
      }
    }, 4000); // Envia um ping a cada 4 segundos
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
    // Inicia a primeira eleição assim que o sistema estiver pronto
    setTimeout(startElection, 1000);
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
        // Se a conexão com o líder falhar, inicia uma eleição
        if (peer.id === currentLeader) {
          log(
            `Conexão com o líder ${currentLeader} falhou. Iniciando eleição.`
          );
          startElection();
        }
        setTimeout(() => connectToPeer(peer), 3000);
      });

      socket.on("end", () => {
        log(`Desconectado do processo ${peer.id}.`);
        // Se a conexão com o líder for encerrada, inicia uma eleição
        if (peer.id === currentLeader) {
          log(
            `Conexão com o líder ${currentLeader} foi encerrada. Iniciando eleição.`
          );
          startElection();
        }
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
    // Se a conexão com o líder falhar, inicia uma eleição
    if (peer.id === currentLeader) {
      log(`Reconexão com o líder ${currentLeader} falhou. Iniciando eleição.`);
      startElection();
    }
    setTimeout(() => connectToPeer(peer), 3000);
  });

  socket.on("end", () => {
    log(`Desconectado do processo ${peer.id}.`);
    // Se a conexão com o líder for encerrada, inicia uma eleição
    if (peer.id === currentLeader) {
      log(
        `Conexão com o líder ${currentLeader} foi encerrada. Iniciando eleição.`
      );
      startElection();
    }
  });
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function showMenu() {
  console.log("\n----------------------------------------");
  console.log(`      *** ALGORITMO DE ELEIÇÃO (BULLY INVERTIDO) ***`);
  console.log(
    `      Líder Atual: ${
      currentLeader === null ? "Desconhecido" : currentLeader
    }`
  );
  console.log("----------------------------------------");
  console.log("1. Iniciar Eleição");
  console.log("2. Ver Estado Atual");
  console.log("3. Simular Falha (desliga o processo)");
  console.log("Pressione Ctrl+C para sair.");
  console.log("----------------------------------------");
  rl.question("Escolha uma opção > ", handleMenuChoice);
}

function handleMenuChoice(choice) {
  switch (choice.trim()) {
    case "1":
      log("Iniciando eleição manualmente...");
      startElection();
      setTimeout(showMenu, 200);
      break;
    case "2":
      viewStatus();
      setTimeout(showMenu, 200);
      break;
    case "3":
      log("Simulando falha...");
      process.exit(1); // Saída abrupta para simular falha
      break;
    default:
      console.log("Opção inválida. Tente novamente.");
      showMenu();
      break;
  }
}

function viewStatus() {
  log("--- Estado do Processo ---");
  console.log(`  - Meu ID: ${myId}`);
  console.log(
    `  - Líder Atual: ${
      currentLeader === null ? "Desconhecido (em eleição...)" : currentLeader
    }`
  );
  console.log(
    `  - Eleição em Progresso: ${electionInProgress ? "Sim" : "Não"}`
  );

  const peerStates = PEERS.map((peer) => {
    if (peer.id === myId) return `P${peer.id} (Eu)`;
    const socket = sockets[peer.id];
    const isActive = socket && !socket.destroyed;
    return `P${peer.id} (${isActive ? "Online" : "Offline"})`;
  });

  console.log(`  - Estado dos Pares: [${peerStates.join(", ")}]`);
  console.log("--------------------------");
}

rl.on("close", () => {
  log("Encerrando o processo.");
  process.exit(0);
});
