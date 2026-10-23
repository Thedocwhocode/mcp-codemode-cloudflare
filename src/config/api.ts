// Tudo que muda de uma API para outra fica aqui. O exemplo é o Dokploy (tRPC atrás de um Cloudflare Tunnel).
export const API = {
  name: 'dokploy',
  // Base das chamadas. Com Workers VPC, o host é ignorado no roteamento (vale o host/porta do VPC Service)
  // e só define o header Host. Para uma API pública, use a origem real (ex. 'https://api.exemplo.com/v1').
  baseUrl: 'http://127.0.0.1/api',
  // Header onde o host injeta a key do projeto. O sandbox nunca vê esse valor.
  authHeader: 'x-api-key',
  // Métodos aceitos. Dokploy: GET = query, POST = mutation.
  methods: ['GET', 'POST'] as const,
  // Paths aceitos (sem host, sem `..`). Dokploy: "/<router>.<procedure>".
  pathPattern: /^\/[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/,
  pathExample: '/project.all',
  // Campos da resposta que podem carregar segredo: viram "[REDACTED]" antes de chegar ao modelo.
  sensitiveFields: /^(env|buildArgs|buildSecrets|password|.*(token|secret|apikey|privatekey|password|passphrase))$/i,
  // Texto que o modelo lê na descrição do tool `execute`.
  help: `Toda chamada precisa de "project" (alias de spec["x-projects"]):
codemode.request({ project: "exemplo", method: "GET", path: "/project.all" })
GET = query (parâmetros em "query"); POST = mutation (JSON em "body"). Paths relativos a /api.
Forma de /project.all: projeto → environments[] → applications[], compose[], postgres[], redis[], mysql[],
mariadb[], mongo[], libsql[] (os serviços NÃO ficam no topo do projeto). Status: applicationStatus ou composeStatus.`,
} as const;

export const LIMITS = { callsPerExecute: 50, timeoutMs: 15_000, maxResponseBytes: 1_000_000 } as const;
