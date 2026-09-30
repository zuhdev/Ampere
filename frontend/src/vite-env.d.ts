/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_REGISTRY?: string;
  readonly VITE_VAULT?: string;
  readonly VITE_PAYMASTER?: string;
  readonly VITE_COUNTER?: string;
  readonly VITE_APP_KEY?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
