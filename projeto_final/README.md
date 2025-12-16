# Plataforma de Leilão Distribuída

Plataforma de leilão online com:

- API Flask + SocketIO para criação de leilões, lances em tempo real e monitor de encerramento.
- Redis para estado e Pub/Sub (eventos de lances e encerramento).
- Worker de IA que, ao receber leilões finalizados, gera relatórios/mensagens via Gemini e opcionalmente envia para Discord.
- Orquestração com Docker Compose e Kubernetes (múltiplas réplicas com message_queue no SocketIO via Redis).

## Estrutura

- `/app`: API Flask, rotas REST, SocketIO, monitor de leilões e integração Redis.
- `/worker`: Worker que assina `leiloes_finalizados` no Redis, chama Gemini e envia Discord.
- `/k8s`: Manifestos Kubernetes (ConfigMap/Secret, Deployments/Services, HPA).
- `/tests`: Locust para teste de carga.

## Fluxo em alto nível

1. Usuários criam leilões e dão lances via API/SocketIO.
2. `auction_monitor` encerra leilões expirados, publica em `leiloes_finalizados`.
3. Worker consome o evento, gera relatório/e-mail/post (mock ou Gemini) e dispara para Discord se configurado.
4. Eventos de tempo real (lances/encerramento) são distribuídos entre réplicas via SocketIO + Redis (message_queue).

## Variáveis de ambiente (principais)

- `GEMINI_API_KEY` (obrigatória para usar Gemini; sem ela fica em modo mock).
- `GEMINI_MODEL` (padrão: `gemini-2.5-flash`).
- `DISCORD_WEBHOOK_URL` (opcional; se vazio, não envia).
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB` (já setadas em compose/k8s).

## Como rodar com Docker Compose

Pré-requisitos: Docker/Compose instalados.

1. (Opcional) Crie `.env` com:
   ```
   GEMINI_API_KEY=...        # ou deixe vazio para mock
   GEMINI_MODEL=gemini-2.5-flash
   DISCORD_WEBHOOK_URL=...   # opcional
   ```
2. Suba tudo:
   ```bash
   docker compose up --build
   ```
3. Acesse a UI: http://localhost:5000
4. Logs em tempo real:
   ```bash
   docker compose logs -f api
   docker compose logs -f worker
   ```

## Como rodar no Kubernetes (ex.: Minikube)

1. Inicie o cluster:
   ```bash
   minikube start
   eval $(minikube docker-env)
   ```
2. Build das imagens no daemon do Minikube:
   ```bash
   docker build -t api:latest -f Dockerfile.api .
   docker build -t worker:latest -f Dockerfile.worker .
   ```
3. Crie o Secret com suas chaves:
   ```bash
   kubectl delete secret app-secrets --ignore-not-found
   kubectl create secret generic app-secrets \
     --from-literal=GEMINI_API_KEY=SUACHAVE \
     --from-literal=DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```
4. Aplique os manifestos:
   ```bash
   kubectl apply -f k8s/
   ```
5. Exponha a API:
   ```bash
   kubectl port-forward svc/api-service 5000:80
   ```
6. Acesse a UI: http://localhost:5000
7. Logs:
   ```bash
   kubectl logs -f -l app=api
   kubectl logs -f -l app=worker
   ```

## Explicação dos Dockerfiles

- `Dockerfile.api`: Python 3.9 slim, instala requirements, copia `/app`, expõe 5000 e roda `app.py` (Flask+SocketIO, threading).
- `Dockerfile.worker`: Python 3.9 slim, instala requirements, copia `/worker`, roda `worker.py` (listener Redis, Gemini/Discord).

## Explicação dos manifestos Kubernetes (`/k8s`)

- `config.yaml`: ConfigMap (`REDIS_HOST/PORT`, `GEMINI_MODEL`) e Secret (`GEMINI_API_KEY`, `DISCORD_WEBHOOK_URL`).
- `redis.yaml`: Deployment + Service do Redis.
- `api.yaml`: Deployment da API (3 réplicas), Service (LoadBalancer/NodePort) e HPA. SocketIO usa Redis como message_queue para distribuir eventos entre réplicas.
- `worker.yaml`: Deployment do worker (1 réplica), lê ConfigMap/Secret e assina `leiloes_finalizados`.

## Teste de carga (Locust)

1. Instale locust localmente: `pip install locust`
2. Rode:
   ```bash
   locust -f tests/locustfile.py
   ```
3. Interface: http://localhost:8089
   - Host: `http://localhost:5000` (compose ou port-forward do k8s).
   - Ajuste `on_start` se não quiser criar muitos leilões por usuário.
