# Tutorial para vídeo — Desafio GeoSapiens

Este roteiro mostra o projeto do zero, na mesma arquitetura que está neste repositório:

```text
CSV grande -> API Spring Boot -> Kafka -> consumidor em lotes -> PostgreSQL
                                      |
                                      +-> status e métricas

React no navegador -> Nginx -> API Spring Boot -> PostgreSQL
```

## 1. Abertura do vídeo

**Fala sugerida:**

> Este projeto importa arquivos CSV grandes sem colocar o arquivo inteiro na memória. A interface é feita em React, o backend é Spring Boot, os dados ficam no PostgreSQL e o Kafka desacopla a leitura do arquivo da escrita no banco. Assim, uma grande chegada de dados vira uma fila controlada, em vez de uma sobrecarga direta no banco.

Abra a pasta do projeto no VS Code:

```cmd
cd C:\Users\Dan\Documents\Codex\2026-09-15\desafio-geosapiens
code .
```

Mostre estes diretórios:

```text
backend/      API Java Spring Boot
frontend/     tela React e Nginx
scripts/      gerador de CSV
docker-compose.yml  infraestrutura local
```

## 2. Banco de dados e tabelas

Abra `backend/src/main/resources/schema.sql`.

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  category VARCHAR(80) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  source VARCHAR(120)
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at_id
  ON transactions (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_category_occurred_at
  ON transactions (category, occurred_at);
```

**Explique no vídeo:**

- `transactions` é a tabela principal.
- `id` identifica cada registro.
- `occurred_at`, `category`, `amount` e `source` vêm do CSV.
- O primeiro índice torna rápida a listagem por data usando cursor.
- O segundo ajuda consultas por categoria e por período.
- O arquivo é montado no container do PostgreSQL e executado apenas quando o volume do banco é criado.

## 3. Docker Compose: os quatro serviços

Abra `docker-compose.yml` e explique cada bloco.

| Serviço | Papel | Porta no computador |
|---|---|---|
| `db` | PostgreSQL 16 e volume persistente | interna |
| `kafka` | fila/broker de eventos | 9092 |
| `api` | Spring Boot, importação e endpoints | 8080 |
| `web` | React servido pelo Nginx | 5173 |

**Fala sugerida:**

> O `depends_on` faz a API esperar o banco e o Kafka ficarem saudáveis. O volume `postgres_data` mantém os dados mesmo após desligar os containers. Por isso, `docker compose down` não apaga as transações; já `docker compose down -v` apaga o volume e todos os dados locais.

Suba todo o ambiente:

```cmd
docker compose up --build -d
```

Confira os serviços:

```cmd
docker compose ps
```

Abra a interface:

```text
http://localhost:5173
```

Se precisar acompanhar os logs da API:

```cmd
docker compose logs -f api
```

## 4. Backend Spring Boot

Mostre `backend/pom.xml` e depois `backend/src/main/java/com/geosapiens/TransactionController.java`.

**Dependências principais:**

- Spring Web: endpoints HTTP e upload multipart.
- Spring JDBC: inserções e consultas ao PostgreSQL.
- Spring Kafka: produtor e consumidor Kafka.
- Commons CSV: leitura correta do CSV.
- Actuator/Micrometer: métricas.
- PostgreSQL Driver: conexão com o banco.

### Endpoints criados

| Endpoint | Uso |
|---|---|
| `POST /api/imports` | recebe o CSV e retorna `202 Accepted` com o id do trabalho |
| `GET /api/imports/{id}` | devolve andamento: lidas, publicadas, persistidas e inválidas |
| `GET /api/transactions` | lista registros paginados por cursor |
| `GET /api/aggregates` | soma e conta por mês/categoria |
| `GET /api/capacity` | mostra uso e capacidade estimada do banco |

**Fala sugerida sobre a importação:**

> O upload não fica esperando milhões de registros serem gravados. A API responde com o id do trabalho e processa em segundo plano. O `BufferedReader` e o parser CSV leem linha a linha, validam os campos e publicam um evento no tópico `transactions-import`.

Mostre o trecho conceitual do fluxo:

```java
// Leitura em streaming: não existe lista com o CSV inteiro.
for (CSVRecord row : csv) {
  ImportRecord event = new ImportRecord(jobId, occurredAt, category, amount, source);
  kafka.send("transactions-import", jobId, json.writeValueAsString(event));
}

// Consumidor recebe um lote e grava em batch no PostgreSQL.
jdbc.batchUpdate(
  "INSERT INTO transactions (occurred_at, category, amount, source) VALUES (?, ?, ?, ?)",
  rows
);
```

O tamanho do lote é configurável pela variável `IMPORT_BATCH_SIZE` (padrão: 1000 registros por busca do consumidor).

## 5. Kafka: por que ele existe

**Fala sugerida:**

> O Kafka não torna o banco ilimitado. Ele separa a velocidade da leitura do arquivo da velocidade segura de escrita no PostgreSQL. Se o CSV for lido mais rápido do que o banco grava, o atraso aparece na fila do Kafka, em vez de a API abrir conexões e tentativas de escrita sem controle no banco.

No projeto:

- a API é a **produtora**: lê o CSV e publica cada evento;
- o tópico é `transactions-import`;
- a própria API também possui o **consumidor**;
- o consumidor recebe mensagens em lotes e usa `batchUpdate`;
- o trabalho só fica `COMPLETED` quando tudo que foi publicado foi persistido.

Em produção, explique que seria necessário configurar retenção, várias partições, replicação, autenticação, monitoramento do lag e idempotência. Para o desafio, há um único broker local, suficiente para demonstrar o padrão.

## 6. Capacidade do banco e Datadog

Abra `backend/src/main/java/com/geosapiens/CapacityService.java` e `backend/src/main/resources/application.yml`.

As variáveis configuráveis são:

```text
DB_STORAGE_LIMIT_GB=20
DB_ALERT_PERCENT=80
AVG_ROW_BYTES_ESTIMATE=180
```

**Fala sugerida:**

> O tamanho atual vem do PostgreSQL com `pg_database_size`. O percentual compara esse tamanho com um limite configurado. Já a quantidade de registros restantes é uma estimativa: espaço restante em bytes dividido pelo tamanho médio estimado por linha. Não é uma promessa de capacidade, porque índices, WAL, volume Docker e infraestrutura também ocupam espaço.

Estados exibidos:

- `OK`: abaixo do alerta;
- `WARNING`: atingiu `DB_ALERT_PERCENT`;
- `CRITICAL`: atingiu ou ultrapassou o limite configurado.

As métricas são expostas em:

```text
http://localhost:8080/actuator/metrics
http://localhost:8080/actuator/prometheus
```

O Datadog é opcional. Nunca grave uma chave no código, no Dockerfile ou no Git. Para ativar apenas no seu ambiente, defina antes de subir os containers:

```cmd
set DATADOG_ENABLED=true
set DD_API_KEY=sua_chave_apenas_no_seu_computador
docker compose up --build -d
```

Para desativar novamente, feche o terminal ou execute:

```cmd
set DATADOG_ENABLED=false
```

## 7. Frontend React

Abra `frontend/src.jsx`.

**Explique os elementos da tela:**

- botão **Importar CSV** envia o arquivo como `multipart/form-data`;
- a cada segundo, a tela consulta o status do trabalho enquanto ele está em fila, publicando ou consumindo;
- o aviso mostra quantas linhas foram lidas, quantas entraram no Kafka e quantas foram persistidas;
- cards mostram total processado, valor agregado, grupos mês/categoria, uso do banco e estimativa restante;
- barras vêm de `/api/aggregates`, portanto são calculadas pelo PostgreSQL e não pelo navegador;
- tabela mostra apenas 30 registros por vez e usa cursor para ir à próxima página.

Mostre `frontend/nginx.conf` e destaque:

```nginx
client_max_body_size 2g;
proxy_request_buffering off;
proxy_pass http://api:8080;
```

**Fala sugerida:**

> Isso permite o envio de arquivos grandes e evita que o Nginx guarde todo o upload antes de encaminhá-lo para a API.

## 8. Gerar e testar um CSV pequeno

Abra `scripts/generate-csv.mjs`.

O formato é sempre:

```csv
occurred_at,category,amount,source
2024-01-01T00:00:00.000Z,food,0.00,mobile
```

Primeiro gere uma carga pequena para demonstrar sem risco:

```cmd
node scripts\generate-csv.mjs 1000 > C:\Users\Dan\Downloads\transactions-test.csv
```

Na tela, clique em **Importar CSV**, selecione `transactions-test.csv` e mostre o status até aparecer:

```text
COMPLETED — 1.000 lidas, 1.000 no Kafka, 1.000 persistidas, 0 inválidas
```

Mostre a tabela, os cards e a agregação.

## 9. Demonstração dos 11 milhões

Só faça esta parte depois do teste pequeno e com espaço disponível no computador.

Gere o arquivo com todos os meses de 2024 e 2025:

```cmd
node scripts\generate-csv.mjs 11000000 > C:\Users\Dan\Downloads\transactions-11m-full-months.csv
```

Se quiser uma demonstração limpa, apague os dados antigos **sabendo que esta ação remove permanentemente o banco local**:

```cmd
docker compose down -v
docker compose up --build -d
```

Depois, na interface, importe `transactions-11m-full-months.csv`.

Durante a execução, explique os campos:

```text
Lidas        = linhas que o leitor CSV já percorreu
No Kafka     = eventos publicados com sucesso no tópico
Persistidas  = registros gravados no PostgreSQL
Inválidas    = linhas rejeitadas por dados inválidos
```

O resultado esperado para o arquivo íntegro é:

```text
COMPLETED — 11.000.000 lidas, 11.000.000 no Kafka,
11.000.000 persistidas, 0 inválidas
```

Com o gerador atual, a agregação deve ter **120 grupos**: 24 combinações de ano/mês × 5 categorias.

## 10. Encerramento e limitações honestas

**Fala sugerida:**

> A solução foi desenhada para não ler milhões de linhas de uma vez, não usar OFFSET em páginas profundas e não gravar cada registro individualmente. Kafka protege o PostgreSQL de picos ao criar uma fila e o consumidor grava em batches. Para produção, eu aumentaria a observabilidade, configuraria segurança e replicação do Kafka, definia retenção, ajustaria o número de partições e mediria o tamanho real de cada linha, índices e WAL antes de definir capacidade.

Limitações do ambiente de demonstração:

- Kafka é um único broker, sem replicação;
- os trabalhos de importação ficam em memória da API e não sobrevivem a reinício dela;
- o limite de banco é configurado, não é o limite físico automático do Docker;
- a estimativa de registros restantes depende de `AVG_ROW_BYTES_ESTIMATE`;
- a tabela deliberadamente pagina registros, pois renderizar 11 milhões no navegador seria inviável.

## Checklist final antes de gravar

- [ ] Docker Desktop está aberto e com o Engine em execução.
- [ ] `docker compose ps` mostra `db`, `kafka`, `api` e `web` ativos.
- [ ] A página abre em `http://localhost:5173`.
- [ ] O teste de 1.000 linhas concluiu com 0 inválidas.
- [ ] O espaço em disco foi conferido antes da carga de 11 milhões.
- [ ] Se o banco foi apagado, você entende que `down -v` removeu os dados locais.
- [ ] O vídeo mostra o status final e a capacidade estimada como estimativa, não como garantia.
