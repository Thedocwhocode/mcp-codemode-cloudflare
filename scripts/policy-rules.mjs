// Regras de classificação por operação (usadas por scripts/classify.mjs e pelos testes).
// method: minúsculo, como no OpenAPI. Retorna read | write | destructive.

// ── Dokploy (tRPC: "/<router>.<procedure>") ─────────────────────────────────────────────────────
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

// ── REST (segmentos de path) ────────────────────────────────────────────────────────────────────
// Segmento-ação que desfaz, interrompe, gasta ou mexe em credencial ("/subscriptions/{id}/cancel").
const REST_VERB =
  /\/(remove|delete|destroy|purge|wipe|stop|kill|terminate|cancel|revoke|rotate|regenerate|reset|restore|rollback|transfer|archive|suspend|disable|deactivate|refund|charge|pay|send|publish|merge|force[-_]?\w*)(\/|$)/i;
// Recursos de conta, acesso, dinheiro ou segredo: qualquer escrita neles é destrutiva.
const REST_SENSITIVE =
  /\/(users?|members?|accounts?|org(anization)?s?|teams?|roles?|permissions?|policies|grants?|invites?|invitations?|billing|invoices?|payments?|payouts?|subscriptions?|keys?|api[-_]?keys?|tokens?|secrets?|credentials?|passwords?|ssh[-_]?keys?|certificates?|webhooks?|settings|admin|security|sso|oauth|auth)(\/|$)/i;
// Leituras REST que tendem a devolver segredo ou conteúdo bruto.
const REST_SENSITIVE_READ = /\/(secrets?|credentials?|tokens?|api[-_]?keys?|keys?|ssh[-_]?keys?|private[-_]?keys?|passwords?|env|environment|vars?|variables?|files?|raw|download|export|logs?\/raw)(\/|$)/i;

export const isRpc = (path) => /^\/[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(path);

export function classifyOperation(path, method) {
  if (isRpc(path)) {
    if (method === 'get') return SENSITIVE_READ.has(path) ? 'destructive' : 'read';
    if (DESTRUCTIVE_VERB.test(path) || INFRA_ROUTER.test(path) || RISKY_WRITE.test(path)) return 'destructive';
    return 'write';
  }
  if (method === 'get' || method === 'head') return REST_SENSITIVE_READ.test(path) ? 'destructive' : 'read';
  if (method === 'delete') return 'destructive';
  // PUT costuma substituir o recurso inteiro: só é "write" se nada acima o pegar.
  if (REST_VERB.test(path) || REST_SENSITIVE.test(path)) return 'destructive';
  return 'write';
}
