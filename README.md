# Collect GDE Data

API para coleta e armazenamento de dados de demanda do controlador Embrasul GDE4000 via Modbus UDP.

## Requisitos

- Node.js 18+
- PostgreSQL 12+
- Acesso de rede ao GDE4000 (porta UDP 1001)

## Instalação

```bash
npm install
```

## Configuração

Crie um arquivo `.env` na raiz do projeto:

```env
# GDE4000
GDE_IP=192.168.10.62
GDE_PORT=1001
GDE_ADDRESS=254

# PostgreSQL
PG_HOST=192.168.10.87
PG_PORT=5432
PG_DATABASE=gde
PG_USER=gde_app
PG_PASSWORD=sua_senha_aqui

# PostgreSQL Master (para setup inicial)
PG_MASTER_USER=docker
PG_MASTER_PASSWORD=senha_master
```

## Setup Inicial

1. Criar banco de dados e tabelas:

```bash
npm run setup
```

2. Sincronização inicial (importar todos os registros):

```bash
npm run sync:full
```

## Execução

### Desenvolvimento

```bash
npm run dev
```

### Produção

```bash
npm run build
npm start
```

## Endpoints

### `GET /demanda`

Retorna os dados de demanda do banco de dados com filtro opcional por data.

**Parâmetros de query:**

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| dataInicial | string | Data inicial (YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS) |
| dataFinal | string | Data final (YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS) |

**Exemplos:**

```bash
# Todos os registros
curl "http://localhost:3000/demanda"

# Filtro por data
curl "http://localhost:3000/demanda?dataInicial=2026-01-30"

# Filtro por período
curl "http://localhost:3000/demanda?dataInicial=2026-01-30T08:00:00&dataFinal=2026-01-30T18:00:00"
```

**Resposta:**

```json
{
  "totalRegistros": 1632,
  "filtros": {
    "dataInicial": "2026-01-30T00:00:00.000Z",
    "dataFinal": "2026-01-30T18:00:00.000Z"
  },
  "registros": [
    {
      "id": 1,
      "registro": 1,
      "data_hora": "2026-01-13T14:30:00.000Z",
      "demanda_ativa": "400.680",
      "demanda_reativa": "0.000",
      "flags_raw": 0,
      "posto_horario": "fora_ponta",
      "periodo_reativo": "indutivo",
      "fechamento_fatura": false,
      "intervalo_reativos": false,
      "created_at": "2026-01-30T17:58:58.623Z"
    }
  ]
}
```

### `GET /demanda/gde`

Lê dados diretamente do GDE4000 via Modbus (mais lento).

**Parâmetros de query:**

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| offset | number | 1 | Registro inicial |
| limit | number | 100 | Quantidade (máx. 100) |

**Exemplo:**

```bash
curl "http://localhost:3000/demanda/gde?offset=1&limit=10"
```

### `POST /demanda/sync`

Força uma sincronização manual do GDE4000 para o banco de dados.

```bash
curl -X POST "http://localhost:3000/demanda/sync"
```

### `GET /health`

Verifica se a API está funcionando.

```bash
curl "http://localhost:3000/health"
```

## Cron Job

A API executa automaticamente uma sincronização incremental nos minutos **1, 16, 31 e 46** de cada hora, capturando os novos registros logo após o GDE4000 gravar (que ocorre nos minutos 00, 15, 30 e 45).

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Inicia em modo desenvolvimento com hot-reload |
| `npm run build` | Compila TypeScript para JavaScript |
| `npm start` | Inicia a versão compilada |
| `npm run setup` | Cria banco de dados, usuário e tabelas |
| `npm run sync` | Sincronização incremental |
| `npm run sync:full` | Sincronização completa (todos os registros) |

## Estrutura do Projeto

```
collect-gde-data/
├── src/
│   ├── index.ts            # API Fastify + Cron Job
│   ├── gde-client.ts       # Cliente Modbus UDP para GDE4000
│   ├── database.ts         # Conexão e queries PostgreSQL
│   ├── sync.ts             # Lógica de sincronização
│   └── setup-database.ts   # Setup inicial do banco
├── dist/                   # Código compilado
├── .env                    # Variáveis de ambiente
├── package.json
└── tsconfig.json
```

## Protocolo GDE4000

O GDE4000 utiliza Modbus RTU encapsulado em UDP na porta 1001. A leitura do histórico de demanda usa o comando customizado da Embrasul (função 100).

Cada registro contém:
- Data/hora do intervalo (15 minutos)
- Demanda ativa (kW)
- Demanda reativa (kVAr)
- Flags (posto horário, período reativo, etc.)

## Limitações

- O GDE4000 retorna apenas 1 registro por requisição, tornando a leitura em massa lenta
- A sincronização completa de ~1600 registros leva aproximadamente 5 minutos
- Recomenda-se usar a rota `/demanda` (banco de dados) para consultas frequentes

### Buffer circular do medidor (limitação de hardware)

O GDE4000 possui memória interna para aproximadamente **60 dias** de histórico (intervalos de 15 minutos). Quando a memória enche, o medidor opera como um buffer circular: o registro mais antigo é apagado para dar lugar ao novo.

**Consequência:** se o serviço de coleta ficar offline por mais de 60 dias, os registros do período de inatividade serão sobrescritos no medidor e **não poderão ser recuperados**. Não há como contornar essa limitação por software — ela é inerente ao hardware.

A sincronização incremental detecta registros novos comparando a `data_hora` do último registro salvo no banco com a do último registro disponível no medidor. Isso garante funcionamento correto mesmo com o buffer circular ativo, desde que a coleta ocorra dentro da janela de 60 dias.
