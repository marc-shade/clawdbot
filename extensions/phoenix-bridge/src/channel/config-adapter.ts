/**
 * Phoenix Channel - Config Adapter
 *
 * Manages Phoenix "accounts" in OpenClaw config. Phoenix uses a single
 * default account (no multi-account support needed — it's a local system channel).
 */

const DEFAULT_ACCOUNT_ID = "default";

export type ResolvedPhoenixAccount = {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
};

type PhoenixChannelConfig = {
  enabled?: boolean;
  autoReply?: boolean;
  eventTypes?: string[];
};

type OpenClawConfig = {
  channels?: {
    phoenix?: PhoenixChannelConfig;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function createPhoenixConfigAdapter() {
  return {
    listAccountIds: (_cfg: OpenClawConfig): string[] => {
      return [DEFAULT_ACCOUNT_ID];
    },

    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null): ResolvedPhoenixAccount => {
      const phoenixCfg = cfg.channels?.phoenix;
      return {
        accountId: accountId ?? DEFAULT_ACCOUNT_ID,
        name: "Phoenix AGI",
        enabled: phoenixCfg?.enabled !== false,
        configured: true, // Always configured — uses phoenix-bridge MCP client
      };
    },

    defaultAccountId: (_cfg: OpenClawConfig): string => DEFAULT_ACCOUNT_ID,

    isConfigured: (_account: ResolvedPhoenixAccount): boolean => true,

    describeAccount: (account: ResolvedPhoenixAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),

    setAccountEnabled: ({
      cfg,
      enabled,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      enabled: boolean;
    }): OpenClawConfig => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        phoenix: {
          ...cfg.channels?.phoenix,
          enabled,
        },
      },
    }),
  };
}
