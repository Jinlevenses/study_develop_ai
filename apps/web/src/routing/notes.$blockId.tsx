import { createFileRoute } from '@tanstack/react-router';
import { RouteStub } from '../features/shell/chrome/route-stub.js';

export const Route = createFileRoute('/notes/$blockId')({
  component: () => <RouteStub scr="SCR-06" title="백지노트" />,
});
