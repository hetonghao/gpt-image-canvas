import { eq } from "drizzle-orm";
import type { CloudStorageProvider, SaveStorageConfigRequest, S3EndpointMode, StorageConfigResponse, StorageTestResult } from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import {
  CosAssetStorageAdapter,
  normalizeKeyPrefix,
  S3CompatibleAssetStorageAdapter,
  storageErrorMessage,
  type CosStorageAdapterConfig,
  type S3StorageAdapterConfig
} from "../../infrastructure/storage/asset-storage.js";
import { storageConfigs } from "../../infrastructure/schema.js";
import type { HostContext } from "../host/host-adapter.js";

const DEFAULT_COS_BUCKET = process.env.COS_DEFAULT_BUCKET?.trim() || "source-1253253332";
const DEFAULT_COS_REGION = process.env.COS_DEFAULT_REGION?.trim() || "ap-nanjing";
const DEFAULT_COS_KEY_PREFIX = process.env.COS_DEFAULT_KEY_PREFIX?.trim() || "gpt-image-canvas/assets";
const DEFAULT_S3_BUCKET = process.env.S3_DEFAULT_BUCKET?.trim() || "";
const DEFAULT_S3_REGION = process.env.S3_DEFAULT_REGION?.trim() || "auto";
const DEFAULT_S3_KEY_PREFIX = process.env.S3_DEFAULT_KEY_PREFIX?.trim() || "gpt-image-canvas/assets";
const DEFAULT_S3_ACCOUNT_ID = process.env.R2_DEFAULT_ACCOUNT_ID?.trim() || "";
const DEFAULT_S3_CUSTOM_ENDPOINT = process.env.S3_DEFAULT_ENDPOINT?.trim() || "";
const DEFAULT_S3_ENDPOINT = DEFAULT_S3_CUSTOM_ENDPOINT || buildR2Endpoint(DEFAULT_S3_ACCOUNT_ID);
const DEFAULT_S3_ENDPOINT_MODE: S3EndpointMode = DEFAULT_S3_CUSTOM_ENDPOINT ? "custom" : "r2-account";
const STORAGE_PROVIDERS = ["cos", "s3"] as const satisfies readonly CloudStorageProvider[];

type StorageConfigRow = typeof storageConfigs.$inferSelect;
type ResolvedS3StorageAdapterConfig = S3StorageAdapterConfig & {
  endpointMode: S3EndpointMode;
  accountId: string | null;
};

export type ActiveCloudStorageConfig =
  | {
      provider: "cos";
      config: CosStorageAdapterConfig;
    }
  | {
      provider: "s3";
      config: S3StorageAdapterConfig;
    };

export function getStorageConfig(hostContext?: HostContext): StorageConfigResponse {
  return toStorageConfigResponse(hostContext);
}

export function getActiveCloudStorageConfig(hostContext?: HostContext): ActiveCloudStorageConfig | undefined {
  const row = getPreferredStorageConfigRow(hostContext);
  if (!row || row.enabled !== 1 || !isStorageProvider(row.provider)) {
    return undefined;
  }

  if (row.provider === "cos") {
    const config = rowToCosAdapterConfig(row);
    return config ? { provider: "cos", config } : undefined;
  }

  const config = rowToS3AdapterConfig(row);
  return config ? { provider: "s3", config } : undefined;
}

export async function saveStorageConfig(input: SaveStorageConfigRequest, hostContext?: HostContext): Promise<StorageConfigResponse> {
  const now = new Date().toISOString();
  const provider = input.provider;

  if (!STORAGE_PROVIDERS.includes(provider)) {
    throw new Error("Unsupported cloud storage provider.");
  }

  if (!input.enabled) {
    const existing = getStorageConfigRow(provider, hostContext);
    upsertStorageConfig({
      ...defaultRowForProvider(provider, now, hostContext),
      ...existing,
      id: scopedStorageId(provider, hostContext),
      userId: hostUserId(hostContext),
      provider,
      enabled: 0,
      updatedAt: now
    });
    disableOtherStorageProviders(provider, now, hostContext);
    return getStorageConfig(hostContext);
  }

  const existing = getStorageConfigRow(provider, hostContext);
  const parsed = provider === "cos" ? resolveCosConfigForSave(input, existing) : resolveS3ConfigForSave(input, existing);

  if (provider === "cos") {
    await new CosAssetStorageAdapter(parsed as CosStorageAdapterConfig).testConfig();
  } else {
    await new S3CompatibleAssetStorageAdapter(parsed as S3StorageAdapterConfig).testConfig();
  }

  upsertStorageConfig({
    ...rowForParsedConfig(provider, parsed, existing, now, hostContext),
    enabled: 1
  });
  disableOtherStorageProviders(provider, now, hostContext);

  return getStorageConfig(hostContext);
}

