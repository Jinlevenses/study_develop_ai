import { get } from '../../lib/api.ts';

export const client = {
  fetch(u: string) {
    return get(u);
  },
};
export const call = (u: string) => client.fetch(u);
