import 'dotenv/config';
import { GDEClient } from './gde-client.js';
import { insertDemandRecords, getLastDataHora, parseDataHora, closePool } from './database.js';

const gdeClient = new GDEClient({
  ip: process.env.GDE_IP || '192.168.1.100',
  port: parseInt(process.env.GDE_PORT || '1001', 10),
  address: parseInt(process.env.GDE_ADDRESS || '254', 10),
});

export async function syncDemandData(fullSync = false): Promise<{ synced: number; total: number }> {
  console.log(`[SYNC] Iniciando sincronização ${fullSync ? 'completa' : 'incremental'}...`);

  const totalRecordsGDE = await gdeClient.getRecordCount();
  console.log(`[SYNC] Total de registros no GDE: ${totalRecordsGDE}`);

  let startRecord = 1;

  if (!fullSync) {
    const lastDataHora = await getLastDataHora();
    console.log(`[SYNC] Última data no banco: ${lastDataHora?.toISOString() ?? 'nenhuma'}`);

    if (lastDataHora) {
      // Lê o último registro do medidor para verificar se há dados novos.
      // Nota: o medidor usa buffer circular com capacidade para ~60 dias.
      // Se o serviço ficar offline por mais de 60 dias, os registros mais antigos
      // serão sobrescritos e não poderão ser recuperados (limitação de hardware).
      const [lastMeterRecord] = await gdeClient.getDemandRecords(totalRecordsGDE, 1);
      const lastMeterDate = parseDataHora(lastMeterRecord.data);

      if (lastMeterDate <= lastDataHora) {
        console.log('[SYNC] Banco já está atualizado');
        return { synced: 0, total: totalRecordsGDE };
      }

      // Varre de trás para frente para encontrar o primeiro registro novo,
      // evitando buscar registros que o banco já possui.
      const batchSize = 50;
      let found = false;

      for (let i = totalRecordsGDE - 1; i >= 1 && !found; i -= batchSize) {
        const count = Math.min(batchSize, i);
        const batchStart = i - count + 1;
        const records = await gdeClient.getDemandRecords(batchStart, count);

        for (let j = records.length - 1; j >= 0; j--) {
          if (parseDataHora(records[j].data) <= lastDataHora) {
            startRecord = records[j].registro + 1;
            found = true;
            break;
          }
        }
      }

      console.log(`[SYNC] Sincronizando a partir do registro ${startRecord}`);
    }
  }

  const recordsToSync = totalRecordsGDE - startRecord + 1;
  console.log(`[SYNC] Registros a sincronizar: ${recordsToSync} (de ${startRecord} até ${totalRecordsGDE})`);

  let totalSynced = 0;
  const batchSize = 50;

  for (let i = startRecord; i <= totalRecordsGDE; i += batchSize) {
    const count = Math.min(batchSize, totalRecordsGDE - i + 1);
    console.log(`[SYNC] Buscando registros ${i} a ${i + count - 1}...`);

    try {
      const records = await gdeClient.getDemandRecords(i, count);
      const inserted = await insertDemandRecords(records);
      totalSynced += inserted;
      console.log(`[SYNC] Inseridos ${inserted} registros`);
    } catch (error) {
      console.error(`[SYNC] Erro ao sincronizar batch ${i}:`, error);
    }
  }

  console.log(`[SYNC] Sincronização concluída: ${totalSynced} registros`);
  return { synced: totalSynced, total: totalRecordsGDE };
}

// Se executado diretamente, faz sync completo
if (import.meta.url === `file://${process.argv[1]}`) {
  const fullSync = process.argv.includes('--full');

  syncDemandData(fullSync)
    .then((result) => {
      console.log(`[SYNC] Resultado: ${result.synced} de ${result.total} registros sincronizados`);
      return closePool();
    })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[SYNC] Erro:', error);
      process.exit(1);
    });
}