export async function testStorageConfig(input: SaveStorageConfigRequest, hostContext?: HostContext): Promise<StorageTestResult> {
  try {
    if (input.provider === "cos") {
      const parsed = resolveCosConfigForSave(input, getStorageConfigRow("cos", hostContext));
      await new CosAssetStorageAdapter(parsed).testConfig();
      return {
        ok: true,
        message: "COS configuration is available."
      };
    }

    if (input.provider === "s3") {
      const parsed = resolveS3ConfigForSave(input, getStorageConfigRow("s3", hostContext));
      await new S3CompatibleAssetStorageAdapter(parsed).testConfig();
      return {
        ok: true,
        message: "S3-compatible storage configuration is available."
      };
    }

    throw new Error("Unsupported cloud storage provider.");
  } catch (error) {
    return {
      ok: false,
      message: storageErrorMessage(error)
    };
  }
}

function getStorageConfigRow(provider: CloudStorageProvider, hostContext?: HostContext): StorageConfigRow | undefined {
  return db.select().from(storageConfigs).where(eq(storageConfigs.id, scopedStorageId(provider, hostContext))).get();
}

function getPreferredStorageConfigRow(hostContext?: HostContext): StorageConfigRow | undefined {
  const rows = db
    .select()
    .from(storageConfigs)
    .where(eq(storageConfigs.userId, hostUserId(hostContext)))
    .all()
    .filter((row) => isStorageProvider(row.provider));
  const enabled = rows.find((row) => row.enabled === 1);
  if (enabled) {
    return enabled;
  }

  return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function upsertStorageConfig(row: StorageConfigRow): void {
  db.insert(storageConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: storageConfigs.id,
      set: {
        provider: row.provider,
        enabled: row.enabled,
        secretId: row.secretId,
        secretKey: row.secretKey,
        bucket: row.bucket,
        region: row.region,
        keyPrefix: row.keyPrefix,
        endpointMode: row.endpointMode,
        accountId: row.accountId,
        endpoint: row.endpoint,
        forcePathStyle: row.forcePathStyle,
        updatedAt: row.updatedAt
      }
    })
    .run();
}

function disableOtherStorageProviders(activeProvider: CloudStorageProvider, updatedAt: string, hostContext?: HostContext): void {
  for (const provider of STORAGE_PROVIDERS) {
    if (provider === activeProvider) {
      continue;
    }

    const row = getStorageConfigRow(provider, hostContext);
    if (!row || row.enabled !== 1) {
      continue;
    }

    upsertStorageConfig({
      ...row,
      enabled: 0,
      updatedAt
    });
  }
}

function resolveCosConfigForSave(input: SaveStorageConfigRequest, existing: StorageConfigRow | undefined): CosStorageAdapterConfig {
  if (input.provider !== "cos") {
    throw new Error("Tencent COS configuration is required.");
  }

  const cos = input.cos;
  if (!cos) {
    throw new Error("COS configuration is required.");
  }

  const secretId = requiredString(cos.secretId, "COS SecretId");
  const secretKey = cos.preserveSecret ? existing?.secretKey : cos.secretKey;
  const bucket = requiredString(cos.bucket, "COS bucket");
  const region = requiredString(cos.region, "COS region");

  if (!secretKey?.trim()) {
    throw new Error("COS SecretKey is required.");
  }

  return {
    secretId,
    secretKey: secretKey.trim(),
    bucket,
    region,
    keyPrefix: normalizeKeyPrefix(cos.keyPrefix)
  };
}

