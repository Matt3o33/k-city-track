import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'k-city-track/settings/v1';

export type TrackerSettings = {
  /** mqtt://host:porta oppure mqtts://host:porta (TLS) */
  brokerUrl: string;
  topic: string;
  /** Tracker ID OwnTracks (campo "tid" del payload): identifica il dispositivo, es. bus1 */
  trackerId: string;
  clientId: string;
  username: string;
  password: string;
  /** Intervallo minimo tra gli aggiornamenti di posizione, in secondi */
  intervalSec: number;
  /** Distanza minima tra gli aggiornamenti, in metri */
  distanceM: number;
};

export const defaultSettings: TrackerSettings = {
  brokerUrl: '',
  topic: 'k-city-track/position',
  trackerId: '',
  clientId: '',
  username: '',
  password: '',
  intervalSec: 15,
  distanceM: 10,
};

function newClientId() {
  return `k-city-track-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadSettings(): Promise<TrackerSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<TrackerSettings>) : {};
    const settings: TrackerSettings = { ...defaultSettings, ...parsed };
    if (!settings.clientId) {
      settings.clientId = newClientId();
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
    return settings;
  } catch {
    return { ...defaultSettings, clientId: newClientId() };
  }
}

export async function saveSettings(settings: TrackerSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export type BrokerAddress = { host: string; port: number; tls: boolean };

/**
 * Accetta solo mqtt://host[:porta] e mqtts://host[:porta] — niente URL
 * globale: il parsing è volutamente esplicito per dare errori chiari.
 */
export function parseBrokerUrl(url: string): BrokerAddress {
  const match = /^(mqtts?):\/\/([^\s:/]+)(?::(\d{1,5}))?\/?$/.exec(url.trim());
  if (!match) {
    throw new Error("URL broker non valido. Usa mqtts://host:porta (TLS) o mqtt://host:porta");
  }
  const tls = match[1] === 'mqtts';
  const port = match[3] ? Number(match[3]) : tls ? 8883 : 1883;
  if (port < 1 || port > 65535) {
    throw new Error('Porta MQTT non valida');
  }
  return { host: match[2], port, tls };
}
