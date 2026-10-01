export const get = (u: string) => fetch(u); // EXPECT[security/web-fetch-outside-lib]
export const stream = (u: string) => new EventSource(u); // EXPECT[security/web-fetch-outside-lib]