function resolveS3ConfigForSave(input: SaveStorageConfigRequest, existing: StorageConfigRow | undefined): ResolvedS3StorageAdapterConfig {
  if (input.provider !== "s3") {
    throw new Error("S3-compatible storage configuration is required.");
  }

  const s3 = input.s3;
  if (!s3) {
    throw new Error("S3-compatible storage configuration is required.");
  }

  const endpointMode = normalizeS3EndpointMode(s3.endpointMode);
  const accessKeyId = requiredString(s3.accessKeyId, "S3 Access Key ID");
  const secretAccessKey = s3.preserveSecret ? existing?.secretKey : s3.secretAccessKey;
  const bucket = requiredString(s3.bucket, "S3 bucket");
  const region = requiredString(s3.region || DEFAULT_S3_REGION, "S3 region");
  const endpoint =
    endpointMode === "r2-account"
      ? buildR2Endpoint(requiredAccountId(s3.accountId))
      : normalizeEndpoint(requiredString(s3.endpoint, "S3 endpoint"));

  if (!secretAccessKey?.trim()) {
    throw new Error("S3 Secret Access Key is required.");
  }

  return {
    accessKeyId,
    secretAccessKey: secretAccessKey.trim(),
    bucket,
    region,
    keyPrefix: normalizeKeyPrefix(s3.keyPrefix),
    endpoint,
    forcePathStyle: endpointMode === "custom" ? Boolean(s3.forcePathStyle) : false,
    endpointMode,
    accountId: endpointMode === "r2-account" ? requiredAccountId(s3.accountId) : s3.accountId?.trim() || null
  };
}

function rowToCosAdapterConfig(row: StorageConfigRow): CosStorageAdapterConfig | undefined {
  if (row.provider !== "cos" || !row.secretId || !row.secretKey || !row.bucket || !row.region) {
    return undefined;
  }

  return {
    secretId: row.secretId,
    secretKey: row.secretKey,
    bucket: row.bucket,
    region: row.region,
    keyPrefix: normalizeKeyPrefix(row.keyPrefix ?? DEFAULT_COS_KEY_PREFIX)
  };
}

function rowToS3AdapterConfig(row: StorageConfigRow): S3StorageAdapterConfig | undefined {
  if (row.provider !== "s3" || !row.secretId || !row.secretKey || !row.bucket || !row.region || !row.endpoint) {
    return undefined;
  }

  return {
    accessKeyId: row.secretId,
    secretAccessKey: row.secretKey,
    bucket: row.bucket,
    region: row.region,
    keyPrefix: normalizeKeyPrefix(row.keyPrefix ?? DEFAULT_S3_KEY_PREFIX),
    endpoint: row.endpoint,
    forcePathStyle: row.forcePathStyle === 1
  };
}

