import { createServer, createConnection } from "net";
import { createInterface } from "readline";

if (process.argv.length !== 3) {
  console.error("Uso: node leader_election_wireless.js <ID_DO_PROCESSO>");
  process.exit(1);
}

const PEERS = [
  { id: 1, host: "localhost", port: 8001, capacity: 10 },
  { id: 2, host: "localhost", port: 8002, capacity: 20 },
  { id: 3, host: "localhost", port: 8003, capacity: 30 },
  { id: 4, host: "localhost", port: 8004, capacity: 40 },
  { id: 5, host: "localhost", port: 8005, capacity: 50 },
  { id: 6, host: "localhost", port: 8006, capacity: 60 },
  { id: 7, host: "localhost", port: 8007, capacity: 95 },
  { id: 8, host: "localhost", port: 8008, capacity: 80 },
  { id: 9, host: "localhost", port: 8009, capacity: 90 },
  { id: 10, host: "localhost", port: 8010, capacity: 100 }, // Melhor capacidade
];

// const TOPOLOGY = {
//   1: [2, 3],
//   2: [1, 4, 5],
//   3: [1, 6],
//   4: [2, 7],
//   5: [2, 8],
//   6: [3, 9],
//   7: [4, 10],
//   8: [5, 9, 10],
//   9: [6, 8],
//   10: [7, 8],
// };

const TOPOLOGY = {
  1: [2, 3],
  2: [1, 4, 5],
  3: [1, 6, 7],
  4: [2, 8, 9],
  5: [2, 10],
  6: [3],
  7: [3],
  8: [4],
  9: [4],
  10: [5],
}; // formato de arvore

const DELAY = 1500; // Delay para facilitar a observação

const myId = parseInt(process.argv[2]);
const me = PEERS.find((p) => p.id === myId);

let currentLeader = null;
const elections = {}; // Armazena o estado das eleições em que o processo participa
// Formato: { $electionId: { parent, children, acks, bestInSubtree } }

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

const log = (message) => console.log(`[Processo ${myId}] ${message}`);

const send = (socket, data) => {
  if (socket && !socket.destroyed) {
    socket.write(JSON.stringify(data) + "\n");
  }
};

const broadcast = (message) => {
  log(`Broadcast: ${JSON.stringify(message.type)} para todos os processos.`);
  PEERS.forEach((peer) => {
    if (peer.id === myId) {
      handleData(message);
    } else {
      send(sockets[peer.id], message);
    }
  });
};

const handleData = (data) => {
  switch (data.type) {
    case "ELECTION":
      handleElectionMessage(data);
      break;
    case "ACK":
      handleAckMessage(data);
      break;
    case "COORDINATOR":
      handleCoordinatorMessage(data);
      break;
    default:
      log(`Recebeu mensagem de tipo desconhecido: ${data.type}`);
  }
};

const startElection = () => {
  const electionId = myId; // O ID do iniciador serve como ID da eleição
  log(`Iniciando eleição com ID ${electionId}.`);

  // Abandona qualquer eleição com ID menor
  Object.keys(elections).forEach((eid) => {
    if (eid < electionId) {
      log(`Abandonando eleição anterior ${eid}.`);
      delete elections[eid];
    }
  });

  // Inicia o estado para esta eleição
  elections[electionId] = {
    parent: null, // O iniciador é a raiz
    children: [],
    acks: new Set(),
    bestInSubtree: { id: me.id, capacity: me.capacity },
  };

  const neighbors = TOPOLOGY[myId] || [];
  elections[electionId].children = [...neighbors];

  if (neighbors.length === 0) {
    log("Nenhum vizinho para contatar. Eu sou o líder.");
    announceLeader(electionId, me.id);
    return;
  }

  log(`Enviando mensagem ELECTION para vizinhos [${neighbors.join(", ")}].`);
  setTimeout(() => {
    neighbors.forEach((neighborId) => {
      send(sockets[neighborId], {
        type: "ELECTION",
        electionId,
        senderId: myId,
      });
    });
  }, DELAY);
};

const handleElectionMessage = (data) => {
  const { electionId, senderId } = data;
  log(`Recebeu ELECTION (ID: ${electionId}) de ${senderId}.`);

  // Regra de desempate: só participa da eleição com maior ID
  const activeElectionIds = Object.keys(elections).map(Number);
  if (activeElectionIds.some((eid) => eid > electionId)) {
    log(
      `Ignorando eleição ${electionId}, pois já participo de uma com ID maior.`
    );
    return;
  }

  // Abandona eleições com ID menor
  activeElectionIds.forEach((eid) => {
    if (eid < electionId) {
      log(`Abandonando eleição ${eid} em favor da ${electionId}.`);
      delete elections[eid];
    }
  });

  // Se já faz parte desta eleição (recebeu de outro nó), apenas ACKnowledges (EVITAR LOOP)
  if (elections[electionId]) {
    log(
      `Já participo da eleição ${electionId}. Apenas respondendo a ${senderId}.`
    );
    send(sockets[senderId], {
      type: "ACK",
      electionId,
      senderId: myId,
      bestNode: { id: -1, capacity: -1 }, // ACK "vazio" para indicar que já tenho pai
    });
    return;
  }

  // Junta-se à eleição
  elections[electionId] = {
    parent: senderId,
    children: [],
    acks: new Set(),
    bestInSubtree: { id: me.id, capacity: me.capacity },
  };

  const neighborsToForward = (TOPOLOGY[myId] || []).filter(
    (n) => n !== senderId
  );

  elections[electionId].children = [...neighborsToForward];

  if (neighborsToForward.length === 0) {
    // É um nó folha na árvore de eleição
    log("Sou um nó folha. Enviando ACK para o pai.");
    setTimeout(() => {
      send(sockets[senderId], {
        type: "ACK",
        electionId,
        senderId: myId,
        bestNode: elections[electionId].bestInSubtree,
      });
    }, DELAY);
  } else {
    log(
      `Repassando ELECTION para vizinhos [${neighborsToForward.join(", ")}].`
    );
    setTimeout(() => {
      neighborsToForward.forEach((neighborId) => {
        send(sockets[neighborId], {
          type: "ELECTION",
          electionId,
          senderId: myId,
        });
      });
    }, DELAY);
  }
};

