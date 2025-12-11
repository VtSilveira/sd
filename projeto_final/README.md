# Plataforma de Leilão Distribuída

Projeto final de Sistemas Distribuídos (2025). Plataforma de leilão online utilizando Kubernetes, Redis e Flask, com um agente de IA para processamento de resultados.

## Estrutura do Projeto

- `/app`: Código da aplicação Flask (API + Backend + SocketIO).
- `/worker`: Agente de IA (Worker) que processa leilões finalizados.
- `/k8s`: Manifestos Kubernetes.
- `/tests`: Testes automatizados.

## Como Executar Localmente (Docker Compose)

1. Instale as dependências:
   ```bash
   pip install -r requirements.txt
   ```
2. Inicie os serviços:
   ```bash
   docker compose up --build
   ```

## Como Implantar no Kubernetes

1. Aplique os manifestos:
   ```bash
   kubectl apply -f k8s/
   ```

## Funcionalidades

- Criação de leilões.
- Lances em tempo real (WebSockets).
- Notificações de novos lances.
- Processamento automático de resultados com IA.

