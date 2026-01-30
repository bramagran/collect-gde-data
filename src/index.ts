import Fastify from 'fastify';
import cors from '@fastify/cors';
import cron from 'node-cron';
import 'dotenv/config';
import { GDEClient, DemandRecord } from './gde-client.js';
import { getDemandaByDateRange, getRecordCount as getDBRecordCount, type DemandaDB } from './database.js';
import { syncDemandData } from './sync.js';

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors);

const gdeClient = new GDEClient({
  ip: process.env.GDE_IP || '192.168.1.100',
  port: parseInt(process.env.GDE_PORT || '1001', 10),
  address: parseInt(process.env.GDE_ADDRESS || '254', 10),
});

// === Tipos ===

interface DemandResponse {
  totalRegistros: number;
  offset: number;
  limit: number;
  registros: DemandRecord[];
}

interface DemandaDBResponse {
  totalRegistros: number;
  filtros: {
    dataInicial?: string;
    dataFinal?: string;
  };
  registros: DemandaDB[];
}

interface ErrorResponse {
  error: string;
  message: string;
}

interface DemandQuerystring {
  offset?: string;
  limit?: string;
}

interface DemandaDBQuerystring {
  dataInicial?: string;
  dataFinal?: string;
}

// === Rotas ===

// Rota original - busca direto do GDE (com paginação)
fastify.get<{
  Querystring: DemandQuerystring;
  Reply: DemandResponse | ErrorResponse;
}>('/demanda/gde', async (request, reply) => {
  try {
    const totalRecords = await gdeClient.getRecordCount();
    const offset = Math.min(totalRecords, Math.max(1, parseInt(request.query.offset || '1', 10)));
    const maxPossible = totalRecords - offset + 1;
    const limit = Math.min(maxPossible, Math.min(100, Math.max(1, parseInt(request.query.limit || '100', 10))));

    if (limit <= 0) {
      return {
        totalRegistros: totalRecords,
        offset,
        limit: 0,
        registros: [],
      };
    }

    const records = await gdeClient.getDemandRecords(offset, limit);

    return {
      totalRegistros: totalRecords,
      offset,
      limit,
      registros: records,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Erro ao comunicar com GDE4000',
      message,
    });
  }
});

// Nova rota - busca do banco de dados com filtro de data
fastify.get<{
  Querystring: DemandaDBQuerystring;
  Reply: DemandaDBResponse | ErrorResponse;
}>('/demanda', async (request, reply) => {
  try {
    let dataInicial: Date | undefined;
    let dataFinal: Date | undefined;

    // Parse das datas (formato: YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS)
    if (request.query.dataInicial) {
      dataInicial = new Date(request.query.dataInicial);
      if (isNaN(dataInicial.getTime())) {
        return reply.status(400).send({
          error: 'Parâmetro inválido',
          message: 'dataInicial deve ser uma data válida (YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS)',
        });
      }
    }

    if (request.query.dataFinal) {
      dataFinal = new Date(request.query.dataFinal);
      if (isNaN(dataFinal.getTime())) {
        return reply.status(400).send({
          error: 'Parâmetro inválido',
          message: 'dataFinal deve ser uma data válida (YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS)',
        });
      }
    }

    const registros = await getDemandaByDateRange(dataInicial, dataFinal);
    const totalRegistros = await getDBRecordCount();

    return {
      totalRegistros,
      filtros: {
        dataInicial: dataInicial?.toISOString(),
        dataFinal: dataFinal?.toISOString(),
      },
      registros,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Erro ao buscar dados',
      message,
    });
  }
});

// Rota para forçar sincronização manual
fastify.post<{
  Reply: { message: string; synced: number; total: number } | ErrorResponse;
}>('/demanda/sync', async (request, reply) => {
  try {
    const result = await syncDemandData(false);
    return {
      message: 'Sincronização concluída',
      synced: result.synced,
      total: result.total,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Erro na sincronização',
      message,
    });
  }
});

fastify.get('/health', async () => {
  return { status: 'ok' };
});

// === Cron Job ===
// Executa nos minutos 1, 16, 31 e 46 (1 minuto após o GDE registrar)
cron.schedule('1,16,31,46 * * * *', async () => {
  console.log(`[CRON] Iniciando sincronização automática - ${new Date().toISOString()}`);
  try {
    const result = await syncDemandData(false);
    console.log(`[CRON] Sincronização concluída: ${result.synced} registros`);
  } catch (error) {
    console.error('[CRON] Erro na sincronização:', error);
  }
});

// === Start ===

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Servidor rodando em http://localhost:${port}`);
    console.log(`GDE4000 configurado em ${process.env.GDE_IP}:${process.env.GDE_PORT}`);
    console.log('Cron job ativo: sincronização a cada 15 minutos (1, 16, 31, 46)');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
