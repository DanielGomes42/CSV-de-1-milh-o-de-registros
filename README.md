# Desafio GeoSapiens

Aplicação containerizada para importar CSVs grandes via Kafka e explorá-los sem carregar o arquivo inteiro, nem renderizar todos os registros no navegador.

## Executar

```bash
docker compose up --build
```

Abra `http://localhost:5173`. Para gerar um arquivo com um milhão de linhas (Node 18+):

```bash
node scripts/generate-csv.mjs 1000000 > transactions.csv
```

Para a carga de 11 milhões, gere o arquivo, mas execute a importação somente quando houver espaço suficiente no banco:

```bash
node scripts/generate-csv.mjs 11000000 > C:\Users\Dan\Downloads\transactions-11m.csv
```

Formato esperado: `occurred_at,category,amount,source`; a data deve estar em ISO-8601 (por exemplo, `2025-01-10T12:00:00Z`).

## Decisões de escala

- O upload é aceito imediatamente (`202`). O leitor usa `BufferedReader`, publica cada registro no tópico Kafka `transactions-import` e o consumidor grava lotes no PostgreSQL. O status é consultado por polling a cada segundo.
- O arquivo e as mensagens não são acumulados em memória. Kafka faz o desacoplamento entre produção e consumo; em produção, configure retenção, partições, autenticação e idempotência.
- A tabela possui índice para a ordenação paginada por data/id e índice composto `(category, occurred_at)` para filtros e agregações por categoria/período. A listagem usa paginação por cursor (keyset), eliminando o custo crescente de `OFFSET`, e traz no máximo 200 linhas por solicitação.
- O dashboard consulta agregados no banco; os cards e barras não calculam sobre a lista paginada.

## Endpoints

- `POST /api/imports` (multipart, campo `file`) retorna o id do trabalho.
- `GET /api/imports/{id}` retorna progresso, erros e estado.
- `GET /api/transactions?size=50&cursor=...` lista uma página por cursor; omita o cursor para a primeira página.
- `GET /api/aggregates` retorna total e contagem por mês/categoria.
- `GET /api/capacity` retorna tamanho real do banco, percentual contra o limite configurado e estimativa de registros adicionais.

## Capacidade e Datadog

Configure `DB_STORAGE_LIMIT_GB`, `DB_ALERT_PERCENT` e `AVG_ROW_BYTES_ESTIMATE` no ambiente. A capacidade é uma estimativa: o tamanho real do banco vem de `pg_database_size`, mas WAL, índices, disco do Docker e retenção Kafka também consomem armazenamento.

As métricas ficam em `/actuator/metrics` e `/actuator/prometheus`, incluindo leitura, publicação Kafka, persistência, erros, uso de JVM e pool JDBC. Para enviar métricas ao Datadog, defina `DATADOG_ENABLED=true` e `DD_API_KEY` apenas no ambiente local/CI; nunca registre a chave no repositório.

Para reiniciar os dados locais, execute `docker compose down -v` e depois suba novamente.
