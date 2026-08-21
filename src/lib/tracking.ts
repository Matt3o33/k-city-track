import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { clearCrumb, installGlobalErrorLogger, setCrumb } from '@/lib/diagnostics';
import { MqttClient } from '@/lib/mqtt';
import { loadSettings, parseBrokerUrl, type TrackerSettings } from '@/lib/settings';

export const LOCATION_TASK = 'k-city-track-location';

// Registra subito il logger degli errori JS fatali: questo modulo viene
// importato per primo da _layout, quindi copre tutto il ciclo di vita.
installGlobalErrorLogger();

const STATUS_KEY = 'k-city-track/status/v1';

/** Quante posizioni pubblicare al massimo per batch consegnato dal sistema */
const QUEUE_LIMIT = 20;

export type TrackingStatus = {
  lastError: string | null;
  lastPublishAt: number | null;
  lastFix: { lat: number; lon: number; acc: number | null; at: number } | null;
};

const emptyStatus: TrackingStatus = { lastError: null, lastPublishAt: null, lastFix: null };

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function getTrackingStatus(): Promise<TrackingStatus> {
  try {
    const raw = await AsyncStorage.getItem(STATUS_KEY);
    return raw ? { ...emptyStatus, ...(JSON.parse(raw) as Partial<TrackingStatus>) } : emptyStatus;
  } catch {
    return emptyStatus;
  }
}

async function patchStatus(patch: Partial<TrackingStatus>): Promise<void> {
  try {
    const current = await getTrackingStatus();
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // lo stato è solo diagnostica: mai propagare errori da qui
  }
}

// Client condiviso tra le esecuzioni del task finché il runtime resta vivo.
// `clientKey` invalida il client quando cambiano le impostazioni.
let sharedClient: MqttClient | null = null;
let sharedClientKey = '';

async function getConnectedClient(settings: TrackerSettings): Promise<MqttClient> {
  const key = JSON.stringify([
    settings.brokerUrl,
    settings.clientId,
    settings.username,
    settings.password,
  ]);
  if (sharedClient && sharedClient.isConnected && sharedClientKey === key) {
    return sharedClient;
  }
  sharedClient?.end();
  const client = new MqttClient({
    brokerUrl: settings.brokerUrl,
    clientId: settings.clientId,
    username: settings.username || undefined,
    password: settings.password || undefined,
  });
  await client.connect();
  sharedClient = client;
  sharedClientKey = key;
  return client;
}

// Payload in formato OwnTracks: i backend a valle (es. il listener PHP di
// navetta-argentario) identificano il dispositivo dal campo "tid" e si
// aspettano i nomi campo OwnTracks (tst in secondi, vel in km/h, cog in gradi).
function toPayload(location: Location.LocationObject, settings: TrackerSettings): string {
  const { coords, timestamp } = location;
  const payload: Record<string, unknown> = {
    _type: 'location',
    lat: coords.latitude,
    lon: coords.longitude,
    tst: Math.round(timestamp / 1000),
  };
  if (settings.trackerId.trim()) payload.tid = settings.trackerId.trim();
  if (coords.accuracy != null) payload.acc = Math.round(coords.accuracy);
  if (coords.altitude != null) payload.alt = Math.round(coords.altitude);
  if (coords.speed != null && coords.speed >= 0) payload.vel = Math.round(coords.speed * 3.6);
  if (coords.heading != null && coords.heading >= 0) payload.cog = Math.round(coords.heading);
  return JSON.stringify(payload);
}

// Il task DEVE essere definito nello scope globale (viene eseguito anche in
// headless, senza UI montata). L'handler non deve MAI lanciare: un'eccezione
// non gestita qui in release chiude l'app appena si apre — è esattamente il
// crash loop che questa versione elimina.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    try {
      if (error) {
        await patchStatus({ lastError: `Errore posizione: ${error.message}` });
        return;
      }
      const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
      if (locations.length === 0) return;

      const latest = locations[locations.length - 1];
      await patchStatus({
        lastFix: {
          lat: latest.coords.latitude,
          lon: latest.coords.longitude,
          acc: latest.coords.accuracy,
          at: latest.timestamp,
        },
      });

      const settings = await loadSettings();
      if (!settings.brokerUrl.trim()) {
        await patchStatus({ lastError: 'Broker MQTT non configurato: apri Impostazioni' });
        return;
      }

      const client = await getConnectedClient(settings);
      for (const location of locations.slice(-QUEUE_LIMIT)) {
        client.publish(settings.topic, toPayload(location, settings));
      }
      await patchStatus({ lastPublishAt: Date.now(), lastError: null });
    } catch (taskError) {
      sharedClient?.end();
      sharedClient = null;
      await patchStatus({ lastError: `Invio MQTT fallito: ${errorMessage(taskError)}` });
    }
  });
}

