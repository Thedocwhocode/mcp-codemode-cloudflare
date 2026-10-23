import table from '../../policy/classification.json';
import type { Mode } from '../config/projects';

export type OpClass = 'read' | 'write' | 'destructive';

// Fora da tabela (ou método diferente do da spec) = destructive: fail-closed.
export function classify(method: string, path: string): OpClass {
  const cls = (table as Record<string, OpClass>)[path];
  if (!cls) return 'destructive';
  if ((cls === 'read') !== (method === 'GET')) return 'destructive';
  return cls;
}

export type Decision = 'allow' | 'approval' | 'deny';

// readonly: só leitura. readwrite: leitura e escrita; destrutiva sempre passa por aprovação.
export function decide(mode: Mode, cls: OpClass): Decision {
  if (cls === 'read') return 'allow';
  if (mode !== 'readwrite') return 'deny';
  return cls === 'write' ? 'allow' : 'approval';
}
