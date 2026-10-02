import { createFileRoute } from '@tanstack/react-router';
import { RouteStub } from '../features/shell/chrome/route-stub.js';

export const Route = createFileRoute('/artifacts/$runId')({
  component: () => <RouteStub scr="SCR-09" title="산출물" />,
});
