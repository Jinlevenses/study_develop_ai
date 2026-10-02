import { createFileRoute } from '@tanstack/react-router';
import { RouteStub } from '../features/shell/chrome/route-stub.js';

export const Route = createFileRoute('/imports/$jobId')({
  component: () => <RouteStub scr="SCR-13" title="가져오기 스테이징" />,
});