// Auto-riparazione del crash loop: se al lancio il task risulta registrato ma
// manca il permesso "Consenti sempre", Android può uccidere l'app quando il
// servizio di localizzazione prova a ripartire da solo. Deregistriamo subito
// il task, così al riavvio successivo l'app torna stabile.
if (Platform.OS !== 'web') {
  (async () => {
    try {
      if (!(await TaskManager.isTaskRegisteredAsync(LOCATION_TASK))) return;
      const background = await Location.getBackgroundPermissionsAsync();
      if (!background.granted) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
        await patchStatus({
          lastError:
            'Tracciamento disattivato automaticamente: mancava il permesso posizione "Consenti sempre". Concedilo dalle impostazioni dell\'app e premi di nuovo Avvia.',
        });
      }
    } catch {
      // la diagnostica non deve mai bloccare l'avvio
    }
  })();
}

export async function isTrackingActive(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

function locationTaskOptions(settings: TrackerSettings): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.High,
    timeInterval: settings.intervalSec * 1000,
    distanceInterval: settings.distanceM,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'k-city-track',
      notificationBody: 'Tracciamento posizione attivo',
      notificationColor: '#208AEF',
    },
  };
}

export async function startTracking(): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('il tracciamento non è supportato sul web');
  }

  const settings = await loadSettings();
  if (!settings.brokerUrl.trim()) {
    throw new Error('configura il broker MQTT nelle Impostazioni');
  }
  parseBrokerUrl(settings.brokerUrl);
  if (!settings.topic.trim()) {
    throw new Error('configura il topic MQTT nelle Impostazioni');
  }

  try {
    await setCrumb('richiesta del permesso di localizzazione');
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) {
      throw new Error('permesso di localizzazione negato');
    }

    // Senza "Consenti sempre" il riavvio automatico del servizio al prossimo
    // lancio dell'app viene bloccato da Android e uccide il processo (crash
    // loop). Meglio rifiutare l'avvio e guidare l'utente a concederlo.
    await setCrumb('verifica del permesso "Consenti sempre"');
    const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (!background?.granted) {
      throw new Error(
        'serve il permesso posizione "Consenti sempre". Tocca "Apri impostazioni app" → Autorizzazioni → Posizione → "Consenti sempre", poi premi di nuovo Avvia',
      );
    }

    // Verifica subito la raggiungibilità del broker: meglio un errore chiaro
    // adesso che pubblicazioni silenziosamente fallite dopo.
    await setCrumb('connessione di prova al broker MQTT');
    const probe = new MqttClient({
      brokerUrl: settings.brokerUrl,
      clientId: settings.clientId,
      username: settings.username || undefined,
      password: settings.password || undefined,
    });
    try {
      await probe.connect();
    } catch (probeError) {
      throw new Error(`Broker MQTT non connesso (${errorMessage(probeError)})`);
    } finally {
      probe.end();
    }

    await setCrumb('avvio del servizio di localizzazione in foreground');
    await Location.startLocationUpdatesAsync(LOCATION_TASK, locationTaskOptions(settings));
    await patchStatus({ lastError: null });
  } finally {
    // Se siamo ancora vivi l'eventuale errore è già gestito dalla UI: il
    // breadcrumb serve solo a diagnosticare le morti improvvise del processo.
    await clearCrumb();
  }
}

export async function stopTracking(): Promise<void> {
  sharedClient?.end();
  sharedClient = null;
  if (await isTrackingActive()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/**
 * Riapplica le impostazioni al tracciamento in corso (chiamata dopo un
 * salvataggio). Se il tracking non è attivo non fa nulla.
 */
export async function applySettingsToRunningTracking(settings: TrackerSettings): Promise<void> {
  sharedClient?.end();
  sharedClient = null;
  if (await isTrackingActive()) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, locationTaskOptions(settings));
  }
}
