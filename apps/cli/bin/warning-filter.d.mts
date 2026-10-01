export function installExperimentalWarningFilter(target: {
  emitWarning: (warning: unknown, ...rest: unknown[]) => void;
}): void;
