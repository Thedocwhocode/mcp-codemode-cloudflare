export function classifyOperation(path: string, method: string): 'read' | 'write' | 'destructive';
export function isRpc(path: string): boolean;
