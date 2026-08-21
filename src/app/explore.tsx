import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useState, type ReactNode } from 'react';
import { Directory, File } from 'expo-file-system';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  defaultSettings,
  loadSettings,
  parseBrokerUrl,
  saveSettings,
  type TrackerSettings,
} from '@/lib/settings';
import { applySettingsToRunningTracking, errorMessage } from '@/lib/tracking';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <ThemedView type="backgroundElement" style={styles.sectionCard}>
        {children}
      </ThemedView>
    </View>
  );
}

type FieldProps = TextInputProps & { label: string; hint?: string };

function Field({ label, hint, ...inputProps }: FieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        style={[styles.input, { backgroundColor: theme.background, color: theme.text }]}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
      />
      {hint && (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();

  const [settings, setSettings] = useState<TrackerSettings>(defaultSettings);
  const [intervalText, setIntervalText] = useState(String(defaultSettings.intervalSec));
  const [distanceText, setDistanceText] = useState(String(defaultSettings.distanceM));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [transferStatus, setTransferStatus] = useState<{ text: string; isError: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!transferStatus || transferStatus.isError) return;
    const timer = setTimeout(() => setTransferStatus(null), 5000);
    return () => clearTimeout(timer);
  }, [transferStatus]);

  const onExport = async () => {
    setTransferStatus(null);
    try {
      const directory = await Directory.pickDirectoryAsync();
      const exported = {
        brokerUrl: settings.brokerUrl.trim(),
        topic: settings.topic.trim(),
        username: settings.username,
        password: settings.password,
        intervalSec: Math.max(1, Number.parseInt(intervalText, 10) || settings.intervalSec),
        distanceM: Math.max(0, Number.parseInt(distanceText, 10) || settings.distanceM),
      };
      const file = directory.createFile('k-city-track-config.json', 'application/json');
      file.write(JSON.stringify(exported, null, 2));
      setTransferStatus({
        text: 'Configurazione salvata come k-city-track-config.json nella cartella scelta.',
        isError: false,
      });
    } catch (exportError) {
      if (/cancel|dismiss|annull/i.test(errorMessage(exportError))) return;
      setTransferStatus({ text: `Export non riuscito: ${errorMessage(exportError)}`, isError: true });
    }
  };

  const onImport = async () => {
    setTransferStatus(null);
    try {
      const picked = await File.pickFileAsync();
      if (picked.canceled || !picked.result) return;
      const content = await picked.result.text();
      let raw: unknown;
      try {
        raw = JSON.parse(content.trim());
      } catch {
        throw new Error('il file scelto non è una configurazione valida');
      }
      if (typeof raw !== 'object' || raw === null) {
        throw new Error('il file scelto non è una configurazione valida');
      }
      const source = raw as Record<string, unknown>;
      // Il Client ID non viene mai importato (deve restare unico per
      // dispositivo). Il Tracker ID invece viene applicato se il file lo
      // dichiara: i file preparati per il singolo bus lo contengono.
      const next: TrackerSettings = { ...settings };
      if (typeof source.trackerId === 'string' && source.trackerId.trim()) {
        next.trackerId = source.trackerId.trim();
      }
      if (typeof source.brokerUrl === 'string') next.brokerUrl = source.brokerUrl.trim();
      if (typeof source.topic === 'string') next.topic = source.topic.trim();
      if (typeof source.username === 'string') next.username = source.username;
      if (typeof source.password === 'string') next.password = source.password;
      if (typeof source.intervalSec === 'number' && Number.isFinite(source.intervalSec)) {
        next.intervalSec = Math.max(1, Math.round(source.intervalSec));
      }
      if (typeof source.distanceM === 'number' && Number.isFinite(source.distanceM)) {
        next.distanceM = Math.max(0, Math.round(source.distanceM));
      }
      if (next.brokerUrl) {
        parseBrokerUrl(next.brokerUrl);
      }
      await saveSettings(next);
      setSettings(next);
      setIntervalText(String(next.intervalSec));
      setDistanceText(String(next.distanceM));
      await applySettingsToRunningTracking(next);
      setTransferStatus({
        text:
          `Importata e applicata: tracker "${next.trackerId || '(vuoto!)'}" · ` +
          `${next.brokerUrl} · topic ${next.topic} · ${next.intervalSec}s / ${next.distanceM}m`,
        isError: false,
      });
    } catch (importError) {
      setTransferStatus({ text: `Import non riuscito: ${errorMessage(importError)}`, isError: true });
    }
  };

  const onCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus('Controllo aggiornamenti…');
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setUpdateStatus('Aggiornamento trovato, lo scarico…');
        await Updates.fetchUpdateAsync();
        setUpdateStatus('Riavvio con la nuova versione…');
        await Updates.reloadAsync();
      } else {
        setUpdateStatus("Sei già all'ultima versione.");
      }
    } catch (checkError) {
      setUpdateStatus(`Controllo non riuscito: ${errorMessage(checkError)}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    loadSettings().then((stored) => {
      setSettings(stored);
      setIntervalText(String(stored.intervalSec));
      setDistanceText(String(stored.distanceM));
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<TrackerSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setFeedback(null);
  };

  const onSave = async () => {
    setError(null);
    setFeedback(null);
    try {
      if (settings.brokerUrl.trim()) {
        parseBrokerUrl(settings.brokerUrl);
      }
      // Campo vuoto o non numerico: si conserva il valore attuale invece di
      // saltare a un default a sorpresa.
      const parsedInterval = Number.parseInt(intervalText, 10);
      const intervalSec = Number.isFinite(parsedInterval)
        ? Math.max(1, parsedInterval)
        : settings.intervalSec;
      const parsedDistance = Number.parseInt(distanceText, 10);
      const distanceM = Number.isFinite(parsedDistance)
        ? Math.max(0, parsedDistance)
        : settings.distanceM;
      const next: TrackerSettings = {
        ...settings,
        brokerUrl: settings.brokerUrl.trim(),
        topic: settings.topic.trim(),
        trackerId: settings.trackerId.trim(),
        clientId: settings.clientId.trim(),
        intervalSec,
        distanceM,
      };
      await saveSettings(next);
      setSettings(next);
      setIntervalText(String(intervalSec));
      setDistanceText(String(distanceM));
      await applySettingsToRunningTracking(next);
      setFeedback('Impostazioni salvate.');
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: safeAreaInsets.top,
      paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    },
    web: {
      paddingTop: Spacing.six,
      paddingBottom: Spacing.four,
    },
  });

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={{ bottom: BottomTabInset + Spacing.three }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" style={styles.title}>
          Impostazioni
        </ThemedText>

        <Section title="BROKER MQTT">
          <Field
            label="Indirizzo broker"
            hint="mqtts://host:porta per TLS oppure mqtt://host:porta in chiaro."
            placeholder="mqtts://mqtt.esempio.it:8883"
            keyboardType="url"
            value={settings.brokerUrl}
            onChangeText={(brokerUrl) => update({ brokerUrl })}
          />
          <Field
            label="Username"
            hint="Lascia vuoto se il broker non richiede autenticazione."
            value={settings.username}
            onChangeText={(username) => update({ username })}
          />
          <Field
            label="Password"
            secureTextEntry
            value={settings.password}
            onChangeText={(password) => update({ password })}
          />
        </Section>

        <Section title="PUBBLICAZIONE">
          <Field
            label="Topic"
            placeholder="k-city-track/position"
            value={settings.topic}
            onChangeText={(topic) => update({ topic })}
          />
          <Field
            label="Tracker ID (tid)"
            hint="Identifica questo dispositivo nel payload OwnTracks, es. bus1, bus2…"
            placeholder="bus1"
            value={settings.trackerId}
            onChangeText={(trackerId) => update({ trackerId })}
          />
          <Field
            label="Client ID"
            placeholder="k-city-track-abc123"
            value={settings.clientId}
            onChangeText={(clientId) => update({ clientId })}
          />
        </Section>

        <Section title="FREQUENZA">
          <Field
            label="Intervallo (secondi)"
            keyboardType="numeric"
            value={intervalText}
            onChangeText={setIntervalText}
          />
          <Field
            label="Distanza minima (metri)"
            keyboardType="numeric"
            value={distanceText}
            onChangeText={setDistanceText}
          />
        </Section>

        {error && (
          <View style={[styles.messageCard, { backgroundColor: theme.dangerTint }]}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          </View>
        )}
        {feedback && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {feedback}
          </ThemedText>
        )}

        <Pressable
          onPress={onSave}
          disabled={!loaded}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: theme.accent },
            pressed && styles.pressed,
          ]}>
          <ThemedText style={styles.saveButtonText}>Salva impostazioni</ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          Le modifiche vengono applicate automaticamente al tracciamento in corso.
        </ThemedText>

        <Section title="IMPORTA / ESPORTA">
          <View style={styles.buttonRow}>
            <Pressable
              onPress={onExport}
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.rowButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">Esporta su file</ThemedText>
            </Pressable>
            <Pressable
              onPress={onImport}
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.rowButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">Importa da file</ThemedText>
            </Pressable>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            L&apos;export contiene broker, credenziali, topic e frequenza (senza Tracker ID né
            Client ID). Se un file importato dichiara un Tracker ID, viene applicato.
          </ThemedText>
          {transferStatus && (
            <ThemedText
              type="small"
              themeColor={transferStatus.isError ? undefined : 'textSecondary'}
              style={[styles.centerText, transferStatus.isError && { color: theme.danger }]}>
              {transferStatus.text}
            </ThemedText>
          )}
        </Section>

        <Section title="AGGIORNAMENTI">
          <ThemedText type="small" themeColor="textSecondary">
            Versione {Constants.expoConfig?.version ?? '?'}
            {Updates.updateId ? ` · update ${Updates.updateId.slice(0, 8)}` : ' · build base'}
          </ThemedText>
          <Pressable
            onPress={onCheckUpdates}
            disabled={checkingUpdate}
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: theme.backgroundSelected },
              (pressed || checkingUpdate) && styles.pressed,
            ]}>
            <ThemedText type="smallBold">Controlla aggiornamenti</ThemedText>
          </Pressable>
          {updateStatus && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {updateStatus}
            </ThemedText>
          )}
        </Section>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    letterSpacing: 1,
    marginLeft: Spacing.two,
  },
  sectionCard: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  rowButton: {
    flex: 1,
  },
  messageCard: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    minHeight: 56,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: 700,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.7,
  },
});
