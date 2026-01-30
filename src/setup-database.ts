import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;

async function setup() {
  // Conectar como master para criar banco e usuário
  const masterClient = new Client({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_MASTER_USER,
    password: process.env.PG_MASTER_PASSWORD,
    database: 'postgres',
  });

  try {
    await masterClient.connect();
    console.log('Conectado ao PostgreSQL como master');

    // Criar usuário se não existir
    const userExists = await masterClient.query(
      `SELECT 1 FROM pg_roles WHERE rolname = $1`,
      [process.env.PG_USER]
    );

    if (userExists.rows.length === 0) {
      await masterClient.query(
        `CREATE USER ${process.env.PG_USER} WITH PASSWORD '${process.env.PG_PASSWORD}'`
      );
      console.log(`Usuário ${process.env.PG_USER} criado`);
    } else {
      console.log(`Usuário ${process.env.PG_USER} já existe`);
    }

    // Criar banco se não existir
    const dbExists = await masterClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [process.env.PG_DATABASE]
    );

    if (dbExists.rows.length === 0) {
      await masterClient.query(`CREATE DATABASE ${process.env.PG_DATABASE} OWNER ${process.env.PG_USER}`);
      console.log(`Banco ${process.env.PG_DATABASE} criado`);
    } else {
      console.log(`Banco ${process.env.PG_DATABASE} já existe`);
    }

    await masterClient.end();

    // Conectar ao banco gde para criar a tabela
    const appClient = new Client({
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT || '5432', 10),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
    });

    await appClient.connect();
    console.log(`Conectado ao banco ${process.env.PG_DATABASE}`);

    // Criar tabela de demanda
    await appClient.query(`
      CREATE TABLE IF NOT EXISTS demanda (
        id SERIAL PRIMARY KEY,
        registro INTEGER NOT NULL,
        data_hora TIMESTAMP NOT NULL,
        demanda_ativa DECIMAL(12, 3) NOT NULL,
        demanda_reativa DECIMAL(12, 3) NOT NULL,
        flags_raw INTEGER NOT NULL,
        posto_horario VARCHAR(20) NOT NULL,
        periodo_reativo VARCHAR(20) NOT NULL,
        fechamento_fatura BOOLEAN NOT NULL DEFAULT FALSE,
        intervalo_reativos BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(registro, data_hora)
      )
    `);
    console.log('Tabela demanda criada/verificada');

    // Criar índices
    await appClient.query(`
      CREATE INDEX IF NOT EXISTS idx_demanda_data_hora ON demanda(data_hora)
    `);
    await appClient.query(`
      CREATE INDEX IF NOT EXISTS idx_demanda_registro ON demanda(registro)
    `);
    console.log('Índices criados/verificados');

    await appClient.end();
    console.log('Setup concluído com sucesso!');

  } catch (error) {
    console.error('Erro no setup:', error);
    process.exit(1);
  }
}

setup();
