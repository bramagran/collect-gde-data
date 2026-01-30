import dgram from 'node:dgram';

export interface DemandRecord {
  registro: number;
  data: string;
  demandaAtiva: number;
  demandaReativa: number;
  flags: {
    raw: number;
    postoHorario: 'fora_ponta' | 'ponta' | 'reservado';
    periodoReativo: 'indutivo' | 'capacitivo';
    fechamentoFatura: boolean;
    intervaloReativos: boolean;
  };
}

interface GDEConfig {
  ip: string;
  port: number;
  address: number;
}

// Tabela CRC16 Modbus
const CRC_TABLE = new Uint16Array([
  0x0000, 0xc0c1, 0xc181, 0x0140, 0xc301, 0x03c0, 0x0280, 0xc241,
  0xc601, 0x06c0, 0x0780, 0xc741, 0x0500, 0xc5c1, 0xc481, 0x0440,
  0xcc01, 0x0cc0, 0x0d80, 0xcd41, 0x0f00, 0xcfc1, 0xce81, 0x0e40,
  0x0a00, 0xcac1, 0xcb81, 0x0b40, 0xc901, 0x09c0, 0x0880, 0xc841,
  0xd801, 0x18c0, 0x1980, 0xd941, 0x1b00, 0xdbc1, 0xda81, 0x1a40,
  0x1e00, 0xdec1, 0xdf81, 0x1f40, 0xdd01, 0x1dc0, 0x1c80, 0xdc41,
  0x1400, 0xd4c1, 0xd581, 0x1540, 0xd701, 0x17c0, 0x1680, 0xd641,
  0xd201, 0x12c0, 0x1380, 0xd341, 0x1100, 0xd1c1, 0xd081, 0x1040,
  0xf001, 0x30c0, 0x3180, 0xf141, 0x3300, 0xf3c1, 0xf281, 0x3240,
  0x3600, 0xf6c1, 0xf781, 0x3740, 0xf501, 0x35c0, 0x3480, 0xf441,
  0x3c00, 0xfcc1, 0xfd81, 0x3d40, 0xff01, 0x3fc0, 0x3e80, 0xfe41,
  0xfa01, 0x3ac0, 0x3b80, 0xfb41, 0x3900, 0xf9c1, 0xf881, 0x3840,
  0x2800, 0xe8c1, 0xe981, 0x2940, 0xeb01, 0x2bc0, 0x2a80, 0xea41,
  0xee01, 0x2ec0, 0x2f80, 0xef41, 0x2d00, 0xedc1, 0xec81, 0x2c40,
  0xe401, 0x24c0, 0x2580, 0xe541, 0x2700, 0xe7c1, 0xe681, 0x2640,
  0x2200, 0xe2c1, 0xe381, 0x2340, 0xe101, 0x21c0, 0x2080, 0xe041,
  0xa001, 0x60c0, 0x6180, 0xa141, 0x6300, 0xa3c1, 0xa281, 0x6240,
  0x6600, 0xa6c1, 0xa781, 0x6740, 0xa501, 0x65c0, 0x6480, 0xa441,
  0x6c00, 0xacc1, 0xad81, 0x6d40, 0xaf01, 0x6fc0, 0x6e80, 0xae41,
  0xaa01, 0x6ac0, 0x6b80, 0xab41, 0x6900, 0xa9c1, 0xa881, 0x6840,
  0x7800, 0xb8c1, 0xb981, 0x7940, 0xbb01, 0x7bc0, 0x7a80, 0xba41,
  0xbe01, 0x7ec0, 0x7f80, 0xbf41, 0x7d00, 0xbdc1, 0xbc81, 0x7c40,
  0xb401, 0x74c0, 0x7580, 0xb541, 0x7700, 0xb7c1, 0xb681, 0x7640,
  0x7200, 0xb2c1, 0xb381, 0x7340, 0xb101, 0x71c0, 0x7080, 0xb041,
  0x5000, 0x90c1, 0x9181, 0x5140, 0x9301, 0x53c0, 0x5280, 0x9241,
  0x9601, 0x56c0, 0x5780, 0x9741, 0x5500, 0x95c1, 0x9481, 0x5440,
  0x9c01, 0x5cc0, 0x5d80, 0x9d41, 0x5f00, 0x9fc1, 0x9e81, 0x5e40,
  0x5a00, 0x9ac1, 0x9b81, 0x5b40, 0x9901, 0x59c0, 0x5880, 0x9841,
  0x8801, 0x48c0, 0x4980, 0x8941, 0x4b00, 0x8bc1, 0x8a81, 0x4a40,
  0x4e00, 0x8ec1, 0x8f81, 0x4f40, 0x8d01, 0x4dc0, 0x4c80, 0x8c41,
  0x4400, 0x84c1, 0x8581, 0x4540, 0x8701, 0x47c0, 0x4680, 0x8641,
  0x8201, 0x42c0, 0x4380, 0x8341, 0x4100, 0x81c1, 0x8081, 0x4040,
]);

