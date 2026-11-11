# Threat model: taylor-curran/juice-shop

Facts marked *user* come from Taylor (2026-11-10) and are the only ones that move finding priorities; *inferred* items are read from the code.

## System overview
Fork of OWASP Juice Shop 20.4.0-SNAPSHOT. Upstream is intentionally vulnerable (`AGENTS.md`, `SECURITY.md`, `threat-model.json`), but **this fork is deployed as a real shop with real customer data, and every vulnerability matters** (*user*). Single Node.js/Express process (`server.ts`, `app.ts`) serving an Angular SPA (`frontend/`), a REST API, file endpoints and a websocket, backed by SQLite via Sequelize (`models/`), MarsDB in-memory NoSQL (`data/mongodb.ts`) and the local file system (`ftp/`, `uploads/`, `logs/`). Challenge-linked code is marked `vuln-code-snippet vuln-line <challengeKey>` and registered in `data/static/challenges.yml`.

Data-flow diagram from `threat-model.json`: B2C customer, B2B customer, Admin and Accounting browsers -> Angular frontend -> Application server -> SQLite / MarsDB / file system; Google OAuth2 is out of scope there.

## Deployment
- **Deployed with the in-repo Terraform on AWS ECS Fargate** (*user*): `infrastructure/terraform/` (and the root `terraform/` copy) — ECS cluster, Fargate task on port 3000 with `NODE_ENV` only, SQLite on a mounted volume `/juice-shop/data/sqlite`, image built from `infrastructure/Dockerfile` and pushed to ECR. Upstream calls this IaC intentionally insecure; here it is the real infrastructure, so its findings are in scope.
- No separate infrastructure repository.
- *Inferred, unverified*: `challenges.safetyMode: auto` disables Docker-unsafe challenges only when `lib/is-docker.ts` sees `/.dockerenv`, a `docker` cgroup or docker mountinfo. Fargate runs on containerd, so these checks may be false and the Docker-gated vulnerabilities (username `eval`, persisted XSS, `$where` injections) may be live.

## Components
| Name | Code |
|---|---|
| **Frontend** | `frontend/src/` (Angular SPA), `views/` (server-rendered hbs/pug) |
| **API** | `server.ts` routing, `routes/*` (REST, `/api/*` Sequelize auto-REST, `/rest/*`), `routes/b2bOrder.ts` (B2B API) |
| **Auth** | `lib/insecurity.ts` (JWT RS256 signing, `isAuthorized`, `denyAll`, `isAccounting`, hmac), `models/user.ts` roles, `routes/login.ts`, `routes/2fa.ts`, `routes/passkey.ts`, `routes/resetPassword.ts`, `routes/changePassword.ts`, rate limiting in `server.ts` |
| **Files & uploads** | `routes/fileUpload.ts` (zip/XML/YAML), `routes/profileImage*`, `routes/memory.ts`, `routes/fileServer.ts`, `routes/quarantineServer.ts`, `routes/logfileServer.ts`, `routes/keyServer.ts`, `ftp/`, `uploads/`, `encryptionkeys/` |
| **Data** | `models/`, `data/` (datacreator, mongodb, static seed users/challenges) |
| **Chatbot & Web3** | `routes/chat.ts` (LLM via OpenAI-compatible API, tool calls into Product/User models), `routes/web3Wallet.ts`, `routes/nftMint.ts` (Alchemy Sepolia) |
| **Challenge framework** | `lib/challengeUtils.ts`, `lib/codingChallenges.ts`, `routes/verify.ts`, `routes/vulnCodeSnippet.ts`, `routes/vulnCodeFixes.ts`, `data/static/codefixes/`, `rsn/` |
| **Infrastructure** | `infrastructure/terraform/`, `terraform/`, `infrastructure/Dockerfile`, root `Dockerfile`, `.github/workflows/` |

## Trust boundaries and entry points
- Internet -> Express on port 3000 (ECS Fargate): everything is reachable unauthenticated unless guarded by `security.isAuthorized()` / `denyAll()` / `isAccounting()` in `server.ts`. CORS is fully open.
- Authenticated customer (JWT bearer, free self-registration) -> basket, cards, wallet, orders, profile, memories, complaints, privacy requests, B2B `/b2b/v2`.
- Admin/accounting roles in JWT claims -> user management, product inventory (`/api/Quantitys` also IP-filtered).
- Server -> outbound: LLM provider, Alchemy websocket, profile image URL fetch, webhook (`lib/webhook.ts`).
- Sandboxed evaluation: `node:vm` + `notevil` for B2B orders and YAML parsing.
- AWS control plane: Terraform-managed ECS/ECR/IAM/networking.

## Assets (critical ones per *user*)
- **Critical (*user*): user credentials and sessions** — password hashes, security answers, 2FA secrets, passkeys, the JWT signing key (hardcoded RSA private key in `lib/insecurity.ts`), login and password reset.
- **Critical (*user*): the server host** — code execution in the Node.js process, the container file system, SQLite volume, environment secrets, the AWS task role.
- **Critical (*user*): admin and accounting functions** — admin role, user management, inventory (`/api/Quantitys`), complaints, feedback moderation.
- Other real customer data: payment cards, wallet balances, orders, addresses, reviews.
- Third-party credentials from env (`ALCHEMY_API_KEY`, LLM API key).

## Attackers
- Every attacker matters (*user*: nothing ruled out). Primary: anonymous internet user; registered customer escalating to other customers, admin or accounting; malicious uploaded file / crafted B2B order / chatbot prompt; anyone able to influence the AWS deployment.

## Existing controls
- `helmet.noSniff`, `helmet.frameguard`; JWT RS256 verification; `denyAll()` on some auto-REST routes; vm sandbox with 2 s timeout; upload size/type checks; distroless non-root container (root `Dockerfile`).
- Many are deliberately weakened upstream (commented-out `xssFilter`, commented-out product PUT auth, `trust proxy` for all clients).

## Out of scope / accepted risk
- Nothing (*user*). Challenge-linked vulnerabilities are not accepted risk in this deployment.

## Open questions
- Does `lib/is-docker.ts` return true on the Fargate task (decides whether Docker-gated vulns are live)? Is `challenges.safetyMode` overridden in the deployed config?
- Is there an ALB or proxy in front of the task that rewrites `X-Forwarded-For`?