const handleAckMessage = (data) => {
  const { electionId, senderId, bestNode } = data;

  if (!elections[electionId]) {
    // Pode ter abandonado a eleição, então ignora o ACK
    return;
  }

  elections[electionId].acks.add(senderId);

  if (bestNode.capacity !== -1) {
    log(
      `Recebeu ACK para eleição ${electionId} de ${senderId} com melhor nó: ${JSON.stringify(
        bestNode
      )}.`
    );
    // Atualiza o melhor nó da sub-árvore
    if (bestNode.capacity > elections[electionId].bestInSubtree.capacity) {
      elections[electionId].bestInSubtree = bestNode;
    }
  } else {
    log(
      `Recebeu ACK de reconhecimento de ${senderId} para eleição ${electionId}.`
    );
  }

  // Verifica se todos os filhos responderam
  if (
    elections[electionId].acks.size === elections[electionId].children.length
  ) {
    const electionState = elections[electionId];
    if (electionState.parent === null) {
      // Sou o iniciador, a eleição terminou.
      log("Recebi ACK de todos os filhos. Eleição concluída.");
      setTimeout(() => {
        announceLeader(electionId, electionState.bestInSubtree.id);
      }, DELAY);
    } else {
      // Repassa o ACK para o pai
      log(`Enviando ACK agregado para o pai ${electionState.parent}.`);
      setTimeout(() => {
        send(sockets[electionState.parent], {
          type: "ACK",
          electionId,
          senderId: myId,
          bestNode: electionState.bestInSubtree,
        });
      }, DELAY);
    }
  }
};

const announceLeader = (electionId, leaderId) => {
  log(`O melhor nó é ${leaderId}. Anunciando como novo líder.`);
  currentLeader = leaderId;
  broadcast({
    type: "COORDINATOR",
    leaderId,
  });
  // Limpa o estado da eleição concluída
  delete elections[electionId];
};

const handleCoordinatorMessage = (data) => {
  const { leaderId } = data;
  if (currentLeader !== leaderId) {
    log(`Processo ${leaderId} é o novo líder.`);
    currentLeader = leaderId;
  }
  // Limpa todos os estados de eleição, pois um líder foi definido
  Object.keys(elections).forEach((eid) => delete elections[eid]);
  if (menuActive) {
    setTimeout(showMenu, 200); // Atualiza o menu com o novo líder
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

  if (connectedPeers >= requiredPeers) {
    menuActive = true;
    console.log(
      `\n[Processo ${myId}] Todos os outros processos estão conectados. Sistema pronto.`
    );
    showMenu();
  }
}

function connectToPeers() {
  log(
    `Tentando conexão com os processos [${PEERS.filter((p) => p.id !== myId)
      .map((p) => p.id)
      .join(", ")}]...`
  );

  PEERS.forEach((peer) => {
    if (peer.id !== myId) {
      connectToPeer(peer);
    }
  });
}

function connectToPeer(peer) {
  if (sockets[peer.id] && !sockets[peer.id].destroyed) return;

  const socket = createConnection({ port: peer.port, host: peer.host }, () => {
    log(`Conectado ao processo ${peer.id}`);
    sockets[peer.id] = socket;
    attemptToShowMenu();
  });

  socket.on("error", () => {
    // Como não há falhas, apenas tenta reconectar
    setTimeout(() => connectToPeer(peer), 5000);
  });

  socket.on("end", () => {
    log(`Desconectado do processo ${peer.id}.`);
    // Como não há falhas, apenas tenta reconectar
    setTimeout(() => connectToPeer(peer), 5000);
  });
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function showMenu() {
  console.log("\n----------------------------------------");
  console.log(`      *** ALGORITMO DE ELEIÇÃO (WIRELESS) ***`);
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
  console.log(`  - Meu ID: ${myId} (Capacidade: ${me.capacity})`);
  console.log(
    `  - Líder Atual: ${
      currentLeader === null ? "Desconhecido" : currentLeader
    }`
  );

  const activeElections = Object.keys(elections);
  if (activeElections.length > 0) {
    console.log("  - Participando das Eleições:");
    activeElections.forEach((eid) => {
      const state = elections[eid];
      console.log(`    - Eleição ID ${eid}:`);
      console.log(
        `      - Pai: ${
          state.parent === null ? "Nenhum (Iniciador)" : state.parent
        }`
      );
      console.log(
        `      - Esperando ACKs de: [${state.children
          .filter((c) => !state.acks.has(c))
          .join(", ")}]`
      );
      console.log(
        `      - Melhor nó na sub-árvore: ${JSON.stringify(
          state.bestInSubtree
        )}`
      );
    });
  } else {
    console.log("  - Não participando de nenhuma eleição no momento.");
  }

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
