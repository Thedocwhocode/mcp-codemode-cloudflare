export function parseScalar(raw: string): { value: string } | { error: string };
export function parseFrontmatter(text: string): { fields: Record<string, string>; errors: string[] } | null;
