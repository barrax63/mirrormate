import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

/** Every language the app has text for */
export const LOCALES = ["en", "ja", "de"] as const;

export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value);
}

export interface AppConfig {
  app: {
    locale: Locale;
  };
}

let cachedConfig: AppConfig | null = null;

function getConfigPath(): string {
  const configDir = path.join(process.cwd(), "config");

  if (process.env.APP_CONFIG) {
    return path.join(configDir, process.env.APP_CONFIG);
  }

  return path.join(configDir, "app.yaml");
}

export function loadAppConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getConfigPath();
  console.log(`[App] Loading config from: ${configPath}`);

  if (!fs.existsSync(configPath)) {
    console.log("[App] Config file not found, using defaults");
    return {
      app: {
        locale: "ja",
      },
    };
  }

  const fileContents = fs.readFileSync(configPath, "utf8");
  cachedConfig = yaml.load(fileContents) as AppConfig;

  // Every table of text has an entry per locale, so an unknown one would fail everywhere
  const locale: unknown = cachedConfig.app?.locale;
  if (!isLocale(locale)) {
    console.warn(`[App] Unknown app.locale ${JSON.stringify(locale)}, using ja. Known: ${LOCALES.join(", ")}`);
    cachedConfig = { ...cachedConfig, app: { ...cachedConfig.app, locale: "ja" } };
  }

  return cachedConfig;
}

export function getLocale(): Locale {
  // Environment variable takes precedence
  const envLocale = process.env.LOCALE;
  if (isLocale(envLocale)) {
    return envLocale;
  }

  const config = loadAppConfig();
  return config.app.locale;
}

export function clearAppConfigCache(): void {
  cachedConfig = null;
}
