import { createFileRoute } from '@tanstack/react-router';
import { RouteStub } from '../features/shell/chrome/route-stub.js';

export const Route = createFileRoute('/dig/$dialogId')({
  component: () => <RouteStub scr="SCR-07" title="디깅" />,
});
