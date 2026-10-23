// Registro de projetos: alias → binding do Secrets Store com a key daquele projeto/usuário na API.
// Não é segredo, mas o nome do binding nunca sai para o modelo (ver publicProjects).
export type Mode = 'readonly' | 'readwrite';

export interface Project {
  keyBinding: string;
  mode: Mode;
  description: string;
}

// Um alias por key. Cada keyBinding precisa existir em `secrets_store_secrets` no wrangler.jsonc.
export const PROJECTS: Readonly<Record<string, Project>> = {
  exemplo: { keyBinding: 'KEY_EXEMPLO', mode: 'readwrite', description: 'Projeto de exemplo' },
  leitura: { keyBinding: 'KEY_LEITURA', mode: 'readonly', description: 'Projeto só de leitura' },
};

export const publicProjects = () =>
  Object.entries(PROJECTS).map(([alias, { mode, description }]) => ({ alias, mode, description }));
