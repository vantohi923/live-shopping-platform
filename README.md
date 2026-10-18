# LiveShop — platformă de live shopping

Un streamer intră live (video), prezintă produse și „fixează" pe ecran produsul despre care vorbește.
Spectatorii se uită, scriu pe chat și cumpără produsul fixat din două click-uri.
Stocul scade în timp real pentru toată lumea care se uită.

Acest README e **harta proiectului**: ce am construit deja, ce construim în următoarele 14 zile, și —
cel mai important — **ce trebuie să înțeleg din fiecare bucată**, ca să pot explica orice linie de cod la un interviu.

---

## Cuprins

1. [De unde vine proiectul și ce tehnologii folosim](#1-de-unde-vine-proiectul-și-ce-tehnologii-folosim)
2. [Arhitectura (unde vrem să ajungem)](#2-arhitectura-unde-vrem-să-ajungem)
3. [Structura folderelor (finală)](#3-structura-folderelor-finală)
4. [Ziua 0 — ce am făcut deja](#4-ziua-0--ce-am-făcut-deja)
5. [Înainte de Ziua 1 — conturi și unelte](#5-înainte-de-ziua-1--conturi-și-unelte)
6. [Planul pe 14 zile](#6-planul-pe-14-zile)
7. [Cum lucrez cu AI fără să am cod pe care nu-l înțeleg](#7-cum-lucrez-cu-ai-fără-să-am-cod-pe-care-nu-l-înțeleg)
8. [Pregătirea pentru interviu](#8-pregătirea-pentru-interviu)
9. [Extensii (dacă termin mai devreme)](#9-extensii-dacă-termin-mai-devreme)
10. [Comenzi utile](#10-comenzi-utile)

---

## 1. De unde vine proiectul și ce tehnologii folosim

Proiectul copiază, la scară mică, produsul dintr-un anunț real de **Senior Full Stack Developer**
(„platformă mobilă de live shopping, cu accent pe partea socială și cumpărare rapidă").
Tehnologiile vin din acel anunț, plus cele potrivite dintr-un al doilea anunț de senior (platformă imobiliară).

| Tehnologie | Din ce anunț | Unde o folosesc | De ce |
|---|---|---|---|
| **Bun + TypeScript** | live shopping | Backend: API REST + WebSocket | Exact ce folosește echipa din anunț. Bun are routing, WebSocket, teste și citire `.env` incluse → puține dependențe. |
| **Next.js + React** | ambele | Frontend web | Cerut în ambele anunțuri. |
| **PostgreSQL + Prisma** | ambele (SQL) | Useri, stream-uri, produse, comenzi | Datele sunt relaționale (o comandă aparține unui user și unui produs) și am nevoie de tranzacții pentru stoc. |
| **Redis** | ambele | Pub/sub pentru evenimente live, număr de spectatori, rate limiting | Anunțul cere explicit „Redis pentru real-time". |
| **AWS IVS** | live shopping | Video live: OBS → IVS → player în browser | Cerut explicit. AWS se ocupă de transcodare și distribuție. |
| **AWS IVS Chat** | live shopping | Chat-ul din live | Cerut explicit („video live și chat cu AWS IVS"). |
| **AWS Cognito** | live shopping | Înregistrare, login, tokeni JWT | Cerut explicit. |
| **Stripe** | live shopping | Plăți (mod test) | Cerut explicit (Stripe/Adyen). |
| **Docker** | imobiliare | Postgres + Redis local, imaginea backend-ului | Mediu identic pe orice calculator. |
| **CI/CD (GitHub Actions)** | imobiliare | Typecheck + teste la fiecare push | „Rigoare pe testare" — prinde bug-uri înainte de merge. |
| **Unelte AI (Claude Code)** | live shopping | Dezvoltare + review de cod/securitate | Anunțul cere lucru zilnic cu AI „cu rigoare pe review, testare și securitate". |

### Ce las deliberat pe dinafară (și cum explic asta la interviu)

A ști ce **nu** construiești e o decizie de senior. Pentru fiecare am un motiv:

- **Java** — un singur limbaj (TypeScript) pe tot stack-ul înseamnă tipuri partajate și mai puțin context switching. Într-un proiect de 2 săptămâni, al doilea limbaj ar dubla munca fără să adauge funcționalitate.
- **Koa** — anunțul țintă folosește Bun, iar Bun are deja routing și WebSocket. Wrapper-ul meu de erori/CORS (Ziua 1) funcționează pe același principiu ca middleware-ul din Koa, deci pot discuta conceptul.
- **Bazel** — build tool pentru monorepo-uri cu sute de pachete. La 2 aplicații ar fi complexitate fără beneficiu.
- **Swift / iOS** — în afara scope-ului. Însă API-ul este REST cu tokeni Cognito, deci o aplicație iOS l-ar putea folosi **fără nicio modificare** în backend.
- **Adyen** — face același lucru ca Stripe; am ales unul.
- **Elasticsearch, DynamoDB, microservicii, payouts** — în secțiunea [Extensii](#9-extensii-dacă-termin-mai-devreme).

---

## 2. Arhitectura (unde vrem să ajungem)

```mermaid
flowchart LR
    OBS["OBS Studio<br/>(streamer)"] -- "RTMPS (video)" --> IVS["AWS IVS<br/>video"]
    IVS -- "HLS (video)" --> WEB

    WEB["Next.js<br/>frontend"] -- "REST + JWT" --> API["Bun API"]
    WEB <-- "WebSocket<br/>(produs fixat, stoc, spectatori)" --> API
    WEB <-- "WebSocket (chat)" --> CHAT["AWS IVS Chat"]
    WEB -- "login" --> COG["AWS Cognito"]

    API -- "verifică JWT" --> COG
    API --> PG[("PostgreSQL")]
    API <-- "pub/sub" --> REDIS[("Redis")]
    API -- "creează canal / cameră chat / token" --> IVS
    API -- "Checkout Session" --> STRIPE["Stripe"]
    STRIPE -- "webhook (plată reușită)" --> API
```

### Fluxul principal, în 7 pași

1. **Login** — userul se loghează prin Cognito și primește un JWT. Fiecare cerere la API trimite JWT-ul în header-ul `Authorization`.
2. **Streamer-ul creează un live** — backend-ul cere AWS IVS un canal video și o cameră de chat și salvează ARN-urile în Postgres.
3. **Streamer-ul pornește OBS** — trimite video la IVS cu un *stream key* secret. IVS îl transformă în HLS.
4. **Spectatorul deschide pagina** — player-ul IVS redă video-ul, se conectează la chat (IVS Chat) și la WebSocket-ul nostru (evenimente live).
5. **Streamer-ul fixează un produs** — API-ul salvează în DB și publică un eveniment în Redis → toți spectatorii îl văd instant.
6. **Spectatorul apasă „Cumpără"** — API-ul scade stocul **atomic**, creează o comandă `PENDING` și o sesiune Stripe Checkout.
7. **Stripe trimite webhook** — comanda devine `PAID`, iar noul stoc e publicat tuturor spectatorilor.

---

## 3. Structura folderelor (finală)

```
live-shopping-app/
├── docker-compose.yml            # Postgres + Redis local
├── .github/workflows/ci.yml      # CI: typecheck + teste
├── docs/
│   ├── decizii.md                # de ce am ales X și nu Y (pentru interviu)
│   └── jurnal.md                 # ce am învățat în fiecare zi, cu cuvintele mele
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # modelul de date
│   │   ├── migrations/           # istoricul schimbărilor în DB
│   │   └── seed.ts               # date demo
│   ├── src/
│   │   ├── index.ts              # pornește serverul (doar atât)
│   │   ├── routes.ts             # harta tuturor URL-urilor → handler
│   │   ├── config/env.ts         # citește și validează variabilele din .env
│   │   ├── lib/                  # unelte comune
│   │   │   ├── prisma.ts         # o singură instanță PrismaClient
│   │   │   ├── redis.ts          # conexiuni Redis
│   │   │   ├── aws.ts            # clienți IVS / IVS Chat
│   │   │   ├── stripe.ts         # client Stripe
│   │   │   └── http.ts           # json(), HttpError, handle() (erori + CORS)
│   │   ├── middleware/
│   │   │   └── auth.ts           # verifică JWT-ul Cognito, încarcă userul
│   │   ├── modules/              # câte un folder pe fiecare „funcționalitate"
│   │   │   ├── users/
│   │   │   ├── streams/
│   │   │   ├── products/
│   │   │   ├── orders/
│   │   │   └── payments/
│   │   └── realtime/
│   │       ├── events.ts         # tipurile de evenimente live
│   │       └── socket.ts         # WebSocket + punte Redis
│   ├── tests/                    # teste de integrare
│   └── Dockerfile
└── frontend/
    ├── app/                      # paginile (App Router)
    │   ├── page.tsx              # lista de live-uri
    │   ├── login/  signup/       # autentificare
    │   ├── live/[id]/page.tsx    # pagina spectatorului
    │   └── dashboard/page.tsx    # panoul streamer-ului
    ├── components/               # VideoPlayer, Chat, PinnedProduct, ...
    ├── hooks/                    # useStreamEvents, useAuth
    └── lib/                      # api.ts (fetch + token), auth.ts, config.ts
```

### Regula de aur a backend-ului: fiecare modul are 3 fișiere

```
modules/products/
├── products.routes.ts    # HTTP: citește cererea, validează, cheamă service-ul, răspunde
├── products.service.ts   # Logica de business + Prisma. NU știe nimic de HTTP.
└── products.schema.ts    # Schemele Zod: ce date acceptăm de la client
```

**Cum explic asta unui team leader:** „Am separat transportul (HTTP) de logica de business.
Service-urile nu primesc `Request` și nu întorc `Response`, deci le pot testa direct, fără server.
Le pot refolosi și dintr-un webhook sau dintr-un job. Nu am adăugat un strat separat de *repository*,
pentru că Prisma e deja o abstracție peste baza de date — un strat în plus ar fi fost cod fără beneficiu la mărimea asta."

---

## 4. Ziua 0 — ce am făcut deja

### 4.1 `docker-compose.yml` — baza de date și Redis local

Pornește două containere:

- **`postgres:16-alpine`** pe portul `5432`, cu userul `user` / `password` și baza `liveshop`.
  Volumul `pgdata` păstrează datele când oprești containerul (fără el, la fiecare `docker compose down` aș pierde tot).
- **`redis:7-alpine`** pe portul `6379`. Încă nu e folosit — îl conectăm în Ziua 9.

**Ce trebuie să înțeleg:**
- Diferența dintre **imagine** (rețeta, ex. `postgres:16-alpine`) și **container** (o instanță care rulează).
- `ports: "5432:5432"` = portul de pe calculatorul meu → portul din container.
- `alpine` = variantă mică de Linux, imagine mai ușoară.
- Parolele din `docker-compose.yml` sunt OK **doar local**. În producție vin din secrete.

### 4.2 `backend/prisma/schema.prisma` + migrarea `init` — modelul de date

4 tabele: `User`, `Stream`, `Product`, `Order`, cu relații:
- un `User` are mai multe `Stream`-uri și mai multe `Order`-uri (1 → N);
- un `Stream` are mai multe `Product`-e;
- un `Order` leagă un `User` de un `Product`.

`prisma migrate dev` a generat `migrations/20261017150431_init/migration.sql` — SQL-ul real care a creat tabelele.

**Ce trebuie să înțeleg:**
- **Schema** = cum vreau să arate DB-ul. **Migrarea** = pașii SQL care duc DB-ul de la starea veche la cea nouă. Migrările intră în git, ca toată echipa să aibă aceeași bază de date.
- `@id @default(uuid())` — ID-uri aleatorii, nu 1, 2, 3 (nu poți ghici ID-ul altei comenzi).
- `@relation(fields: [userId], references: [id])` devine un **foreign key** în SQL (vezi `ALTER TABLE ... FOREIGN KEY` în migrare).
- `ON DELETE RESTRICT` — Postgres refuză să șteargă un user care are stream-uri.
- `.env` conține `DATABASE_URL` și **nu** intră în git (e în `.gitignore`).

### 4.3 `backend/index.ts` — primul server

Un singur `Bun.serve` pe portul `4000`, cu rutare manuală prin `if (url.pathname === ... && req.method === ...)`:

| Endpoint | Ce face |
|---|---|
| `GET /health` | Răspunde `{status: "ok"}` — util pentru Docker/monitorizare |
| `POST /api/users/seed` | Creează (o singură dată, prin `upsert`) un user demo STREAMER |
| `GET /api/streams` | Toate stream-urile, cu produse și user (`include`) |
| `POST /api/streams` | Creează un stream pentru **primul user din DB** |
| `POST /api/products` | Adaugă un produs la un stream |

**Ce trebuie să înțeleg:**
- **CORS**: frontend-ul (`localhost:3000`) și backend-ul (`localhost:4000`) sunt „origini" diferite, iar browserul blochează cererile între ele dacă serverul nu le permite explicit prin header-ele `Access-Control-Allow-*`.
- **Preflight `OPTIONS`**: înainte de un `POST` cu JSON, browserul trimite automat un `OPTIONS` ca să întrebe „am voie?". De aceea există `if (req.method === "OPTIONS")`.
- **`upsert`** = „update dacă există, altfel create" — face seed-ul sigur de rulat de mai multe ori.
- **`include`** = Prisma face JOIN-ul și îmi dă obiectele legate.
- Coduri HTTP: `200` OK, `201` Created, `400` cerere greșită, `404` nu există.

### 4.4 `frontend/` — Next.js 16 gol

Doar template-ul generat de `create-next-app` (Next 16.4, React 19.3, Tailwind 4). Nu comunică încă cu backend-ul.

> **Atenție:** `frontend/AGENTS.md` avertizează că această versiune de Next.js are API-uri schimbate.
> Înainte de orice cod de frontend, caut ghidul relevant în `frontend/node_modules/next/dist/docs/`.
> În plus, `next.config.ts` are `cacheComponents: true`, care schimbă modul în care se încarcă datele dinamice.

### 4.5 Ce lipsește acum și ziua în care rezolv

| Problemă | Rezolvată în |
|---|---|
| Rutarea cu `if`-uri devine greu de citit; tot codul e într-un singur fișier | Ziua 1 |
| Nu există `try/catch` → un JSON invalid dărâmă cererea cu o eroare urâtă | Ziua 1 |
| CORS permite `*` (orice site) | Ziua 1 |
| Corpul cererilor nu e validat (`price: "abc"` trece) | Ziua 2 |
| `price` e `Float` → erori de rotunjire la bani (`0.1 + 0.2 ≠ 0.3`) | Ziua 2 |
| `role`/`status` sunt `String` liber, nu `enum` | Ziua 2 |
| Nu există teste și nici CI | Ziua 3 |
| Nu există autentificare (stream-ul se creează pe „primul user") | Zilele 4–5 |
| `streamKey` ar fi salvat în clar în DB | Ziua 6 |
| Video, chat și real-time lipsesc | Zilele 6–10 |
| Comenzile nu verifică stocul → se poate vinde mai mult decât există | Ziua 11 |
| Nu există plăți | Ziua 12 |

---

## 5. Înainte de Ziua 1 — conturi și unelte

- [ ] **Docker Desktop** pornit, apoi `docker compose up -d` la rădăcina proiectului.
- [ ] **Cont AWS** + **AWS Budgets**: o alertă la ~5$ / lună. IVS se taxează **pe oră de stream**, deci opresc OBS după fiecare test.
- [ ] **Cont Stripe**, folosit doar în **Test mode** (nu se iau bani reali) + **Stripe CLI** instalat.
- [ ] **OBS Studio** instalat.
- [ ] Repo pe **GitHub** (pentru CI).
- [ ] Commit cu starea actuală: `git add . && git commit -m "Backend initial: Prisma schema + endpoint-uri de baza"`.

---

## 6. Planul pe 14 zile

| Zi | Temă | La final am… |
|---|---|---|
| 1 | Restructurare backend | aceleași endpoint-uri, dar în module, cu erori tratate |
| 2 | Model de date v2 + validare | enum-uri, bani în bani (cenți), Zod, CRUD produse |
| 3 | Teste + CI | `bun test` verde local și pe GitHub |
| 4 | Cognito — backend | API care cere JWT valid și știe cine e userul |
| 5 | Frontend + login | Next.js cu login/signup și lista de live-uri |
| 6 | AWS IVS — video | OBS trimite video spre IVS |
| 7 | **Recapitulare + buffer** | documentație, bug-uri reparate, totul explicat |
| 8 | Player + pagina live | spectatorul vede video-ul și produsele |
| 9 | Real-time cu Redis | produsul fixat apare instant la toți |
| 10 | Chat cu IVS Chat | chat live funcțional |
| 11 | Comenzi + stoc | cumpărare fără să vând mai mult decât am |
| 12 | Plăți Stripe | plată test + webhook |
| 13 | Docker, securitate, review | backend în container, checklist de securitate |
| 14 | **Demo + pregătire interviu** | video demo, README final, pitch exersat |

Fiecare zi are aceeași structură: **Obiectiv → Pași → Ce trebuie să înțeleg → Verificare (întrebări) → Gata când**.
Nu trec la ziua următoare până nu pot răspunde la întrebările de verificare **fără să mă uit în cod**.

---

### Ziua 1 — Restructurare backend

**Obiectiv:** Mut ce există în structura din [secțiunea 3](#3-structura-folderelor-finală), fără funcționalități noi. Un refactor trebuie să păstreze comportamentul neschimbat.

**Pași:**
1. `bun add zod`.
2. `src/config/env.ts` — validez variabilele de mediu **la pornire**:
   ```ts
   import { z } from "zod";

   const EnvSchema = z.object({
     DATABASE_URL: z.url(),
     PORT: z.coerce.number().int().positive().default(4000),
     FRONTEND_URL: z.url().default("http://localhost:3000"),
   });

   const result = EnvSchema.safeParse(process.env);
   if (!result.success) {
     console.error(z.prettifyError(result.error)); // mesaj clar: ce variabilă e greșită
     process.exit(1);
   }
   export const env = result.data;
   ```
3. `src/lib/prisma.ts` — exportă **un singur** `new PrismaClient()`.
4. `src/lib/http.ts`:
   - `HttpError` (clasă cu `status` + `message`);
   - `json(data, status)`;
   - `handle(fn)` — un wrapper care face `try/catch`, transformă `HttpError` în răspunsul corect, orice altă eroare în `500` (și o loghează), și adaugă header-ele CORS cu `env.FRONTEND_URL` în loc de `*`.
5. Mut endpoint-urile în `modules/users`, `modules/streams`, `modules/products` (routes + service).
6. `src/routes.ts` — folosesc opțiunea `routes` din `Bun.serve` în loc de `if`-uri:
   ```ts
   routes: {
     "/health": { GET: handle(() => json({ status: "ok" })) },
     "/api/streams": { GET: handle(listStreams), POST: handle(createStream) },
     "/api/streams/:id": { GET: handle(getStream) }, // req.params.id
   }
   ```
   (Verific în documentația Bun cum se tratează `OPTIONS` pentru preflight.)
7. `src/index.ts` doar pornește serverul. Actualizez `package.json`: `"dev": "bun --watch src/index.ts"`.
8. Testez manual toate endpoint-urile vechi (Postman / Thunder Client / `curl`) → răspund la fel.

**Ce trebuie să înțeleg:**
- **Separation of concerns:** fiecare fișier are un singur motiv să se schimbe.
- De ce validez `.env` la pornire: „fail fast" — prefer să nu pornească serverul decât să crape la prima cerere.
- De ce **o singură** instanță `PrismaClient`: fiecare instanță deschide propriul pool de conexiuni la Postgres.
- `handle()` e un **middleware**: o funcție care învelește alta și adaugă comportament înainte și după (exact ideea din Koa/Express).
- De ce CORS restrâns la `FRONTEND_URL` e mai sigur decât `*`.

**Verificare:**
- Ce se întâmplă dacă șterg `DATABASE_URL` din `.env`? Unde văd eroarea?
- Ce cod HTTP primește clientul dacă Prisma aruncă o eroare neașteptată? Ce vede clientul și ce văd eu în log?
- De ce `routes.ts` nu importă nimic din Prisma?

**Gata când:** toate endpoint-urile vechi merg, `index.ts` are sub 15 linii, iar un body JSON invalid întoarce `400`, nu crash.

---

### Ziua 2 — Model de date v2 + validare

**Obiectiv:** Un model de date pe care l-aș putea apăra la interviu, plus validarea tuturor datelor primite.

**Pași:**
1. Modific `schema.prisma`:
   ```prisma
   enum Role        { VIEWER STREAMER }
   enum OrderStatus { PENDING PAID CANCELLED }

   model User {
     // + cognitoSub String @unique   (ID-ul userului din Cognito, Ziua 4)
     // role Role @default(VIEWER)
     // + ivsChannelArn, ivsPlaybackUrl, ivsIngestEndpoint (String?, Ziua 6)
   }
   model Stream {
     // - streamKey   (ȘTERS: e un secret, îl cer de la AWS când e nevoie)
     // + ivsChatRoomArn String?
     // + @@index([userId])
   }
   model Product {
     // price Float  →  priceCents Int
     // + @@index([streamId])
   }
   model Order {
     // price Float  →  priceCents Int   (prețul de la momentul cumpărării)
     // status OrderStatus @default(PENDING)
     // + stripeSessionId String? @unique
     // + @@index([userId]) @@index([productId])
   }
   ```
2. `bunx prisma migrate dev --name v2_model` → citesc SQL-ul generat și înțeleg fiecare linie.
3. `prisma/seed.ts`: un streamer, un viewer, un stream cu 3 produse. Rulez cu `bun prisma/seed.ts` (înlocuiește `POST /api/users/seed`).
4. Scheme Zod în `*.schema.ts` pentru fiecare body:
   ```ts
   export const CreateProductSchema = z.object({
     streamId: z.string().uuid(),
     title: z.string().min(1).max(120),
     description: z.string().max(2000).optional(),
     priceCents: z.number().int().positive(),
     stock: z.number().int().min(0).default(10),
     imageUrl: z.string().url().optional(),
   });
   ```
   Un helper `parseBody(req, Schema)` aruncă `HttpError(400, ...)` cu mesajele Zod.
5. Endpoint-uri produse:
   - `GET /api/streams/:id/products`;
   - `PATCH /api/products/:id`;
   - `DELETE /api/products/:id`;
   - `POST /api/streams/:id/pin` cu `{ productId }`: într-o **tranzacție**, scot pin-ul de pe toate produsele stream-ului și îl pun pe cel ales.

**Ce trebuie să înțeleg:**
- De ce **cenți întregi** pentru bani: `Float` e binar și nu poate reprezenta exact `0.1`. Stripe folosește tot cenți.
- De ce `Order.priceCents` e o **copie** a prețului: dacă streamer-ul schimbă prețul mâine, comanda de ieri trebuie să rămână cu prețul plătit.
- Ce face un **index**: căutarea după `streamId` nu mai parcurge tot tabelul. Postgres creează automat index pe PK, dar **nu** pe foreign keys.
- `enum` vs `String`: DB-ul refuză valori greșite (`"STREMER"`).
- **Validează la graniță:** orice vine din afară (body, query, params) e nesigur până trece prin Zod.
- **Tranzacție:** ori se execută toate operațiile, ori niciuna. Fără ea, două produse ar putea fi fixate simultan.
- REST: `GET` citește, `POST` creează, `PATCH` modifică parțial, `DELETE` șterge. `204` = succes fără body.

**Verificare:**
- Cât e `0.1 + 0.2` în JavaScript? De ce contează la un magazin?
- De ce am scos `streamKey` din DB?
- Alternativă la `isPinned`: `Stream.pinnedProductId`. Care sunt avantajele fiecărei variante? (Răspuns bun la interviu: cu `pinnedProductId` e **imposibil** să ai 2 produse fixate; cu `isPinned` trebuie să garantez asta prin tranzacție.)

**Gata când:** migrarea e aplicată, seed-ul merge, iar `POST /api/products` cu `priceCents: "abc"` întoarce `400` cu un mesaj clar.

---

### Ziua 3 — Teste + CI

**Obiectiv:** Plasa de siguranță pentru tot ce urmează. De azi, nicio funcționalitate nouă fără test.

**Pași:**
1. O bază separată pentru teste: `liveshop_test` (`DATABASE_URL` diferit în `.env.test`).
2. Teste de integrare cu `bun test` în `tests/`:
   - service-urile direct (ex. `createProduct`, `pinProduct`);
   - câteva endpoint-uri prin HTTP (`fetch` către serverul pornit pe alt port).
3. Înainte de fiecare test golesc tabelele (`deleteMany` în ordinea corectă a foreign key-urilor).
4. `.github/workflows/ci.yml`:
   ```yaml
   name: CI
   on: [push, pull_request]
   jobs:
     backend:
       runs-on: ubuntu-latest
       services:
         postgres:
           image: postgres:16-alpine
           env: { POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: liveshop_test }
           ports: ["5432:5432"]
           options: --health-cmd pg_isready --health-interval 5s --health-retries 10
       defaults: { run: { working-directory: backend } }
       env:
         DATABASE_URL: postgresql://user:password@localhost:5432/liveshop_test
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
         - run: bun install --frozen-lockfile
         - run: bunx prisma migrate deploy
         - run: bun run typecheck
         - run: bun test
     frontend:
       runs-on: ubuntu-latest
       defaults: { run: { working-directory: frontend } }
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
         - run: bun install --frozen-lockfile
         - run: bun run lint
         - run: bun run build
   ```
5. Push → pe GitHub, tab-ul **Actions** e verde.

**Ce trebuie să înțeleg:**
- **Test unitar** (o funcție izolată) vs **test de integrare** (codul meu + o bază de date reală). Aici prefer integrarea: bug-urile mele vor fi mai ales în interacțiunea cu DB-ul.
- De ce o bază **separată** pentru teste: testele șterg date.
- `migrate dev` (local: creează migrări noi) vs `migrate deploy` (CI/producție: doar aplică migrările existente).
- **CI** = la fiecare push, un server curat verifică dacă proiectul compilează și testele trec. „La mine merge" nu mai e un argument.
- `--frozen-lockfile`: CI instalează **exact** versiunile din `bun.lock`.

**Verificare:**
- Ce se întâmplă dacă un coleg face push cu o eroare de TypeScript?
- De ce testele golesc DB-ul înainte, nu după?

**Gata când:** `bun test` trece local, iar CI e verde pe GitHub.

---

### Ziua 4 — Autentificare cu Cognito (backend)

**Obiectiv:** API-ul știe cine face cererea și refuză ce nu are voie.

**Pași:**
1. În consola AWS → **Cognito** → creez un **User Pool**: login cu email, verificare email, un **App client** public (fără client secret). Notez `userPoolId`, `clientId` și regiunea.
2. `bun add aws-jwt-verify` (librăria oficială AWS).
3. `src/middleware/auth.ts`:
   ```ts
   import { CognitoJwtVerifier } from "aws-jwt-verify";

   const verifier = CognitoJwtVerifier.create({
     userPoolId: env.COGNITO_USER_POOL_ID,
     clientId: env.COGNITO_CLIENT_ID,
     tokenUse: "id", // ID token-ul conține și email-ul
   });

   export async function requireUser(req: Request) {
     const token = req.headers.get("authorization")?.replace("Bearer ", "");
     if (!token) throw new HttpError(401, "Lipsește token-ul");
     const payload = await verifier.verify(token).catch(() => {
       throw new HttpError(401, "Token invalid sau expirat");
     });
     // găsesc sau creez userul local după payload.sub
     return upsertUserFromCognito(payload);
   }

   export function requireRole(user: User, role: Role) {
     if (user.role !== role) throw new HttpError(403, "Nu ai acces");
   }
   ```
4. `GET /api/me` → întoarce userul curent.
5. Protejez:
   - `POST /api/streams` și produsele → doar `STREAMER`;
   - un streamer poate modifica doar **propriile** stream-uri și produse (verific `stream.userId === user.id`).
6. Teste: fără token → `401`; viewer care creează stream → `403`; streamer pe stream-ul altcuiva → `403`.

**Ce trebuie să înțeleg:**
- **JWT** = 3 bucăți base64 (`header.payload.signature`). Oricine poate **citi** payload-ul (îl lipesc pe jwt.io), dar nimeni nu îl poate **modifica** fără să strice semnătura.
- Backend-ul verifică semnătura cu cheile publice ale Cognito (**JWKS**), descărcate automat de `aws-jwt-verify`. Nu am nevoie de nicio parolă.
- **ID token** (cine ești: email, nume) vs **access token** (ce ai voie să faci). AWS recomandă access token pentru API-uri. Eu folosesc ID token pentru simplitate, pentru că are email-ul. **Asta e un trade-off pe care îl menționez la interviu.**
- **Autentificare** (cine ești → `401`) vs **autorizare** (ai voie? → `403`).
- **IDOR**: fără verificarea `stream.userId === user.id`, orice streamer ar putea modifica produsele altuia doar schimbând ID-ul din URL. Una dintre cele mai frecvente vulnerabilități reale.
- De ce păstrez și tabela `User` în Postgres, deși userii sunt în Cognito: am nevoie de foreign keys (comenzi, stream-uri) și de rol.

**Verificare:**
- Dacă cineva îmi fură JWT-ul, ce poate face și cât timp?
- De ce backend-ul nu are nevoie de parola userului?
- Diferența dintre `401` și `403`, cu un exemplu din proiectul meu.

**Gata când:** testele de autorizare trec și niciun endpoint de scriere nu funcționează fără token.

---

### Ziua 5 — Frontend: fundație + login

**Obiectiv:** Next.js vorbește cu backend-ul și are login.

**Pași:**
1. Citesc din `frontend/node_modules/next/dist/docs/` ghidurile despre App Router, Server/Client Components și data fetching (cu `cacheComponents` activ).
2. `frontend/.env.local`: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_COGNITO_USER_POOL_ID`, `NEXT_PUBLIC_COGNITO_CLIENT_ID`.
3. `bun add aws-amplify` → în `lib/auth.ts`:
   - `Amplify.configure({ Auth: { Cognito: { userPoolId, userPoolClientId } } })`;
   - funcții: `signUp`, `confirmSignUp`, `signIn`, `signOut`, `getIdToken()` (cu `fetchAuthSession()`).
4. `lib/api.ts` — un `apiFetch(path, options)` care pune automat `Authorization: Bearer <token>` și aruncă eroare la răspuns non-2xx. **Toate** apelurile către backend trec pe aici.
5. Pagini:
   - `/signup` (cu codul de confirmare din email);
   - `/login`;
   - `/` (lista de stream-uri live: titlu, streamer, număr produse).
6. Un header cu „Login" / numele userului + „Logout".
7. Șterg template-ul default (`next.svg`, `vercel.svg`, conținutul din `page.tsx`) și schimb `metadata` din `layout.tsx`.

**Ce trebuie să înțeleg:**
- **Server Component** (implicit; rulează pe server, poate face fetch direct, fără JS în browser) vs **Client Component** (`"use client"`; are state, `onClick`, acces la `window`). Login-ul e client, lista de stream-uri poate fi server.
- `NEXT_PUBLIC_` = variabila ajunge în browser, deci **niciodată** secrete acolo. ID-urile Cognito sunt publice prin design.
- Unde ține Amplify token-urile (implicit în `localStorage`) și ce risc are asta (XSS). Alternativa: cookie-uri `httpOnly`.
- De ce un singur `apiFetch`: un singur loc pentru token, erori și URL de bază.

**Verificare:**
- De ce nu pot folosi `useState` într-un Server Component?
- Ce s-ar întâmpla dacă aș pune cheia secretă Stripe într-o variabilă `NEXT_PUBLIC_`?

**Gata când:** mă înregistrez, confirm email-ul, mă loghez și văd lista de live-uri din backend.

---

### Ziua 6 — AWS IVS: video live

**Obiectiv:** Streamer-ul trimite video din OBS spre AWS.

**Pași:**
1. **IAM** → creez un user pentru dezvoltare, cu o politică care permite **doar** `ivs:*` și `ivschat:*`. Pun cheile în `backend/.env` (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). **Niciodată în git.**
2. `bun add @aws-sdk/client-ivs` → `src/lib/aws.ts` exportă `ivsClient`.
3. `streams.service.ts` → `getOrCreateChannel(user)`:
   - dacă streamer-ul nu are canal: `CreateChannelCommand({ name, type: "BASIC", latencyMode: "LOW" })`;
   - salvez pe `User`: `ivsChannelArn`, `ivsPlaybackUrl`, `ivsIngestEndpoint`.
   Un canal per streamer, refolosit la fiecare live (ca pe Twitch).
4. `GET /api/me/stream-key` (doar streamer-ul) → `ListStreamKeysCommand` + `GetStreamKeyCommand` → întoarce cheia **doar proprietarului**.
5. `POST /api/streams/:id/start` și `/end`. La start verific cu `GetStreamCommand({ channelArn })` că IVS chiar primește video, apoi setez `isLive = true`.
6. `/dashboard` în frontend: serverul RTMPS (`rtmps://<ingestEndpoint>:443/app/`), stream key-ul (ascuns, cu buton „arată"), butoane Start/End.
7. OBS → Settings → Stream → Custom → lipesc serverul și cheia → Start Streaming. În consola AWS IVS văd stream-ul activ. **Opresc OBS când termin.**

**Ce trebuie să înțeleg:**
- Drumul video-ului: **OBS** → (RTMPS, protocol de *ingest*) → **IVS** (transcodare în mai multe calități) → (HLS, fișiere `.m3u8` + segmente mici) → **player**.
- **Latența**: HLS clasic are 10–30 s. IVS „low latency" are câteva secunde, important când spectatorul vrea să cumpere *acum*.
- **ARN** = ID-ul unic al oricărei resurse AWS.
- **Least privilege:** userul IAM poate face doar IVS, nu poate șterge baze de date. În producție aș folosi un **IAM Role** atașat serverului, nu chei în `.env`.
- De ce stream key-ul e secret: cine îl are poate transmite video pe canalul meu.

**Verificare:**
- Desenează pe hârtie drumul unui frame video de la camera mea până la ecranul spectatorului.
- De ce nu trimit stream key-ul în `GET /api/streams`?

**Gata când:** OBS transmite și stream-ul apare activ în consola AWS IVS.

---

### Ziua 7 — Recapitulare + buffer

**Obiectiv:** Consolidez. Probabil am rămas în urmă cu ceva — azi recuperez.

**Pași:**
1. Termin ce a rămas din zilele 1–6.
2. Recitesc **tot** codul scris, fișier cu fișier. Orice linie pe care nu o pot explica → o studiez sau o rescriu mai simplu.
3. `docs/decizii.md` — câte un paragraf pentru fiecare decizie:
   - de ce module (routes/service/schema);
   - de ce cenți;
   - de ce ID token;
   - de ce un canal IVS per streamer;
   - de ce stream key-ul nu stă în DB.
4. Explic **cu voce tare** (sau unui prieten) fluxul de la login până la OBS live, în 3 minute.
5. Rulez `/code-review` în Claude Code pe tot ce am scris și repar ce găsește (după ce înțeleg de ce e o problemă).

**Gata când:** pot desena arhitectura de până acum din memorie.

---

### Ziua 8 — Player + pagina de live

**Obiectiv:** Spectatorul vede video-ul și produsele.

**Pași:**
1. `components/VideoPlayer.tsx` (`"use client"`) cu **IVS Player SDK**: îl încarc conform documentației IVS (pachetul npm `amazon-ivs-player` sau script-ul de pe CDN-ul IVS — atenție la fișierele WebAssembly).
   În `useEffect`:
   - verific `isPlayerSupported`;
   - `create()`, `attachHTMLVideoElement(videoRef.current)`, `load(playbackUrl)`, `play()`;
   - în cleanup: `player.delete()`.
2. `/live/[id]`:
   - video;
   - lista de produse dedesubt;
   - produsul fixat ca un card peste video (poză, preț, buton „Cumpără" — încă fără acțiune);
   - mesaj „Live-ul s-a terminat" dacă `isLive` e `false`.
3. În `/dashboard`: lista produselor stream-ului curent, cu buton „Fixează" (`POST /api/streams/:id/pin`) și formular „Adaugă produs".

**Ce trebuie să înțeleg:**
- De ce player-ul trebuie să fie Client Component: are nevoie de `<video>` și de API-uri din browser.
- **`useEffect` + cleanup:** când utilizatorul pleacă de pe pagină, distrug player-ul. Altfel video-ul continuă să se descarce în fundal (memory leak).
- `useRef` — referință la elementul `<video>` din DOM, fără re-render.
- **Limitarea de azi:** spectatorul vede produsul nou fixat doar după refresh. Mâine rezolv asta.

**Gata când:** deschid live-ul în 2 browsere, video-ul merge în ambele, iar streamer-ul poate fixa produse (vizibile după refresh).

---

### Ziua 9 — Real-time cu WebSocket + Redis

**Obiectiv:** Produsul fixat, stocul și numărul de spectatori se actualizează instant la toți.

**Pași:**
1. `bun add ioredis` → `src/lib/redis.ts` cu **două** conexiuni: `pub` (comenzi normale) și `sub` (doar abonare).
2. `src/realtime/events.ts` — tipurile evenimentelor:
   ```ts
   export type StreamEvent =
     | { type: "product_pinned"; productId: string }
     | { type: "stock_updated"; productId: string; stock: number }
     | { type: "viewer_count"; count: number }
     | { type: "stream_ended" };
   ```
3. `src/realtime/socket.ts`:
   ```ts
   // 1. Clientul se conectează la /ws/streams/:id → server.upgrade(req, { data: { streamId } })
   // 2. La conectare: ws.subscribe(`stream:${streamId}`) + INCR pe numărul de spectatori
   // 3. La deconectare: DECR + publicăm noul număr

   export function publishStreamEvent(streamId: string, event: StreamEvent) {
     return pub.publish(`stream:${streamId}`, JSON.stringify(event));
   }

   // Puntea Redis → WebSocket: orice mesaj din Redis ajunge la clienții de pe ACEST server
   sub.psubscribe("stream:*");
   sub.on("pmessage", (_pattern, channel, message) => server.publish(channel, message));
   ```
4. Când se fixează un produs → `publishStreamEvent(streamId, { type: "product_pinned", productId })`.
5. Frontend: hook-ul `hooks/useStreamEvents.ts`:
   - deschide `WebSocket`;
   - parsează mesajele;
   - actualizează state-ul;
   - se reconectează după 2–3 s dacă pică;
   - închide conexiunea în cleanup.
6. Afișez „👁 23 spectatori" lângă video.

**Ce trebuie să înțeleg:**
- **Polling vs SSE vs WebSocket:**
  - polling = întreb serverul la fiecare N secunde (simplu, dar risipitor);
  - SSE = serverul trimite, într-o singură direcție;
  - WebSocket = conexiune bidirecțională, deschisă permanent.
- **De ce Redis, dacă Bun are deja `server.publish`?** `server.publish` ajunge doar la clienții conectați la **același** proces. În producție rulez mai multe instanțe în spatele unui load balancer. Redis pub/sub e „poșta" dintre instanțe: instanța A publică, iar B, C, D primesc și trimit mai departe clienților lor. **Asta e întrebarea-cheie la interviu pentru „Redis pentru real-time".**
- De ce 2 conexiuni Redis: o conexiune în modul *subscribe* nu mai poate executa alte comenzi.
- Pub/sub e „fire and forget": dacă nimeni nu ascultă, mesajul se pierde. De aceea, la încărcarea paginii citesc starea curentă din API, iar evenimentele aduc doar **schimbările**.
- Limitarea contorului de spectatori: dacă serverul crapă, `DECR` nu se mai execută → contorul rămâne greșit. (Soluție: cheie per conexiune cu TTL — o menționez ca îmbunătățire.)

**Verificare:**
- Am 3 instanțe de backend. Streamer-ul e pe instanța 1, un spectator e pe instanța 3. Explică pas cu pas cum ajunge evenimentul la el.
- Ce se întâmplă cu un spectator care se conectează *după* ce s-a fixat produsul?

**Gata când:** fixez un produs din dashboard și apare instant în celălalt browser, fără refresh.

---

### Ziua 10 — Chat cu AWS IVS Chat

**Obiectiv:** Chat live în pagina de stream.

**Pași:**
1. `bun add @aws-sdk/client-ivschat`. La crearea stream-ului: `CreateRoomCommand` → salvez `ivsChatRoomArn`.
2. `POST /api/streams/:id/chat-token` (logat) → `CreateChatTokenCommand` cu:
   - `roomIdentifier`;
   - `userId: user.id`;
   - `attributes: { displayName: user.name }`;
   - `capabilities`: `["SEND_MESSAGE"]` pentru viewer, plus `"DELETE_MESSAGE"` și `"DISCONNECT_USER"` pentru streamer-ul care deține stream-ul.
3. Frontend: `bun add amazon-ivs-chat-messaging` → `components/Chat.tsx`:
   - `new ChatRoom({ regionOrUrl, tokenProvider })`, unde `tokenProvider` cheamă endpoint-ul de mai sus;
   - `room.connect()`;
   - ascult evenimentul `"message"`;
   - trimit cu `SendMessageRequest`.
4. Neautentificat → văd chat-ul, dar în loc de input am „Loghează-te ca să scrii".
5. Streamer-ul poate șterge mesaje.

**Ce trebuie să înțeleg:**
- De ce chat **gestionat** (IVS Chat) și nu chat-ul meu prin WebSocket: AWS rezolvă scalarea la mii de oameni, conexiunile și moderarea. Eu doar decid **cine** are voie și **ce** poate face.
- **Token-ul de chat** e emis de backend-ul meu, are durată scurtă și conține permisiunile (*capabilities*). Browserul nu are niciodată chei AWS.
- Diferența dintre WebSocket-ul meu (evenimente de business: pin, stoc) și cel de chat (mesaje între oameni). De ce sunt separate: responsabilități diferite, scalare diferită.

**Gata când:** 2 useri logați în 2 browsere vorbesc pe chat, iar streamer-ul poate șterge un mesaj.

---

### Ziua 11 — Comenzi și stoc (fără vânzări în plus)

**Obiectiv:** Butonul „Cumpără" creează o comandă fără să vândă vreodată mai mult decât e în stoc.

**Pași:**
1. `POST /api/orders` cu `{ productId }`. În **tranzacție**:
   ```ts
   await prisma.$transaction(async (tx) => {
     // UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0
     const result = await tx.product.updateMany({
       where: { id: productId, stock: { gt: 0 } },
       data: { stock: { decrement: 1 } },
     });
     if (result.count === 0) throw new HttpError(409, "Stoc epuizat");

     return tx.order.create({
       data: { userId: user.id, productId, priceCents: product.priceCents, status: "PENDING" },
     });
   });
   ```
2. După tranzacție → `publishStreamEvent(..., { type: "stock_updated", ... })`.
3. **Rate limiting** cu Redis: max. 5 comenzi/minut per user.
   - `INCR rate:orders:<userId>`;
   - la prima valoare, `EXPIRE 60`;
   - peste 5 → `429 Too Many Requests`.
4. **Testul cel mai important al proiectului:** produs cu `stock: 5`, trimit **20 de comenzi simultan** (`Promise.all`) → exact 5 reușesc, 15 primesc `409`, iar stocul final e `0`, nu negativ.
5. `GET /api/me/orders` + pagina „Comenzile mele".

**Ce trebuie să înțeleg:**
- **Race condition:** varianta naivă — „citesc stocul (1), verific > 0, scad" — eșuează când 2 cereri citesc amândouă `1` în același timp și amândouă cumpără. Rezultat: stoc `-1`, un client furios.
- Soluția: verificarea și scăderea într-o **singură** instrucțiune SQL (`WHERE stock > 0`). Postgres blochează rândul în timpul update-ului, deci a doua cerere vede deja stocul nou.
- Alternative pe care le pot menționa: `SELECT ... FOR UPDATE` (lock explicit) sau o rezervare în Redis cu `DECR`.
- `409 Conflict` (starea resursei nu permite operația) vs `400` (cererea e greșită).
- De ce rate limiting: protecție împotriva boților care golesc stocul și împotriva dublu-click-ului.

**Verificare:**
- Explică de ce testul cu 20 de cereri ar pica fără `stock: { gt: 0 }` în `where`.
- Ce se întâmplă cu stocul dacă userul nu plătește niciodată? (Răspunsul vine mâine.)

**Gata când:** testul de concurență trece de 10 ori la rând.

---

### Ziua 12 — Plăți cu Stripe

**Obiectiv:** Plată reală în mod test, confirmată prin webhook.

**Pași:**
1. `bun add stripe`. În `.env`: `STRIPE_SECRET_KEY` (`sk_test_...`) și `STRIPE_WEBHOOK_SECRET`.
2. După ce creez comanda `PENDING` (Ziua 11) → `stripe.checkout.sessions.create`:
   ```ts
   {
     mode: "payment",
     line_items: [{
       price_data: { currency: "ron", product_data: { name: product.title }, unit_amount: product.priceCents },
       quantity: 1,
     }],
     metadata: { orderId: order.id },
     success_url: `${env.FRONTEND_URL}/orders/${order.id}?status=success`,
     cancel_url: `${env.FRONTEND_URL}/live/${streamId}`,
   }
   ```
   Salvez `stripeSessionId` pe comandă și întorc `session.url` → frontend-ul face redirect.
3. `POST /api/payments/webhook` (**fără** auth JWT; autentificarea e semnătura Stripe):
   - `const body = await req.text()` — body-ul **brut**, nu JSON parsat;
   - `stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature"), secret)`;
   - `checkout.session.completed` → comanda devine `PAID`;
   - `checkout.session.expired` → comanda devine `CANCELLED` + **stocul revine** (`increment: 1`) + `stock_updated`;
   - update **doar dacă** comanda e încă `PENDING`: `updateMany({ where: { id, status: "PENDING" } })` → webhook-ul poate veni de 2 ori fără efecte duble.
4. Local: `stripe listen --forward-to localhost:4000/api/payments/webhook` (îmi dă și `STRIPE_WEBHOOK_SECRET`).
5. Plătesc cu cardul de test `4242 4242 4242 4242`, orice dată din viitor, orice CVC.
6. Test: un eveniment trimis de 2 ori nu schimbă nimic a doua oară.

**Ce trebuie să înțeleg:**
- **De ce webhook, nu `success_url`:** `success_url` e doar o pagină în browser. Userul o poate deschide manual sau poate închide tab-ul înainte de redirect. Webhook-ul e Stripe care îmi confirmă **server-to-server**. **Nu am încredere niciodată în frontend pentru „am plătit".**
- **Semnătura webhook-ului:** oricine poate trimite `POST` la URL-ul meu. Semnătura dovedește că mesajul vine de la Stripe. De aceea am nevoie de body-ul brut: un JSON re-serializat ar avea alți bytes, iar semnătura n-ar mai corespunde.
- **Idempotență:** aceeași operație executată de 2 ori are același efect ca o dată. Stripe garantează livrarea „cel puțin o dată", deci duplicatele sunt normale.
- De ce **Stripe Checkout** (pagina găzduită de Stripe): datele cardului nu ajung niciodată la serverul meu → cerințele de securitate PCI rămân la Stripe.
- Ciclul de viață al comenzii: `PENDING → PAID` sau `PENDING → CANCELLED`. Desenez diagrama de stări în `docs/decizii.md`.

**Verificare:**
- Un atacator trimite `POST /api/payments/webhook` cu un JSON fals de „plată reușită". Ce se întâmplă?
- Stripe trimite același eveniment de 3 ori. Ce se întâmplă cu comanda și cu stocul?

**Gata când:** cumpăr din pagina de live → plătesc cu 4242 → comanda devine `PAID`, iar stocul scade la toți spectatorii.

---

### Ziua 13 — Docker, securitate, review

**Obiectiv:** Proiect gata de arătat: rulează în container, verificat din punct de vedere al securității.

**Pași:**
1. `backend/Dockerfile` (punct de plecare):
   ```dockerfile
   FROM oven/bun:1
   WORKDIR /app
   COPY package.json bun.lock ./
   RUN bun install --frozen-lockfile
   COPY . .
   RUN bunx prisma generate
   EXPOSE 4000
   CMD ["sh", "-c", "bunx prisma migrate deploy && bun src/index.ts"]
   ```
   Plus un `.dockerignore` (`node_modules`, `.env`).
2. Adaug serviciul `backend` în `docker-compose.yml`. Atenție: în container, `DATABASE_URL` folosește host-ul `postgres`, nu `localhost`.
3. Adaug Redis în CI (pentru testele de rate limiting și evenimente).
4. **Checklist de securitate** (bifez fiecare punct în `docs/decizii.md`):
   - [ ] Toate body-urile trec prin Zod.
   - [ ] Toate endpoint-urile de scriere cer auth; cele de proprietar verifică proprietarul (IDOR).
   - [ ] CORS doar pentru `FRONTEND_URL`.
   - [ ] Niciun secret în git: `git log -p | grep -i "sk_test\|AKIA"` nu găsește nimic.
   - [ ] Erorile `500` nu trimit stack trace-ul clientului.
   - [ ] Webhook-ul verifică semnătura.
   - [ ] Stream key-ul și token-urile de chat se dau doar celui care are dreptul.
   - [ ] Rate limiting pe comenzi.
   - [ ] Prețul vine din DB, **nu** din body-ul trimis de client.
5. Rulez `/security-review` și `/code-review` în Claude Code. Pentru fiecare problemă găsită: înțeleg **de ce** e o problemă, apoi o repar eu.
6. Completez testele lipsă (webhook, autorizare).

**Ce trebuie să înțeleg:**
- Fiecare instrucțiune din Dockerfile și de ce copiez `package.json` **înainte** de restul codului (cache pe layer-e: dependențele nu se reinstalează la fiecare modificare de cod).
- De ce `migrate deploy` la pornire (și riscul: 2 instanțe pornite simultan).
- De ce „prețul vine din DB": dacă l-aș lua din cerere, oricine ar putea cumpăra un telefon cu 1 leu.

**Gata când:** `docker compose up` pornește tot backend-ul, iar checklist-ul e bifat complet.

---

### Ziua 14 — Demo + pregătire interviu

**Obiectiv:** Proiectul se vinde singur.

**Pași:**
1. Rescriu acest README pentru **vizitatori**: ce face aplicația, screenshot-uri/GIF, arhitectura, cum o pornești în 5 comenzi, deciziile tehnice. Planul pe 14 zile îl mut în `docs/plan.md`.
2. Seed cu date demo frumoase (poze de produse, titluri realiste).
3. Înregistrez un **video demo de 2–3 minute**:
   - streamer-ul intră live;
   - fixează un produs;
   - spectatorul îl vede instant și scrie pe chat;
   - cumpără și plătește;
   - stocul scade în celălalt browser.
4. Exersez pitch-ul și întrebările din [secțiunea 8](#8-pregătirea-pentru-interviu) cu voce tare, de 3 ori.
5. Pin la repo pe GitHub + link în CV și pe LinkedIn.

---

## 7. Cum lucrez cu AI fără să am cod pe care nu-l înțeleg

Anunțul cere „lucru zilnic cu AI coding tools, **cu rigoare pe review, testare și securitate**". Iată regulile mele:

1. **Încerc mai întâi singur** (15–30 min). Abia apoi cer ajutor, cu întrebarea concretă: „de ce primesc X?", nu „scrie-mi feature-ul".
2. **Nu accept cod pe care nu-l pot explica.** Pentru orice bloc generat cer: „explică-mi linie cu linie" și „ce s-ar strica dacă scot linia asta?".
3. **Rescriu eu** codul important (tranzacția de stoc, webhook-ul, auth-ul), chiar dacă AI-ul l-a scris primul.
4. **Teste înainte de „gata":** codul generat de AI arată corect mai des decât este corect.
5. **Review la final de zi:** `/code-review` și, pentru auth/plăți, `/security-review`.
6. **Jurnal:** la final de zi scriu în `docs/jurnal.md`, cu cuvintele mele, 3 lucruri învățate. Dacă nu le pot formula, nu le-am înțeles.
7. **Commit mic, mesaj scris de mine**, care spune *de ce*, nu doar *ce*.

Asta e și un răspuns bun la interviu la întrebarea „cum folosești AI-ul?".

---

## 8. Pregătirea pentru interviu

### Pitch-ul de 2 minute

> „Am construit o platformă de live shopping inspirată de un produs real. Streamer-ul transmite din OBS prin AWS IVS,
> spectatorii văd video-ul cu câteva secunde latență, vorbesc pe chat prin IVS Chat și cumpără produsul fixat pe ecran.
> Backend-ul e în Bun și TypeScript, cu Postgres prin Prisma și autentificare Cognito.
> Evenimentele live — produsul fixat, stocul, numărul de spectatori — merg prin WebSocket, iar Redis pub/sub le distribuie între instanțe, ca să pot scala orizontal.
> Partea de care sunt cel mai mândru e cumpărarea: stocul scade atomic, deci 20 de cereri simultane pe 5 produse dau exact 5 comenzi.
> Plata se confirmă doar prin webhook Stripe verificat și idempotent.
> Am CI cu GitHub Actions și teste de integrare pe o bază reală."

### Întrebări la care trebuie să pot răspunde

| Întrebare | Ziua cu răspunsul |
|---|---|
| Ce se întâmplă dacă 1000 de oameni cumpără ultimul produs în aceeași secundă? | 11 |
| Cum ar funcționa WebSocket-ul tău pe 5 servere? | 9 |
| De ce confirmi plata prin webhook și nu prin redirect? | 12 |
| Ce face backend-ul cu un JWT? Cum știe că e valid? | 4 |
| Unde ții stream key-ul și de ce? | 6 |
| De ce bani în cenți? | 2 |
| Ce ai testat și ce nu? | 3, 11, 12 |
| Cum ai folosit AI-ul? Cum ai verificat ce a generat? | 7 |
| Ce ai face diferit cu încă o lună? | 9 (Extensii) |
| De ce n-ai folosit Java / microservicii? | 1 |

### Ce aș îmbunătăți (arată maturitate — spun asta *înainte* să fiu întrebat)

- Access token în loc de ID token, plus token-uri în cookie-uri `httpOnly`.
- Contor de spectatori rezistent la crash-uri (chei cu TTL).
- Starea live a stream-ului primită automat de la IVS prin **EventBridge**, nu prin butonul Start.
- Observabilitate: log-uri structurate, metrici, alerte.

---

## 9. Extensii (dacă termin mai devreme)

Câte una, fiecare legată de tehnologiile din anunțuri:

- **Elasticsearch** — căutare de produse cu toleranță la greșeli de scriere („iphnoe" → „iphone"). Sincronizez la crearea/modificarea produsului.
- **DynamoDB** — istoricul chat-ului (volum mare, acces simplu după `streamId` + timp). Bun exemplu pentru „SQL vs NoSQL: când alegi fiecare".
- **Stripe Connect** — payout-uri către streameri (platforma reține un comision).
- **EventBridge + IVS** — `isLive` se actualizează automat când OBS pornește/oprește.
- **Deploy pe AWS** (App Runner sau ECS Fargate) + **CD** din GitHub Actions.
- **Replay** — IVS poate înregistra live-ul în S3.

---

## 10. Comenzi utile

```bash
# Infrastructură locală
docker compose up -d            # pornește Postgres + Redis
docker compose down             # le oprește (datele rămân în volum)

# Backend (în backend/)
bun install
bun run dev                     # server cu reload automat (după Ziua 1)
bunx prisma migrate dev --name <nume>   # migrare nouă după ce modific schema
bunx prisma studio              # interfață vizuală pentru DB
bun prisma/seed.ts              # date demo (după Ziua 2)
bun test                        # teste
bun run typecheck

# Frontend (în frontend/)
bun install
bun run dev                     # http://localhost:3000

# Stripe (Ziua 12)
stripe listen --forward-to localhost:4000/api/payments/webhook
```