function crc16(buffer: Buffer): number {
  let crc = 0xffff;
  for (let i = 0; i < buffer.length; i++) {
    const index = (crc ^ buffer[i]) & 0xff;
    crc = (crc >> 8) ^ CRC_TABLE[index];
  }
  return crc;
}

function parseFloat32BE(buffer: Buffer, offset: number): number {
  return buffer.readFloatBE(offset);
}

function parseFlags(flags: number): DemandRecord['flags'] {
  const postoHorarioBits = flags & 0x03;
  let postoHorario: 'fora_ponta' | 'ponta' | 'reservado';
  switch (postoHorarioBits) {
    case 0:
      postoHorario = 'fora_ponta';
      break;
    case 1:
      postoHorario = 'ponta';
      break;
    default:
      postoHorario = 'reservado';
  }

  return {
    raw: flags,
    postoHorario,
    periodoReativo: (flags & 0x04) ? 'capacitivo' : 'indutivo',
    fechamentoFatura: !!(flags & 0x08),
    intervaloReativos: !!(flags & 0x10),
  };
}

export class GDEClient {
  private config: GDEConfig;
  private timeout: number;

  constructor(config: GDEConfig, timeout = 5000) {
    this.config = config;
    this.timeout = timeout;
  }

  private sendUDP(data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');

      const timer = setTimeout(() => {
        client.close();
        reject(new Error('Timeout na comunicação com o GDE4000'));
      }, this.timeout);

      client.on('message', (msg) => {
        clearTimeout(timer);
        client.close();
        resolve(msg);
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        client.close();
        reject(err);
      });

      client.send(data, this.config.port, this.config.ip);
    });
  }

  async readHoldingRegisters(startAddress: number, quantity: number): Promise<number[]> {
    // Função 03 - Read Holding Registers
    const request = Buffer.alloc(8);
    request.writeUInt8(this.config.address, 0);
    request.writeUInt8(0x03, 1);
    request.writeUInt16BE(startAddress, 2);
    request.writeUInt16BE(quantity, 4);
    const crc = crc16(request.subarray(0, 6));
    request.writeUInt16LE(crc, 6);

    const response = await this.sendUDP(request);

    // Verificar resposta
    if (response[1] & 0x80) {
      throw new Error(`Erro Modbus: código ${response[2]}`);
    }

    const byteCount = response[2];
    const values: number[] = [];
    for (let i = 0; i < byteCount / 2; i++) {
      values.push(response.readUInt16BE(3 + i * 2));
    }

    return values;
  }

  async getRecordCount(): Promise<number> {
    const values = await this.readHoldingRegisters(300, 1);
    return values[0];
  }

  async readDemandHistory(recordNumber: number, numRecords: number): Promise<Buffer> {
    // Função 100 - Leitura de histórico (comando customizado Embrasul)
    // REQUEST:
    // Endereço escravo (1 byte) + Código função (1 byte) + Arquivo (2 bytes) +
    // Número do record (2 bytes) + Data inicial (5 bytes) + Num records (1 byte) + CRC (2 bytes)

    const request = Buffer.alloc(14);
    let offset = 0;

    request.writeUInt8(this.config.address, offset++); // Endereço
    request.writeUInt8(100, offset++); // Função 100
    request.writeUInt16BE(1, offset); offset += 2; // Arquivo 1 = DEMANDA
    request.writeUInt16BE(recordNumber, offset); offset += 2; // Número do record

    // Data inicial (5 bytes) - zeros para ler todos
    request.writeUInt8(0, offset++); // Dia
    request.writeUInt8(0, offset++); // Mês
    request.writeUInt8(0, offset++); // Ano
    request.writeUInt8(0, offset++); // Hora
    request.writeUInt8(0, offset++); // Minuto

    request.writeUInt8(numRecords, offset++); // Num records

    const crc = crc16(request.subarray(0, 12));
    request.writeUInt16LE(crc, 12);

    return await this.sendUDP(request);
  }

  parseDemandRecords(response: Buffer, startRecord: number): DemandRecord[] {
    // RESPONSE:
    // Endereço (1) + Função (1) + Num record (2) + Tam record (1) + Tam total (1) + Dados + CRC (2)

    if (response[1] & 0x80) {
      throw new Error(`Erro Modbus: código ${response[2]}`);
    }

    const recordSize = response[4]; // Tam record (15 bytes para demanda)
    const totalSize = response[5]; // Tam total
    const numRecords = totalSize / recordSize;

    const records: DemandRecord[] = [];
    let dataOffset = 6;

    for (let i = 0; i < numRecords; i++) {
      // Formato do record de demanda (15 bytes):
      // Reservado(1) + Dia(1) + Mês(1) + Ano(1) + Hora(1) + Minuto(1) + EnergiaAtiva(4) + EnergiaReativa(4) + Flags(1)

      const dia = response[dataOffset + 1];
      const mes = response[dataOffset + 2];
      const ano = 2000 + response[dataOffset + 3];
      const hora = response[dataOffset + 4];
      const minuto = response[dataOffset + 5];

      // Float IEEE754 Big Endian
      const energiaAtiva = parseFloat32BE(response, dataOffset + 6);
      const energiaReativa = parseFloat32BE(response, dataOffset + 10);
      const flags = response[dataOffset + 14];

      // Demanda = Energia * 4 (pois intervalo é 15 min = 1/4 hora)
      const demandaAtiva = energiaAtiva * 4;
      const demandaReativa = energiaReativa * 4;

      const dataStr = `${dia.toString().padStart(2, '0')}/${mes.toString().padStart(2, '0')}/${ano} ${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}`;

      records.push({
        registro: startRecord + i,
        data: dataStr,
        demandaAtiva: Math.round(demandaAtiva * 1000) / 1000,
        demandaReativa: Math.round(demandaReativa * 1000) / 1000,
        flags: parseFlags(flags),
      });

      dataOffset += recordSize;
    }

    return records;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getDemandRecords(startRecord: number, count: number): Promise<DemandRecord[]> {
    const allRecords: DemandRecord[] = [];
    const delayBetweenRequests = 100; // ms entre requisições
    const maxRetries = 5;

    let currentRecord = startRecord;
    const endRecord = startRecord + count - 1;

    while (currentRecord <= endRecord) {
      let retries = 0;
      let success = false;

      while (!success && retries < maxRetries) {
        try {
          const response = await this.readDemandHistory(currentRecord, 1);
          const records = this.parseDemandRecords(response, currentRecord);
          allRecords.push(...records);
          currentRecord += records.length || 1;
          success = true;

          // Delay entre requisições para não sobrecarregar o equipamento
          if (currentRecord <= endRecord) {
            await this.delay(delayBetweenRequests);
          }
        } catch {
          retries++;
          console.log(`[GDE] Erro no registro ${currentRecord}, tentativa ${retries}/${maxRetries}`);
          await this.delay(500 * retries); // Delay maior entre retries
        }
      }

      if (!success) {
        throw new Error(`Falha ao ler registro ${currentRecord} após ${maxRetries} tentativas`);
      }
    }

    return allRecords;
  }

  async getAllDemandRecords(): Promise<DemandRecord[]> {
    const totalRecords = await this.getRecordCount();
    if (totalRecords === 0) {
      return [];
    }
    return this.getDemandRecords(1, totalRecords);
  }
}
