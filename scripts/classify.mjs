// Gera policy/classification.json: "/router.procedure" → read | write | destructive.
// Revise o diff do JSON a cada atualização do OpenAPI. Operação fora da tabela = destructive (fail-closed).
// Uso: node scripts/classify.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync('spec/openapi.json', 'utf8'));

// Verbos que apagam, param, derrubam ou trocam credencial.
const DESTRUCTIVE_VERB =
  /\.(remove|delete|stop|kill|clean|clear|drop|prune|rollback|rebuild|recreate|reset|deactivate|reload|cancel|revoke|disconnect|move|changePassword)/i;
// Routers que mexem no servidor, em contas ou em credenciais (não no app de um projeto).
const INFRA_ROUTER =
  /^\/(settings|server|cluster|swarm|user|organization|sso|scim|licenseKey|stripe|sshKey|customRole|forwardAuth|whitelabeling|admin|security|registry|certificates|vaultProvider|dnsProvider|destination|network|gitProvider|github|gitlab|gitea|bitbucket)\./;
// Mutations de projeto com efeito fora do app: abrir porta de banco, escrever arquivo, ligar/desligar banco.
// saveEnvironment substitui o env inteiro; schedule roda comando arbitrário no container; port publica porta.
const RISKY_WRITE =
  /\.(saveExternalPorts?|changeStatus|uploadFileToContainer|writeContainerFile|writeVolumeFile|saveFileAsPatch|markFileForDeletion|saveEnvironment|updateTraefikConfig|refreshToken)$|^\/(schedule|port)\./;
// Leituras que devolvem conteúdo bruto (arquivos, env do Traefik, chaves): a redação por nome de campo não cobre.
const SENSITIVE_READ = new Set([
  '/docker.readContainerFile', '/docker.listContainerFiles', '/dockerVolume.readVolumeFile', '/dockerVolume.listVolumeFiles',
  '/settings.readTraefikEnv', '/settings.readTraefikFile', '/settings.readDirectories', '/server.withSSHKey',
  '/sshKey.one', '/sshKey.all', '/sshKey.allForApps', '/user.getUserByToken', '/user.getMetricsToken',
  '/patch.readRepoFile', '/patch.readRepoDirectories',
]);

function classify(path, method) {
  if (method === 'get') return SENSITIVE_READ.has(path) ? 'destructive' : 'read';
  if (DESTRUCTIVE_VERB.test(path) || INFRA_ROUTER.test(path) || RISKY_WRITE.test(path)) return 'destructive';
  return 'write';
}

const table = {};
for (const [path, item] of Object.entries(spec.paths).sort(([a], [b]) => a.localeCompare(b))) {
  const methods = Object.keys(item);
  if (methods.length !== 1) throw new Error(`${path}: esperava um método só, veio ${methods}`);
  table[path] = classify(path, methods[0]);
}
writeFileSync('policy/classification.json', `${JSON.stringify(table, null, 1)}\n`);
const count = Object.values(table).reduce((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {});
console.log(count);
