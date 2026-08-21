const { withMainApplication } = require('@expo/config-plugins');

// Inietta in MainApplication.onCreate un default UncaughtExceptionHandler che
// scrive lo stack trace dell'ultimo crash nativo/JVM in filesDir
// ("last_native_crash.txt", letto da src/lib/diagnostics.ts al riavvio).
// Senza adb è l'unico modo per vedere i crash che avvengono prima del JS.
const HANDLER_KOTLIN = `
    try {
      if (java.io.File(filesDir, "last_native_crash.txt").exists()) {
        // L'ultimo avvio e' morto prima di arrivare alla UI: disinnesca i task
        // in background (registro di expo-task-manager) e il servizio di
        // localizzazione pendente, cosi' l'app riesce ad aprirsi e a mostrare
        // il crash salvato invece di rientrare nel loop.
        getSharedPreferences("TaskManagerModule", android.content.Context.MODE_PRIVATE)
          .edit().clear().commit()
        try {
          stopService(
            android.content.Intent(
              this,
              Class.forName("expo.modules.location.services.LocationTaskService")
            )
          )
        } catch (ignored: Throwable) {}
      }
    } catch (ignored: Throwable) {}
    try {
      val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
        try {
          java.io.File(filesDir, "last_native_crash.txt").writeText(
            java.util.Date().toString() + "\\n" + android.util.Log.getStackTraceString(throwable)
          )
        } catch (ignored: Throwable) {}
        previousHandler?.uncaughtException(thread, throwable)
      }
    } catch (ignored: Throwable) {}
`;

module.exports = function withNativeCrashLogger(config) {
  return withMainApplication(config, (config) => {
    if (!config.modResults.contents.includes('last_native_crash')) {
      config.modResults.contents = config.modResults.contents.replace(
        'super.onCreate()',
        `super.onCreate()\n${HANDLER_KOTLIN}`,
      );
    }
    return config;
  });
};
