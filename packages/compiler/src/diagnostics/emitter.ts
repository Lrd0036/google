import type { DiagnosticArtifact, DiagnosticItem } from '@runbook/types';

export class DiagnosticCollector {
  private diagnostics: DiagnosticItem[] = [];

  public add(item: DiagnosticItem): void {
    this.diagnostics.push(item);
  }

  public hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === 'ERROR');
  }

  public toArtifact(): DiagnosticArtifact {
    return {
      diagnostic_version: 'rb-diagnostic/v0.1',
      diagnostics: [...this.diagnostics],
    };
  }

  public clear(): void {
    this.diagnostics = [];
  }
}
