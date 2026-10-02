import { createFileRoute } from '@tanstack/react-router';
import { RouteStub } from '../features/shell/chrome/route-stub.js';

export const Route = createFileRoute('/cases/$runId')({
  component: () => <RouteStub scr="SCR-08" title="Case" />,
});