function rowForParsedConfig(
  provider: CloudStorageProvider,
  parsed: CosStorageAdapterConfig | ResolvedS3StorageAdapterConfig,
  existing: StorageConfigRow | undefined,
  now: string,
  hostContext?: HostContext
): StorageConfigRow {
  if (provider === "cos") {
    const config = parsed as CosStorageAdapterConfig;
    return {
      id: scopedStorageId(provider, hostContext),
      userId: hostUserId(hostContext),
      provider,
      enabled: 1,
      secretId: config.secretId,
      secretKey: config.secretKey,
      bucket: config.bucket,
      region: config.region,
      keyPrefix: config.keyPrefix,
      endpointMode: null,
      accountId: null,
      endpoint: null,
      forcePathStyle: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
  }

  const config = parsed as ResolvedS3StorageAdapterConfig;
  return {
    id: scopedStorageId(provider, hostContext),
    userId: hostUserId(hostContext),
    provider,
    enabled: 1,
    secretId: config.accessKeyId,
    secretKey: config.secretAccessKey,
    bucket: config.bucket,
    region: config.region,
    keyPrefix: config.keyPrefix,
    endpointMode: config.endpointMode,
    accountId: config.accountId,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ? 1 : 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function defaultRowForProvider(provider: CloudStorageProvider, now: string, hostContext?: HostContext): StorageConfigRow {
  if (provider === "cos") {
    return {
      id: scopedStorageId("cos", hostContext),
      userId: hostUserId(hostContext),
      provider: "cos",
      enabled: 0,
      secretId: null,
      secretKey: null,
      bucket: DEFAULT_COS_BUCKET,
      region: DEFAULT_COS_REGION,
      keyPrefix: normalizeKeyPrefix(DEFAULT_COS_KEY_PREFIX),
      endpointMode: null,
      accountId: null,
      endpoint: null,
      forcePathStyle: null,
      createdAt: now,
      updatedAt: now
    };
  }

  return {
    id: scopedStorageId("s3", hostContext),
    userId: hostUserId(hostContext),
    provider: "s3",
    enabled: 0,
    secretId: null,
    secretKey: null,
    bucket: DEFAULT_S3_BUCKET,
    region: DEFAULT_S3_REGION,
    keyPrefix: normalizeKeyPrefix(DEFAULT_S3_KEY_PREFIX),
    endpointMode: DEFAULT_S3_ENDPOINT_MODE,
    accountId: DEFAULT_S3_ACCOUNT_ID || null,
    endpoint: DEFAULT_S3_ENDPOINT || null,
    forcePathStyle: 0,
    createdAt: now,
    updatedAt: now
  };
}

function toStorageConfigResponse(hostContext?: HostContext): StorageConfigResponse {
  const now = new Date().toISOString();
  const preferred = getPreferredStorageConfigRow(hostContext);
  const provider = isStorageProvider(preferred?.provider) ? preferred.provider : "cos";
  const cosRow = getStorageConfigRow("cos", hostContext) ?? defaultRowForProvider("cos", now, hostContext);
  const s3Row = getStorageConfigRow("s3", hostContext) ?? defaultRowForProvider("s3", now, hostContext);

  return {
    enabled: preferred?.enabled === 1,
    provider,
    cos: {
      secretId: cosRow.secretId ?? "",
      secretKey: {
        hasSecret: Boolean(cosRow.secretKey),
        value: cosRow.secretKey ? maskSecret(cosRow.secretKey) : undefined
      },
      bucket: cosRow.bucket ?? DEFAULT_COS_BUCKET,
      region: cosRow.region ?? DEFAULT_COS_REGION,
      keyPrefix: normalizeKeyPrefix(cosRow.keyPrefix ?? DEFAULT_COS_KEY_PREFIX)
    },
    s3: {
      accessKeyId: s3Row.secretId ?? "",
      secretAccessKey: {
        hasSecret: Boolean(s3Row.secretKey),
        value: s3Row.secretKey ? maskSecret(s3Row.secretKey) : undefined
      },
      bucket: s3Row.bucket ?? DEFAULT_S3_BUCKET,
      region: s3Row.region ?? DEFAULT_S3_REGION,
      keyPrefix: normalizeKeyPrefix(s3Row.keyPrefix ?? DEFAULT_S3_KEY_PREFIX),
      endpointMode: normalizeS3EndpointMode(s3Row.endpointMode ?? "r2-account"),
      accountId: s3Row.accountId ?? DEFAULT_S3_ACCOUNT_ID,
      endpoint: s3Row.endpoint ?? DEFAULT_S3_ENDPOINT,
      forcePathStyle: s3Row.forcePathStyle === 1
    }
  };
}

function requiredString(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function requiredAccountId(value: string | undefined): string {
  const accountId = requiredString(value, "Cloudflare R2 Account ID");
  if (!/^[a-z0-9]+$/iu.test(accountId)) {
    throw new Error("Cloudflare R2 Account ID can only contain letters and numbers.");
  }

  return accountId;
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("S3 endpoint must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("S3 endpoint must use http or https.");
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function buildR2Endpoint(accountId: string): string {
  const trimmed = accountId.trim();
  return trimmed ? `https://${trimmed}.r2.cloudflarestorage.com` : "";
}

function normalizeS3EndpointMode(value: string | undefined): S3EndpointMode {
  return value === "custom" ? "custom" : "r2-account";
}

function isStorageProvider(value: string | undefined): value is CloudStorageProvider {
  return value === "cos" || value === "s3";
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

function hostUserId(hostContext: HostContext | undefined): string {
  return hostContext?.user.id ?? "standalone";
}

function scopedStorageId(provider: CloudStorageProvider, hostContext: HostContext | undefined): string {
  const userId = hostUserId(hostContext);
  return userId === "standalone" ? provider : `${userId}:${provider}`;
}
