# Threat model: taylor-curran/juice-shop

Written with Taylor on 2026-11-10 and checked against the code during the security scan on 2026-11-11. Facts marked *user* come from Taylor and are the only facts that move a finding's priority. Facts marked *inferred* come from reading the code and move nothing.

## System overview
This is a fork of OWASP Juice Shop 20.4.0-SNAPSHOT. Upstream, the app is intentionally vulnerable (`AGENTS.md`, `SECURITY.md`, `threat-model.json`). **This fork is deployed as a real shop with real customer data, and every vulnerability matters** (*user*). It runs as a single Node.js/Express process (`server.ts`, `app.ts`) that serves an Angular SPA (`frontend/`), a REST API, file endpoints and a websocket. Data lives in SQLite via Sequelize (`models/`), MarsDB in-memory NoSQL (`data/mongodb.ts`) and the local file system (`ftp/`, `uploads/`, `logs/`). Challenge-linked code is marked `vuln-code-snippet vuln-line <challengeKey>` and registered in `data/static/challenges.yml`. **In this deployment, challenge-linked code is real vulnerable code** (*user*).

## Deployment
- **Deployed on AWS ECS Fargate with the in-repo Terraform** (*user*): `infrastructure/terraform/` (the root `terraform/` is a copy that only differs in the Dockerfile path). Its findings are in scope.
- No separate infrastructure repository (*user*).
- *Inferred*: an internet-facing ALB (`networking.tf`) has an HTTP :80 listener that forwards (it does not redirect to HTTPS) and an HTTPS :443 listener (TLS 1.3 policy). The listener certificate's private key is hardcoded in `networking.tf` (`aws_iam_server_certificate.juice_shop_tls`). The ECS task security group only accepts :3000 from the ALB security group, although `assign_public_ip = true`. SQLite is on EFS (`/juice-shop/data/sqlite`). The task definition sets only an execution role (`AmazonECSTaskExecutionRolePolicy`) and no task role. The only environment variable is `NODE_ENV = var.node_env`.
- *Inferred*: `server.ts` sets `app.enable('trust proxy')`, and the ALB appends to any client-supplied `X-Forwarded-For`, so `req.ip` is likely spoofable (this affects rate limiting and the IP filter on `/api/Quantitys`).
- *Inferred, unverified*: `challenges.safetyMode: auto` (`config/default.yml`) turns off Docker-unsafe challenges only when `lib/is-docker.ts` finds `/.dockerenv`, a `docker` cgroup or Docker mountinfo. Fargate uses containerd, so all three checks may fail, which would leave the Docker-gated vulnerabilities (username `eval`, persisted XSS, `$where` injection) live.

## Components
| Name | Code |
|---|---|
| **Frontend** | `frontend/src/` (Angular SPA), `views/` (server-rendered hbs/pug) |
| **API** | `server.ts` routing, `routes/*` not listed under other components (REST, the Sequelize auto-REST under `/api/*`, `/rest/*`), `routes/b2bOrder.ts` (B2B API) |
| **Auth** | `lib/insecurity.ts` (JWT RS256 signing, `isAuthorized`, `denyAll`, `isAccounting`, hmac), `models/user.ts` roles, `routes/login.ts`, `routes/2fa.ts`, `routes/passkey.ts`, `routes/resetPassword.ts`, `routes/changePassword.ts`, rate limiting in `server.ts` |
| **Files & uploads** | `routes/fileUpload.ts` (zip/XML/YAML), `routes/profileImage*`, `routes/memory.ts`, `routes/fileServer.ts`, `routes/quarantineServer.ts`, `routes/logfileServer.ts`, `routes/keyServer.ts`, `ftp/`, `uploads/`, `encryptionkeys/` |
| **Data** | `models/`, `data/` (datacreator, mongodb, static seed users/challenges) |
| **Chatbot & Web3** | `routes/chat.ts` (LLM through an OpenAI-compatible API, with tool calls into the Product/User models), `routes/web3Wallet.ts`, `routes/nftMint.ts` (Alchemy Sepolia) |
| **Challenge framework** | `lib/challengeUtils.ts`, `lib/codingChallenges.ts`, `routes/verify.ts`, `routes/vulnCodeSnippet.ts`, `routes/vulnCodeFixes.ts`, `data/static/codefixes/`, `rsn/` |
| **Infrastructure** | `infrastructure/terraform/`, `terraform/`, `infrastructure/Dockerfile`, root `Dockerfile`, `.github/workflows/` |

