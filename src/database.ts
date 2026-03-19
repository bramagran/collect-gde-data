import pg from 'pg';
import type { DemandRecord } from './gde-client.js';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 10,
});

export interface DemandaDB {
  id: number;
  registro: number;
  data_hora: Date;
  demanda_ativa: number;
  demanda_reativa: number;
  flags_raw: number;
  posto_horario: string;
  periodo_reativo: string;
  fechamento_fatura: boolean;
  intervalo_reativos: boolean;
  created_at: Date;
}

export function parseDataHora(dataStr: string): Date {
  // Formato: "DD/MM/YYYY HH:MM"
  const [dataPart, horaPart] = dataStr.split(' ');
  const [dia, mes, ano] = dataPart.split('/').map(Number);
  const [hora, minuto] = horaPart.split(':').map(Number);
  return new Date(ano, mes - 1, dia, hora, minuto);
}

export async function insertDemandRecord(record: DemandRecord): Promise<void> {
  const dataHora = parseDataHora(record.data);

  await pool.query(
    `INSERT INTO demanda (registro, data_hora, demanda_ativa, demanda_reativa, flags_raw, posto_horario, periodo_reativo, fechamento_fatura, intervalo_reativos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (registro, data_hora) DO UPDATE SET
       demanda_ativa = EXCLUDED.demanda_ativa,
       demanda_reativa = EXCLUDED.demanda_reativa,
       flags_raw = EXCLUDED.flags_raw,
       posto_horario = EXCLUDED.posto_horario,
       periodo_reativo = EXCLUDED.periodo_reativo,
       fechamento_fatura = EXCLUDED.fechamento_fatura,
       intervalo_reativos = EXCLUDED.intervalo_reativos`,
    [
      record.registro,
      dataHora,
      record.demandaAtiva,
      record.demandaReativa,
      record.flags.raw,
      record.flags.postoHorario,
      record.flags.periodoReativo,
      record.flags.fechamentoFatura,
      record.flags.intervaloReativos,
    ]
  );
}

export async function insertDemandRecords(records: DemandRecord[]): Promise<number> {
  let inserted = 0;
  for (const record of records) {
    try {
      await insertDemandRecord(record);
      inserted++;
    } catch (error) {
      console.error(`Erro ao inserir registro ${record.registro}:`, error);
    }
  }
  return inserted;
}

export async function getLastRegistro(): Promise<number> {
  const result = await pool.query('SELECT MAX(registro) as max_registro FROM demanda');
  return result.rows[0].max_registro || 0;
}

export async function getLastDataHora(): Promise<Date | null> {
  const result = await pool.query('SELECT MAX(data_hora) as max_data FROM demanda');
  return result.rows[0].max_data || null;
}

export async function getDemandaByDateRange(
  dataInicial?: Date,
  dataFinal?: Date
): Promise<DemandaDB[]> {
  let query = 'SELECT * FROM demanda';
  const params: Date[] = [];
  const conditions: string[] = [];

  if (dataInicial) {
    conditions.push(`data_hora >= $${params.length + 1}`);
    params.push(dataInicial);
  }

  if (dataFinal) {
    conditions.push(`data_hora <= $${params.length + 1}`);
    params.push(dataFinal);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY data_hora ASC';

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getRecordCount(): Promise<number> {
  const result = await pool.query('SELECT COUNT(*) as count FROM demanda');
  return parseInt(result.rows[0].count, 10);
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export { pool };
