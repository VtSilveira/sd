# Multicast Totalmente Ordenado com Relógios de Lamport

Este projeto é uma implementação em Node.js do algoritmo de multicast totalmente ordenado, utilizando relógios lógicos de Lamport para garantir que mensagens enviadas a um grupo de processos sejam recebidas e entregues na mesma ordem por todos os membros.

A solução é ideal para sistemas distribuídos que requerem consistência, como bancos de dados replicados, sistemas de colaboração em tempo real ou qualquer aplicação onde a ordem das operações é crucial.

## Funcionalidades

- **Ordem Total Garantida**: As mensagens são entregues na mesma sequência em todos os processos.
- **Tolerância a Atrasos de Rede**: O sistema lida corretamente com cenários onde os `ACKs` (confirmações) chegam antes das mensagens originais.
- **Comunicação via Sockets TCP**: Comunicação robusta e baseada em conexão entre os processos.
- **Interface Interativa**: Um menu de linha de comando permite enviar mensagens, visualizar a fila de mensagens pendentes e o histórico de mensagens já entregues.
- **Logs Detalhados**: O output do console mostra em detalhes o funcionamento do algoritmo (troca de ACKs, atualizações do relógio lógico, etc.) para fins de aprendizado e depuração.

## Pré-requisitos

- [Node.js](https://nodejs.org/) (versão 14 ou superior)

## Como Executar

O programa foi projetado para ser executado como múltiplos processos na mesma máquina, cada um em um terminal separado.

1.  Abra **três terminais** no diretório do projeto.
2.  Em cada terminal, execute o comando abaixo, substituindo `<ID_DO_PROCESSO>` por `1`, `2` e `3`, respectivamente.

**Terminal 1:**

```bash
node total_order_multicast.js 1
```

**Terminal 2:**

```bash
node total_order_multicast.js 2
```

**Terminal 3:**

```bash
node total_order_multicast.js 3
```

Após alguns instantes, cada processo se conectará aos outros, e o menu principal será exibido. Os logs detalhados do funcionamento do algoritmo serão exibidos diretamente no console.
