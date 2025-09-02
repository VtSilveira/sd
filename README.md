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

## Testes e Resultados Esperados

Aqui estão alguns cenários de teste que você pode executar para verificar a corretude do algoritmo. Os logs detalhados que aparecem no terminal são essenciais para observar o comportamento interno do sistema.

---

### Teste 1: Ordem de Entrega Simples

Este teste verifica se mensagens enviadas em sequência por diferentes processos são entregues na mesma ordem por todos.

**Passos:**

1. Inicie os três processos.
2. No processo 1 (P1), envie a mensagem "A".
3. Imediatamente depois, no processo 2 (P2), envie a mensagem "B".

**Resultado Esperado:**

- Todos os três processos (P1, P2 e P3) devem entregar as mensagens **exatamente na mesma ordem**.
- A ordem específica (`A` antes de `B`, ou `B` antes de `A`) dependerá de qual mensagem obteve o menor timestamp de Lamport. O importante é a consistência.
- A saída da entrega da mensagem em **todos** os terminais será semelhante a esta (a ordem e os valores do relógio podem variar, mas a sequência de entrega será a mesma):
  ```
  --------------------------------------------------
  [Processo 1 | Clock: 5] ENTREGUE: "A" (de 1 @ T=1)
  --------------------------------------------------
  --------------------------------------------------
  [Processo 1 | Clock: 8] ENTREGUE: "B" (de 2 @ T=2)
  --------------------------------------------------
  ```

---

### Teste 2: Mensagens Quase Simultâneas

Este teste valida o mecanismo de desempate do algoritmo (que usa o ID do processo quando os timestamps são iguais).

**Passos:**

1. Inicie os três processos.
2. Tente enviar uma mensagem de P1 e P2 o mais rápido possível, quase simultaneamente.

**Resultado Esperado:**

- Devido à natureza do relógio de Lamport e ao critério de desempate, as mensagens serão ordenadas de forma consistente.
- Se a mensagem de P1 (com ID menor) tiver um timestamp menor ou igual à mensagem de P2, ela será entregue primeiro em todos os processos.
- A ordem final de entrega será idêntica em todos os terminais.

---

### Teste 3: Verificação da Fila de Pendentes

Este teste demonstra como as mensagens aguardam na fila até serem consideradas "estáveis" (reconhecidas por todos).

**Passos:**

1. Inicie os processos.
2. Em P1, envie uma mensagem, por exemplo, "Teste Fila".
3. Rapidamente, antes que a mensagem seja entregue, use a **opção 2 ("Ver fila de mensagens")** em P2 e P3.

**Resultado Esperado:**

- Ao visualizar a fila em P2 e P3, você verá a mensagem "Teste Fila" na lista de pendentes.
- Você também poderá observar a lista de ACKs associada a ela. Inicialmente, ela pode ter apenas o ACK do próprio processo que a recebeu.
- A lista de ACKs crescerá à medida que as confirmações dos outros processos chegam, o que pode ser visto nos logs.
- A mensagem só desaparecerá da fila de pendentes e será movida para o histórico (opção 3) quando a lista de ACKs contiver `[1, 2, 3]`.

---

### Teste 4: Robustez a Atrasos (Cenário do ACK Adiantado)

Este é um teste mais avançado que pode ser simulado para validar a robustez do sistema contra atrasos na rede.

**Contexto:** O código já lida com isso, e os logs ajudam a confirmar. O cenário é: P3 recebe um ACK sobre uma mensagem M1 (enviada por P1) antes de ter recebido a própria M1.

**Como Simular (mentalmente ou com modificações no código):**

1. Imagine que P1 envia M1.
2. P2 recebe M1 rapidamente e envia seu `ACK(M1)` para todos.
3. A rede entre P2 e P3 é rápida, mas a rede entre P1 e P3 está lenta.
4. P3 recebe `ACK(M1)` de P2. Neste momento, P3 ainda não sabe o que é M1.

**Resultado Esperado (implementado no código):**

- O processo P3, ao receber o `ACK(M1)` adiantado, o armazenará em um buffer temporário. O log mostrará `ACK "adiantado" ... armazenado`.
- Quando a mensagem M1 finalmente chegar de P1, P3 verifica o buffer e encontra o ACK que já havia sido guardado.
- A mensagem M1 é então colocada na fila já com o ACK de P2 contabilizado.
- No final, a ordem de entrega é preservada, e o sistema não trava nem se comporta de maneira inconsistente.
