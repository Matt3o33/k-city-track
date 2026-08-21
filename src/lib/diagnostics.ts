import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const CRUMB_KEY = 'k-city-track/crumb/v1';
const CRASH_KEY = 'k-city-track/crash/v1';

/**
 * Breadcrumb: registra il passo in corso PRIMA di eseguirlo. Se l'app muore
 * per un crash nativo (che il JS non può intercettare), alla riapertura il
 * breadcrumb rimasto su disco dice esattamente in quale passo è successo.
 */
export async function setCrumb(step: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CRUMB_KEY, JSON.stringify({ step, at: Date.now() }));
  } catch {
    // la diagnostica non deve mai interferire col flusso principale
  }
}

export async function clearCrumb(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CRUMB_KEY);
  } catch {
    // idem
  }
}

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

/** Salva gli errori JS fatali prima che chiudano l'app (best effort). */
export function installGlobalErrorLogger(): void {
  if (Platform.OS === 'web') return;
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      const err = error as { message?: string; stack?: string } | undefined;
      const stack = (err?.stack ?? '').split('\n').slice(0, 6).join('\n');
      const text = `${isFatal ? 'Errore JS fatale' : 'Errore JS'}: ${err?.message ?? String(error)}${stack ? `\n${stack}` : ''}`;
      AsyncStorage.setItem(CRASH_KEY, JSON.stringify({ text, at: Date.now() })).catch(() => {});
    } catch {
      // mai peggiorare un crash in corso
    }
    previous?.(error, isFatal);
  });
}

/** Stack dell'ultimo crash nativo, scritto da MainApplication (config plugin). */
async function consumeNativeCrash(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const file = new File(Paths.document, 'last_native_crash.txt');
    if (!file.exists) return null;
    const text = await file.text();
    file.delete();
    const lines = text.trim().split('\n');
    if (lines.length === 0) return null;
    return (
      `Crash nativo (${lines[0]}):\n${lines.slice(1, 10).join('\n')}` +
      '\n\nIl tracciamento in background è stato disattivato automaticamente per interrompere il ciclo di crash.'
    );
  } catch {
    return null;
  }
}

/**
 * Da chiamare all'avvio della UI: restituisce (e azzera) il report
 * dell'eventuale chiusura anomala precedente.
 */
export async function consumeCrashReport(): Promise<string | null> {
  const nativeCrash = await consumeNativeCrash();
  if (nativeCrash) return nativeCrash;
  try {
    const [crashRaw, crumbRaw] = await Promise.all([
      AsyncStorage.getItem(CRASH_KEY),
      AsyncStorage.getItem(CRUMB_KEY),
    ]);
    await Promise.all([AsyncStorage.removeItem(CRASH_KEY), AsyncStorage.removeItem(CRUMB_KEY)]);
    if (crashRaw) {
      const crash = JSON.parse(crashRaw) as { text: string; at: number };
      return `Alle ${new Date(crash.at).toLocaleTimeString('it-IT')} — ${crash.text}`;
    }
    if (crumbRaw) {
      const crumb = JSON.parse(crumbRaw) as { step: string; at: number };
      return (
        `L'app si è chiusa improvvisamente durante: ${crumb.step} ` +
        `(${new Date(crumb.at).toLocaleTimeString('it-IT')}). Probabile crash nativo in quel passaggio.`
      );
    }
    return null;
  } catch {
    return null;
  }
}