## Trust boundaries and entry points
- Internet -> ALB (:80/:443) -> Express :3000. Everything is reachable without authentication unless `server.ts` guards it with `security.isAuthorized()`, `denyAll()` or `isAccounting()`. CORS is fully open.
- Authenticated customer (JWT bearer; anyone can self-register) -> basket, cards, wallet, orders, profile, memories, complaints, privacy requests, B2B `/b2b/v2`.
- Admin and accounting roles (JWT claims) -> user management, product inventory (`/api/Quantitys`, which is also IP-filtered).
- Server -> outbound: LLM provider, Alchemy websocket, profile-image URL fetch, webhook (`lib/webhook.ts`).
- Sandboxed evaluation: `node:vm` + `notevil` for B2B orders and YAML parsing.
- AWS control plane: ECS, ECR, IAM, EFS and networking, all managed by Terraform.

## Assets
- **Critical (*user*): user credentials and sessions**: password hashes, security answers, 2FA secrets, passkeys, the JWT signing key (a hardcoded RSA private key in `lib/insecurity.ts`), login and password reset.
- **Critical (*user*): the server host**: code execution in the Node.js process, the container file system, the SQLite/EFS volume, environment secrets, AWS credentials available to the task.
- **Critical (*user*): admin and accounting functions**: the admin role, user management, inventory (`/api/Quantitys`), complaints, feedback moderation.
- Other real customer data (*user*: real customer data): payment cards, wallet balances, orders, addresses, reviews.
- Third-party credentials read from the environment (`ALCHEMY_API_KEY`, the LLM API key), and the ALB TLS private key.

## Attackers
- Every attacker matters; nothing is ruled out (*user*). Main ones: an anonymous internet user; a registered customer escalating to other customers' data, admin or accounting; a malicious uploaded file, crafted B2B order or chatbot prompt; anyone able to influence the AWS deployment or CI.

## Existing controls (*inferred*)
- `helmet.noSniff`, `helmet.frameguard`; JWT RS256 verification; `denyAll()` on some auto-REST routes; vm sandbox with a 2 s timeout; upload size and type checks; distroless non-root image (root `Dockerfile`); the ECS security group only accepts traffic from the ALB.
- Upstream deliberately weakens many of these (commented-out `xssFilter`, commented-out auth on product PUT, `trust proxy` for every client).

## Out of scope / accepted risk
- Nothing (*user*). Challenge-linked vulnerabilities are not accepted risk in this deployment.

## Reranking guidance
Since the user rules out no attacker, asset or surface, no finding is lowered for scope. A finding is raised only when the scanner confirmed an easy path to one of the three critical asset groups above. Everything else keeps the scanner's severity.

## Open questions
- Which `NODE_ENV`/config does the deployed task use, and does `lib/is-docker.ts` return true on Fargate? This decides whether the Docker-gated vulnerabilities are live. Taylor answered "not sure" (2026-11-11), so the scanner's own gating assumptions stand and nothing moves on this.
- Does the deployed ALB use the hardcoded certificate key in `networking.tf`, or is it replaced at deploy time?

## Finding tags
Each finding carries `Component` (from the table above), `CWE` (e.g. `CWE-89`), `OWASP Top 10` (2021 category, e.g. `A03:2021 Injection`) and, for a vulnerable dependency, `CVE` (*user*, 2026-11-11).
