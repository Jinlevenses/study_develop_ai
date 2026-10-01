export const get = (u: string) => fetch(u);
export const stream = (u: string) => new EventSource(u);
