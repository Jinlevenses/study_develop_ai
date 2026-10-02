import { createFileRoute } from '@tanstack/react-router';
import { RouteStub } from '../features/shell/chrome/route-stub.js';

export const Route = createFileRoute('/season')({
  component: () => <RouteStub scr="SCR-11" title="시즌" />,
});
