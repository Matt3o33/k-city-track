import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';

import { parseBrokerUrl } from '@/lib/settings';

type TcpConnection = ReturnType<typeof TcpSocket.createConnection>;

export type MqttOptions = {
  brokerUrl: string;
  clientId: string;
  username?: string;
  password?: string;
};

const KEEPALIVE_SEC = 60;
const PING_INTERVAL_MS = 25_000;
const CONNECT_TIMEOUT_MS = 10_000;

/** Remaining length MQTT (varint, max 4 byte) */
function encodeRemainingLength(length: number): number[] {
  if (length < 0 || length > 268_435_455) {
    throw new Error('Lunghezza pacchetto MQTT non valida');
  }
  const out: number[] = [];
  let n = length;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

/** Stringa MQTT: lunghezza big-endian su 2 byte + UTF-8 */
function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > 0xffff) throw new Error('Stringa MQTT troppo lunga');
  return Buffer.concat([Buffer.from([bytes.length >> 8, bytes.length & 0xff]), bytes]);
}

function packet(type: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type, ...encodeRemainingLength(body.length)]), body]);
}

function buildConnect(opts: MqttOptions): Buffer {
  let flags = 0x02; // clean session
  const payload: Buffer[] = [encodeString(opts.clientId)];
  if (opts.username) {
    flags |= 0x80;
    payload.push(encodeString(opts.username));
    if (opts.password) {
      flags |= 0x40;
      payload.push(encodeString(opts.password));
    }
  }
  const variableHeader = Buffer.concat([
    encodeString('MQTT'),
    Buffer.from([0x04, flags, KEEPALIVE_SEC >> 8, KEEPALIVE_SEC & 0xff]),
  ]);
  return packet(0x10, Buffer.concat([variableHeader, ...payload]));
}

function buildPublish(topic: string, message: string): Buffer {
  return packet(0x30, Buffer.concat([encodeString(topic), Buffer.from(message, 'utf8')]));
}

const PINGREQ = Buffer.from([0xc0, 0x00]);
const DISCONNECT = Buffer.from([0xe0, 0x00]);

/**
 * Client MQTT 3.1.1 minimale (solo publish QoS 0) su TCP/TLS.
 * Pensato per il task di localizzazione in background: ogni metodo può
 * fallire con un Error descrittivo ma non deve mai far crashare il runtime.
 */
export class MqttClient {
  private socket: TcpConnection | null = null;
  private connected = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: MqttOptions) {}

  get isConnected(): boolean {
    return this.connected;
  }

  connect(): Promise<void> {
    if (Platform.OS === 'web') {
      return Promise.reject(new Error('MQTT non supportato sul web'));
    }
    const address = parseBrokerUrl(this.opts.brokerUrl);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let received = Buffer.alloc(0);

      const fail = (error: Error) => {
        this.teardown();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const timeout = setTimeout(
        () => fail(new Error('timeout di connessione al broker')),
        CONNECT_TIMEOUT_MS,
      );

      const socket = TcpSocket.createConnection(
        {
          host: address.host,
          port: address.port,
          tls: address.tls,
        },
        () => {
          socket.write(buildConnect(this.opts));
        },
      );
      this.socket = socket;

      socket.on('data', (data) => {
        if (settled) return; // dopo il CONNACK ignoriamo il traffico in ingresso (PINGRESP ecc.)
        received = Buffer.concat([
          received,
          typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
        ]);
        if (received.length < 4) return;
        if ((received[0] & 0xf0) !== 0x20) {
          fail(new Error('risposta inattesa dal broker'));
          return;
        }
        const returnCode = received[3];
        if (returnCode !== 0) {
          const reasons: Record<number, string> = {
            1: 'versione protocollo non accettata',
            2: 'client ID rifiutato',
            3: 'servizio non disponibile',
            4: 'credenziali errate',
            5: 'non autorizzato',
          };
          fail(new Error(reasons[returnCode] ?? `connessione rifiutata (codice ${returnCode})`));
          return;
        }
        clearTimeout(timeout);
        settled = true;
        this.connected = true;
        this.pingTimer = setInterval(() => {
          try {
            socket.write(PINGREQ);
          } catch {
            this.teardown();
          }
        }, PING_INTERVAL_MS);
        resolve();
      });

      socket.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
      socket.on('close', () => {
        this.connected = false;
        if (!settled) fail(new Error('connessione chiusa dal broker'));
      });
    });
  }

  publish(topic: string, message: string): void {
    if (!this.connected || !this.socket) {
      throw new Error('Broker MQTT non connesso');
    }
    this.socket.write(buildPublish(topic, message));
  }

  end(): void {
    if (this.socket && this.connected) {
      try {
        this.socket.write(DISCONNECT);
      } catch {
        // il socket potrebbe essere già invalido: la teardown sotto basta
      }
    }
    this.teardown();
  }

  private teardown(): void {
    this.connected = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // già distrutto
      }
      this.socket = null;
    }
  }
}
