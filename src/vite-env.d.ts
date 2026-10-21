/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** マルチプレイ用サーバー（Cloudflare Workers）の URL。未設定ならオンライン機能は使えない */
  readonly VITE_SERVER_URL?: string;
}
