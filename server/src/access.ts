/** 接続を断る理由（クライアントに error として伝える） */
export type DenyReason = 'origin' | 'region';

export interface AccessConfig {
  /** 接続を受け付けるページの Origin（カンマ区切り）。"*" なら制限しない */
  allowedOrigins: string;
  /** 接続を受け付ける国（ISO 3166 の2文字、カンマ区切り）。"*" なら制限しない */
  allowedCountries: string;
}

function list(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 手元で開いたページ（vite dev / preview）は常に通す */
function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * 接続してきたページの Origin と国（Cloudflare が IP から判定したもの）を見て、
 * 断るならその理由を返す。Origin はブラウザ以外なら偽装できるので、
 * 他のサイトに埋め込まれて使われるのを防ぐためのもの。
 */
export function checkAccess(origin: string | null, country: string | undefined, config: AccessConfig): DenyReason | null {
  const origins = list(config.allowedOrigins);
  if (!origins.includes('*')) {
    if (!origin || (!isLocalOrigin(origin) && !origins.includes(origin))) return 'origin';
  }
  const countries = list(config.allowedCountries).map((c) => c.toUpperCase());
  if (!countries.includes('*')) {
    if (!country || !countries.includes(country.toUpperCase())) return 'region';
  }
  return null;
}
