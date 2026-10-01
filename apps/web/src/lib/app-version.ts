declare const __FATHOM_APP_VERSION__: string;

/** 앱 버전 — vite.config.ts의 `define`이 루트 package.json `version`을 주입한다(supervisor `app_version`과 같은 원천). */
export const APP_VERSION: string = typeof __FATHOM_APP_VERSION__ === 'string' ? __FATHOM_APP_VERSION__ : '0.0.0';

/** `x-fathom-client` 헤더 값(STD-WEB-12). */
export const CLIENT_HEADER: string = `web/${APP_VERSION}`;
