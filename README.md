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
   export const routes = {
     "/health": { GET: handle(() => json({ status: "ok" })) },
     "/api/streams": { GET: handle(getStreams), POST: handle(postStream) },
   };

   export const fallback = handle((req: Request) => {
     if (req.method === "OPTIONS") return preflight();
     return json({ error: "Not Found" }, 404);
   });
   ```
   Bun trimite la `fallback` orice cerere fără rută potrivită (URL inexistent **sau** metodă nedefinită), deci preflight-ul `OPTIONS` și `404` se tratează într-un singur loc.
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

#### ✅ Rezultat Ziua 1: ce am construit și cum se leagă

**Cine pe cine folosește (importuri):**

```mermaid
flowchart TB
    DOTENV[".env<br/>DATABASE_URL, PORT, FRONTEND_URL"]

    subgraph SRC["backend/src"]
        INDEX["index.ts<br/>pornește Bun.serve"]
        ENV["config/env.ts<br/>validează .env cu Zod<br/>(fail fast)"]
        ROUTES["routes.ts<br/>harta URL → handler<br/>+ fallback: OPTIONS și 404"]

        subgraph LIB["lib/ — unelte generale"]
            HTTP["http.ts<br/>handle() · json() · readJson()<br/>HttpError · CORS"]
            PRISMA["prisma.ts<br/>un singur PrismaClient"]
        end

        subgraph MOD["modules/ — logica aplicației"]
            UR["users.routes.ts"] --> US["users.service.ts"]
            SR["streams.routes.ts"] --> SS["streams.service.ts"]
            PR["products.routes.ts"] --> PS["products.service.ts"]
        end
    end

    subgraph DOCKER["Docker (docker-compose.yml)"]
        PG[("PostgreSQL<br/>localhost:5432")]
        REDIS[("Redis<br/>localhost:6379<br/>folosit din Ziua 9")]
    end

    DOTENV -.->|citit automat de Bun| ENV
    INDEX --> ENV
    INDEX --> ROUTES
    ROUTES --> HTTP
    ROUTES --> UR
    ROUTES --> SR
    ROUTES --> PR
    HTTP -.->|FRONTEND_URL pentru CORS| ENV
    US --> PRISMA
    SS --> PRISMA
    PS --> PRISMA
    PRISMA -.->|DATABASE_URL| ENV
    PRISMA -->|SQL prin TCP| PG
```

Regula vizibilă în diagramă: fișierele `*.routes.ts` nu ating niciodată `prisma.ts`, iar fișierele `*.service.ts` nu știu nimic de HTTP.

**Drumul unei cereri (exemplu: `POST /api/streams`):**

```mermaid
sequenceDiagram
    participant C as Client (browser / curl)
    participant B as Bun.serve
    participant H as handle()
    participant R as postStream<br/>(streams.routes.ts)
    participant S as createStream<br/>(streams.service.ts)
    participant DB as PostgreSQL

    C->>B: POST /api/streams {"title": "..."}
    B->>H: găsește ruta în routes.ts
    H->>R: try { postStream(req) }
    R->>S: createStream(title)
    S->>DB: SELECT primul user
    S->>DB: INSERT INTO "Stream"
    DB-->>S: rândul creat
    S-->>R: stream
    R-->>H: json(stream, 201)
    H-->>C: 201 + header-e CORS
    Note over H: Dacă ceva aruncă eroare:<br/>HttpError → status-ul ei (400, 404...)<br/>orice altceva → 500 generic + log în consolă
```

**Endpoint-uri active după Ziua 1:**

| Metodă | URL | Modul | Răspuns |
|---|---|---|---|
| `GET` | `/health` | — (direct în `routes.ts`) | `200` `{"status":"ok"}` |
| `POST` | `/api/users/seed` | `users` | `201` userul demo |
| `GET` | `/api/streams` | `streams` | `200` live-urile cu produse și streamer |
| `POST` | `/api/streams` | `streams` | `201` live nou |
| `POST` | `/api/products` | `products` | `201` produs nou / `400` dacă lipsesc câmpuri |
| `OPTIONS` | orice URL | `fallback` | `204` preflight CORS |
| orice altceva | — | `fallback` | `404` `{"error":"Not Found"}` |

**Cum se ramifică proiectul, pornind de la `index.ts`:**

```
src/index.ts                         ← pornește serverul (o singură dată)
├── config/env.ts                    ← RAMURA 1: setările (.env validat cu Zod)
└── routes.ts                        ← RAMURA 2: harta URL → handler
    ├── lib/http.ts                  ← handle(), json(), preflight(), CORS
    ├── modules/users/users.routes.ts
    │   └── users.service.ts ─────────┐
    ├── modules/streams/streams.routes.ts
    │   └── streams.service.ts ───────┤
    └── modules/products/products.routes.ts
        └── products.service.ts ──────┤
                                      ↓
                               lib/prisma.ts  ← punctul de întâlnire din cod
                                      ↓
                               PostgreSQL     ← punctul de întâlnire al datelor
```

- **`index.ts`** rulează o singură dată, la pornire: încarcă setările și rutele, apoi pornește `Bun.serve`.
- **O cerere nu trece prin `index.ts`**, ci intră direct prin `routes.ts`.
- **La ducere**, toate ramurile se unesc în `lib/prisma.ts` → PostgreSQL. **La întoarcere**, toate răspunsurile trec prin `handle()`, care adaugă CORS și tratează erorile.
- Modulele nu se cheamă unul pe altul în cod; se leagă **prin date** (foreign keys: un user are live-uri, un live are produse).

**Exemplu real: drumul unei cereri prin toate fișierele**

Streamer-ul adaugă o curea la live-ul cu ceasuri. Cererea a fost trimisă pe serverul real; valorile de mai jos sunt cele primite.

```
POST http://localhost:4000/api/products
Content-Type: application/json

{ "streamId": "b3897c80-bbc2-408c-bc8e-0b588c706eb1", "title": "Curea piele maro", "price": "89.90", "stock": 5 }
```

| Pas | Unde | Ce se întâmplă |
|---|---|---|
| 1 | `Bun.serve` (din `index.ts`) | Primește cererea pe portul 4000, găsește calea `/api/products` și metoda `POST` |
| 2 | `routes.ts` | Direcționează spre `handle(postProduct)` |
| 3 | `handle()` în `lib/http.ts` | Deschide `try/catch`, cheamă `postProduct(req)` |
| 4 | `postProduct` în `products.routes.ts` | `readJson` transformă textul în obiect; verifică `streamId`, `title`, `price` → toate există |
| 5 | `createProduct` în `products.service.ts` | Completează lipsurile și transformă valorile (tabelul de mai jos) |
| 6 | `lib/prisma.ts` → PostgreSQL | `INSERT INTO "Product"`; Postgres verifică foreign key-ul `streamId`, generează `id` și `createdAt` |
| 7 | `createProduct` → `postProduct` | Rândul creat urcă înapoi; `json(product, 201)` |
| 8 | `handle()` | Nicio eroare → adaugă header-ele CORS |
| 9 | Bun → client | `201 Created` + produsul complet |

Ce face service-ul cu fiecare câmp (pasul 5):

| Câmp | Primit | Codul | Rezultat |
|---|---|---|---|
| `title` | `"Curea piele maro"` | așa cum e | `"Curea piele maro"` |
| `description` | lipsește | `input.description \|\| ""` | `""` |
| `price` | `"89.90"` (text) | `Number(input.price)` | **`89.9` (număr)** |
| `stock` | `5` | `input.stock ?? 10` | `5` |
| `imageUrl` | lipsește | poza implicită | `https://images.unsplash.com/...` |
| `isPinned` | lipsește | `input.isPinned ?? false` | `false` |

Răspunsul real primit:

```
HTTP/1.1 201 Created
Access-Control-Allow-Origin: http://localhost:3000        ← adăugat de handle()

{
  "id": "6f21bcf0-88a2-4dd0-86b4-a67441917f63",   ← generat de Postgres
  "title": "Curea piele maro",
  "description": "",                               ← completat de service
  "price": 89.9,                                   ← "89.90" (text) → 89.9 (număr)
  "stock": 5,
  "imageUrl": "https://images.unsplash.com/...",   ← completat de service
  "isPinned": false,                               ← completat de service
  "streamId": "b3897c80-bbc2-408c-bc8e-0b588c706eb1",
  "createdAt": "2026-10-20T11:56:38.608Z"          ← generat de Postgres
}
```

Ce s-ar fi întâmplat cu date greșite:

| Dacă trimiteai... | Unde se oprește | Răspuns |
|---|---|---|
| fără `price` | pasul 4, `postProduct` | `400` „Lipseste streamId, title sau price" |
| `{ stricat` | pasul 4, `readJson` | `400` „Body-ul cererii nu este JSON valid" |
| un `streamId` inexistent | pasul 6, Postgres refuză foreign key-ul | `500` „Eroare internă de server" |
| `price: "abc"` | **nicăieri**: `Number("abc")` = `NaN`, apoi eroare de la Prisma | `500` |

Ultimele două rânduri sunt problemele pe care le rezolvă **Ziua 2**: cu Zod, datele greșite primesc un `400` clar înainte să ajungă la baza de date.

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
3. `prisma/seed.ts`: un streamer, un viewer, un stream cu 3 produse. Rulez cu `bun run db:seed` (înlocuiește `POST /api/users/seed`). Seed-ul **golește** tabelele și le reumple, deci e doar pentru dezvoltare.
4. Scheme Zod în `*.schema.ts` pentru fiecare body:
   ```ts
   export const CreateProductSchema = z.object({
     streamId: z.uuid(),
     title: z.string().trim().min(1).max(120),
     description: z.string().trim().max(2000).optional(),
     priceCents: z.number().int().positive(),
     stock: z.number().int().min(0).default(10),
     imageUrl: z.url().optional(),
   });

   export type CreateProductInput = z.infer<typeof CreateProductSchema>;
   ```
   Un helper `parseBody(req, Schema)` în `lib/http.ts` aruncă `HttpError(400, "Date invalide", details)`, unde `details` e lista câmpurilor greșite: `[{ field: "priceCents", message: "..." }]`.
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

#### ✅ Rezultat Ziua 2: ce am construit și cum se leagă

Ziua 2 a avut trei părți: **modelul de date** (pașii 1–2), **datele demo** (pasul 3) și **validarea + endpoint-urile noi** (pașii 4–5).

```mermaid
flowchart LR
    P1["Pasul 1<br/>schema.prisma<br/>(planul)"] --> P2["Pasul 2<br/>migration.sql<br/>(baza de date se schimbă)"]
    P2 --> P3["Pasul 3<br/>seed.ts<br/>(date demo)"]
    P3 --> P4["Pasul 4<br/>Zod: parseBody, parseId<br/>(validare la intrare)"]
    P4 --> P5["Pasul 5<br/>4 endpoint-uri noi<br/>(GET, PIN, PATCH, DELETE)"]
```

**1. Modelul de date după Ziua 2**

```mermaid
erDiagram
    User ||--o{ Stream : "creează"
    User ||--o{ Order : "plasează"
    Stream ||--o{ Product : "conține"
    Product ||--o{ Order : "apare în"

    User {
        string id PK
        string email UK
        string name
        Role role "VIEWER | STREAMER"
    }
    Stream {
        string id PK
        string title
        boolean isLive
        string playbackUrl
        string userId FK "index"
    }
    Product {
        string id PK
        string title
        int priceCents "29999 = 299,99 lei"
        int stock
        boolean isPinned "maxim unul pe live"
        string streamId FK "index"
    }
    Order {
        string id PK
        int priceCents "copie a prețului la cumpărare"
        OrderStatus status "PENDING | PAID | CANCELLED"
        string stripeSessionId UK
        string userId FK "index"
        string productId FK "index"
    }
```

Ce s-a schimbat față de Ziua 1:

| Înainte | După | De ce |
|---|---|---|
| `role String` | `role Role` (enum) | Baza de date refuză valori greșite |
| `price Float` | `priceCents Int` | Bani exacți, fără erori de rotunjire |
| `status String @default("COMPLETED")` | `status OrderStatus @default(PENDING)` | O comandă nouă nu e încă plătită |
| `streamKey String?` | șters | E un secret; vine de la AWS (Ziua 6) |
| fără index pe foreign keys | `@@index([userId])`, `([streamId])`, `([productId])` | Căutări rapide |
| — | `stripeSessionId String? @unique` | Legătura cu plata (Ziua 12) |

**2. Migrarea: convertește, nu șterge**

Prisma voia să șteargă coloanele vechi și să le recreeze goale. Migrarea scrisă de mână le convertește:

```mermaid
flowchart LR
    subgraph AUTO["❌ Ce genera Prisma automat"]
        A1["DROP price"] --> A2["ADD priceCents NOT NULL"] --> A3["eroare / date pierdute"]
    end
    subgraph MANUAL["✅ Ce am scris de mână"]
        M1["ADD priceCents<br/>(permis gol)"] --> M2["UPDATE priceCents =<br/>ROUND(price × 100)"] --> M3["SET NOT NULL"] --> M4["DROP price"]
    end
```

| Date | Înainte de migrare | După migrare |
|---|---|---|
| Smartwatch Pro V2 | `price = 299.99` | `priceCents = 29999` ✅ |
| streamer@liveshop.local | `role = 'STREAMER'` (text) | `role = STREAMER` (enum) ✅ |

Verificat cu `prisma migrate diff` → „empty migration": schema și baza de date sunt identice.

**3. Seed-ul: date demo cu o singură comandă**

```mermaid
flowchart TB
    CMD["bun run db:seed"] --> DEL["1. Golește tabelele (într-o tranzacție)<br/>Order → Product → Stream → User<br/>(copii înaintea părinților, din cauza foreign keys)"]
    DEL --> U["2. Creează userii<br/>Ana Streamer (STREAMER)<br/>Mihai Viewer (VIEWER)"]
    U --> S["3. Creează live-ul cu produsele (nested create)<br/>Lansare Ceasuri Inteligente"]
    S --> PR["Smartwatch Pro V2 — 299,99 lei, stoc 15 📌<br/>Curea piele maro — 89,90 lei, stoc 30<br/>Încărcător wireless — 129,50 lei, stoc 3"]
```

ID-urile sunt fixe, deci exemplele de cereri din README merg după fiecare seed. Seed-ul **golește** baza de date: doar pentru dezvoltare.

**4. Drumul unei cereri, cu cele trei „porți" de verificare**

Fiecare cerere trece prin trei verificări. Prima care eșuează oprește cererea cu un cod clar:

```mermaid
flowchart TB
    REQ["PATCH /api/products/:id<br/>{ priceCents: 7990 }"] --> G1

    G1{"Poarta 1: parseId<br/>ID-ul din URL e UUID?"}
    G1 -- nu --> E1["400 ID invalid in URL"]
    G1 -- da --> G2

    G2{"Poarta 2: parseBody + Zod<br/>body-ul are forma corectă?"}
    G2 -- nu --> E2["400 Date invalide<br/>+ details: câmpurile greșite"]
    G2 -- da --> G3

    G3{"Poarta 3: service<br/>produsul există în baza de date?"}
    G3 -- nu --> E3["404 Produsul nu exista"]
    G3 -- da --> DB[("PostgreSQL<br/>UPDATE Product")]
    DB --> OK["200 + produsul modificat"]
```

- **Zod (porțile 1 și 2)** verifică **forma**: „arată ca un UUID?", „e număr întreg pozitiv?".
- **Service-ul (poarta 3)** verifică **realitatea**: „există?", „are comenzi?".
- Doar datele care trec de toate trei ajung la baza de date.

Exemplu de răspuns de la poarta 2, cu toate câmpurile greșite deodată:

```json
{
  "error": "Date invalide",
  "details": [
    { "field": "streamId", "message": "Invalid UUID" },
    { "field": "priceCents", "message": "Too small: expected number to be >0" }
  ]
}
```

**5. Fixarea unui produs: de ce e nevoie de tranzacție**

```mermaid
sequenceDiagram
    participant C as Streamer
    participant API as POST /api/streams/:id/pin
    participant DB as PostgreSQL

    C->>API: { productId: "curea" }
    API->>DB: produsul e în ACEST live?
    DB-->>API: da
    rect rgba(100, 150, 255, 0.15)
    Note over API,DB: TRANZACȚIE: ori ambele, ori niciuna
    API->>DB: 1. isPinned = false pentru toate produsele live-ului
    API->>DB: 2. isPinned = true pentru curea
    end
    DB-->>API: cureaua fixată
    API-->>C: 200 + produsul fixat
```

| Produs | Înainte | După |
|---|---|---|
| Smartwatch Pro V2 | 📌 `true` | `false` |
| Curea piele maro | `false` | 📌 `true` |
| Încărcător wireless | `false` | `false` |

Fără tranzacție, dacă pasul 2 eșua după pasul 1, live-ul rămânea fără niciun produs fixat.

**6. Fișierele modulului `products` după Ziua 2**

```
modules/products/
├── products.schema.ts   ← NOU: CreateProductSchema, UpdateProductSchema, PinProductSchema
│                           tipurile vin din scheme (z.infer), nu sunt scrise de mână
├── products.routes.ts   ← 5 handler-e: validează URL + body → cheamă service → răspunde
└── products.service.ts  ← logica: ensureStreamExists, findProductOrThrow,
                            listProductsForStream, createProduct, updateProduct,
                            removeProduct (409 dacă are comenzi), pinProduct (tranzacție)
```

**Endpoint-uri active după Ziua 2:**

| Metodă | URL | Răspunsuri posibile |
|---|---|---|
| `GET` | `/health` | `200` |
| `GET` | `/api/streams` | `200` |
| `POST` | `/api/streams` | `201` · `400` |
| `GET` | `/api/streams/:id/products` | `200` · `400` ID invalid · `404` live inexistent |
| `POST` | `/api/streams/:id/pin` | `200` · `400` · `404` produsul nu e în live |
| `POST` | `/api/products` | `201` · `400` date invalide · `404` live inexistent |
| `PATCH` | `/api/products/:id` | `200` · `400` · `404` |
| `DELETE` | `/api/products/:id` | `204` · `404` · `409` are comenzi |

`POST /api/users/seed` a fost scos: datele demo vin acum din `bun run db:seed`.

**Coduri HTTP folosite:**

| Cod | Înseamnă | Exemplu |
|---|---|---|
| `200` | OK | lista de produse, produs modificat |
| `201` | Creat | produs nou |
| `204` | Reușit, fără body | produs șters |
| `400` | Date greșite de la client | `priceCents: "abc"` |
| `404` | Nu există | live sau produs inexistent |
| `409` | Conflict cu starea datelor | ștergi un produs care are comenzi |
| `500` | Bug pe server | n-ar trebui să mai apară pentru date greșite |

---

### Ziua 3 — Teste + CI

**Obiectiv:** Plasa de siguranță pentru tot ce urmează. De azi, nicio funcționalitate nouă fără test.

**Pași:**
1. O bază separată pentru teste: `liveshop_test` (`DATABASE_URL` diferit în `.env.test`).
   - `bun run db:test:setup` creează baza (dacă nu există) și aplică toate migrările pe ea.
   - `bun test` setează automat `NODE_ENV=test` și citește `.env.test` peste `.env`, deci testele folosesc `liveshop_test`; `bun run dev` folosește în continuare `liveshop`.
2. Teste de integrare cu `bun test` în `tests/`:
   - service-urile direct (ex. `createProduct`, `pinProduct`);
   - câteva endpoint-uri prin HTTP (`fetch` către serverul pornit pe alt port).

   Rulez cu `bun run test`. Structura:
   ```
   bunfig.toml                     ← spune lui bun test să încarce tests/setup.ts înainte de toate
   tests/
   ├── setup.ts                    ← plasa de siguranță: refuză orice bază care nu se termină în _test
   ├── helpers.ts                  ← createFixture(): un streamer, un viewer, un live cu 3 produse, unice per test
   ├── products.service.test.ts    ← 13 teste care cheamă service-urile direct
   └── api.test.ts                 ← 11 teste care trimit cereri HTTP reale la un server pe port aleator
   ```
3. Înainte de fiecare test golesc tabelele (`deleteMany` în ordinea corectă a foreign key-urilor).
   - `resetDatabase()` în `tests/helpers.ts`: șterge Order → Product → Stream → User, într-o tranzacție.
   - `beforeEach(resetDatabase)` în `tests/setup.ts`: fiind în fișierul încărcat prin `preload`, se aplică tuturor testelor din toate fișierele.
   - `tests/reset.test.ts` dovedește că merge: primul test lasă date, al doilea găsește baza goală.
4. `.github/workflows/ci.yml`: două job-uri care rulează în paralel la fiecare push pe `main` și la fiecare pull request.
   ```mermaid
   flowchart LR
       PUSH["git push"] --> GH["GitHub Actions"]
       GH --> BE["Job backend<br/>Postgres de test pornit ca service"]
       GH --> FE["Job frontend"]
       BE --> B1["bun install --frozen-lockfile"] --> B2["prisma generate"] --> B3["prisma migrate deploy"] --> B4["bun run typecheck"] --> B5["bun run test"]
       FE --> F1["bun install --frozen-lockfile"] --> F2["bun run lint"] --> F3["bun run build"]
       B5 --> R{"toate verzi?"}
       F3 --> R
       R -- da --> OK["✅ bifă verde lângă commit"]
       R -- nu --> KO["❌ X roșu + email"]
   ```
   - Postgres pornește ca **service container**, cu baza `liveshop_test`, iar `DATABASE_URL` vine din workflow, nu din `.env.test`.
   - `bun-version: 1.4.3`: CI folosește exact versiunea de Bun de pe calculatorul meu.
   - `prisma generate` e rulat explicit, ca Prisma Client să existe chiar dacă Bun nu rulează scripturile de instalare ale pachetelor.
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

#### ✅ Rezultat Ziua 3: plasa de siguranță a proiectului

Ziua 3 nu a adăugat funcționalități noi în aplicație. A adăugat ceva care **verifică automat** tot ce am construit în Zilele 1–2 și tot ce vom construi de acum încolo.

```mermaid
flowchart LR
    P1["Pasul 1<br/>bază separată<br/>liveshop_test"] --> P2["Pasul 2<br/>24 de teste<br/>service + HTTP"]
    P2 --> P3["Pasul 3<br/>golire înainte<br/>de fiecare test"]
    P3 --> P4["Pasul 4<br/>workflow CI<br/>ci.yml"]
    P4 --> P5["Pasul 5<br/>push → CI verde<br/>pe GitHub"]
```

**Pasul 1: două baze de date în același Postgres**

```mermaid
flowchart TB
    subgraph DOCKER["Docker: containerul liveshop-postgres (localhost:5432)"]
        DEV[("liveshop<br/>datele tale de lucru<br/>Ana, Mihai, ceasul, cureaua...")]
        TEST[("liveshop_test<br/>datele testelor<br/>golită înainte de fiecare test")]
    end

    RUN["bun run dev"] -->|".env"| DEV
    SEED["bun run db:seed"] -->|".env"| DEV
    STUDIO["bunx prisma studio"] -->|".env"| DEV

    T["bun run test<br/>(NODE_ENV=test)"] -->|".env.test câștigă"| TEST
    SETUP["bun run db:test:setup"] -->|"--env-file=.env.test"| TEST
```

Testele pot șterge orice în `liveshop_test`; baza ta de lucru `liveshop` rămâne neatinsă. După fiecare migrare nouă, rulezi `bun run db:test:setup`, ca baza de test să aibă aceeași structură.

Un singur server Postgres poate ține mai multe baze separate, ca un dulap cu mai multe sertare. Ambele baze au aceleași tabele (User, Stream, Product, Order), dar datele lor nu se amestecă. Fișierul de configurare decide în ce sertar lucrează fiecare comandă, iar singura diferență dintre ele e numele bazei de la final:

| Fișier | `DATABASE_URL` | Folosit de |
|---|---|---|
| [`backend/.env`](backend/.env) | `...localhost:5432/liveshop` | `bun run dev`, `bun run db:seed`, `bunx prisma studio` |
| [`backend/.env.test`](backend/.env.test) | `...localhost:5432/liveshop_test` | `bun run test`, `bun run db:test:setup` |

Ambele fișiere sunt ignorate de git, deci nu apar pe GitHub. Pe un calculator nou le creezi din nou, cu liniile de mai sus.

Cum alege fiecare comandă baza:
- `bun test` setează singur `NODE_ENV=test` și citește **și** `.env`, **și** `.env.test`. Unde au aceeași variabilă, câștigă `.env.test`.
- `db:test:setup` primește explicit `--env-file=.env.test`.
- Restul comenzilor citesc doar `.env`.

Ce s-a întâmplat concret la pasul 1:

1. Am creat `backend/.env.test`, cu adresa spre `liveshop_test`.
2. Am adăugat scriptul `"db:test:setup": "bun --env-file=.env.test run prisma migrate deploy"` în `backend/package.json`.
3. Am rulat `bun run db:test:setup`: a **creat** baza `liveshop_test` (nu exista) și a **aplicat** cele două migrări, deci a creat în ea aceleași tabele ca în `liveshop`.
4. Am verificat că `bun test` vede `liveshop_test`, iar `bun run dev` vede în continuare `liveshop`.

De ce trebuie rulat `db:test:setup` după fiecare migrare: o migrare se aplică întâi pe `liveshop`, iar baza de test **nu se actualizează singură**. Dacă uiți, testele caută o coloană nouă care nu există în `liveshop_test` și pică. În CI nu ai grija asta, pentru că acolo baza se creează de la zero la fiecare rulare.

Cum vezi fiecare bază în Prisma Studio (http://localhost:5555, una singură odată; o oprești cu `Ctrl+C`):

```bash
cd backend
bunx prisma studio                              # liveshop: Ana, Mihai, produsele demo
bun --env-file=.env.test run prisma studio      # liveshop_test: de obicei goală
```

**Pasul 2: cum se leagă testele de codul proiectului**

```mermaid
flowchart TB
    CMD["bun run test"] --> CFG["bunfig.toml<br/>preload = tests/setup.ts"]
    CFG --> SETUP["tests/setup.ts<br/>1. plasa de siguranță (*_test)<br/>2. beforeEach: golește baza<br/>3. afterAll: închide conexiunea"]

    SETUP --> SVC["tests/products.service.test.ts<br/>13 teste"]
    SETUP --> API["tests/api.test.ts<br/>11 teste"]
    SETUP --> RST["tests/reset.test.ts<br/>2 teste"]

    SVC -->|"cheamă direct"| PS["src/modules/products/<br/>products.service.ts"]
    API -->|"Bun.serve pe port aleator<br/>+ fetch"| ROUTES["src/routes.ts"]
    ROUTES --> HANDLE["lib/http.ts: handle(), CORS,<br/>parseBody, parseId (Zod)"]
    HANDLE --> PR["products.routes.ts"] --> PS

    SVC & API & RST -.->|"createFixture()"| HELP["tests/helpers.ts"]
    PS --> PRISMA["lib/prisma.ts"] --> DB[("liveshop_test")]
    HELP --> PRISMA
```

Cele două fișiere principale testează lucruri diferite:

| Fișier | Testează | Exemplu |
|---|---|---|
| `products.service.test.ts` | **Logica**: regulile din service, fără HTTP | „după `pinProduct` există exact un produs fixat" |
| `api.test.ts` | **Tot drumul**: rutare, `handle()`, CORS, Zod, coduri de status, JSON | „`POST /api/products` cu `priceCents: "abc"` dă `400` cu `details`" |

Ce acoperă testele, pe fișierele proiectului:

| Fișier din proiect | Acoperit de |
|---|---|
| `src/routes.ts` + `fallback` | `api.test.ts`: `/health`, `OPTIONS` → `204`, URL necunoscut → `404` |
| `src/lib/http.ts` | `api.test.ts`: CORS, JSON stricat → `400`, `details` de la Zod, ID invalid → `400` |
| `products.schema.ts` | `api.test.ts`: titlu tăiat de spații, preț în lei refuzat, `PATCH {}` refuzat |
| `products.service.ts` | `products.service.test.ts`: create, list, update, remove (`409`), pin (tranzacție, concurență) |
| `streams.*` | încă neacoperit; testele vin când modulul crește (Zilele 4 și 6) |

**Pasul 3: ce se întâmplă la fiecare test**

```mermaid
sequenceDiagram
    participant B as bun test
    participant S as tests/setup.ts
    participant T as un test
    participant DB as liveshop_test

    B->>S: încarcă setup.ts (preload)
    S->>S: DATABASE_URL se termină în _test? altfel STOP
    loop pentru fiecare test, din fiecare fișier
        S->>DB: beforeEach: resetDatabase()<br/>Order → Product → Stream → User
        T->>DB: 1. pregătește: createFixture()
        T->>DB: 2. fă acțiunea (ex. pinProduct)
        T->>DB: 3. verifică: expect(...)
    end
    S->>DB: afterAll: $disconnect()
```

Dovezile că plasa funcționează:

| Experiment | Rezultat |
|---|---|
| Am **stricat intenționat** `pinProduct` | 3 teste au picat imediat: „Expected length: 1, Received length: 2" |
| Am **dezactivat golirea** | `reset.test.ts` a picat: „users: 2" în loc de `0` |
| Am rulat testele cu `DATABASE_URL` spre `liveshop` | „❌ Testele ruleaza doar pe o baza *_test", nimic șters |
| Înainte de pasul 3 | `liveshop_test` adunase 144 useri, 72 live-uri, 216 produse; după: 0 |

**Pașii 4 și 5: CI pe GitHub, rulat la fiecare push**

```mermaid
flowchart TB
    PUSH["git push pe main"] --> GH["GitHub citește<br/>.github/workflows/ci.yml"]

    GH --> BE
    GH --> FE

    subgraph BE["Job backend (calculator Ubuntu curat)"]
        direction TB
        PG[("Postgres ca service<br/>baza liveshop_test")]
        B1["install --frozen-lockfile"] --> B2["prisma generate"] --> B3["migrate deploy"] --> B4["typecheck"] --> B5["26 de teste"]
        B3 -.-> PG
        B5 -.-> PG
    end

    subgraph FE["Job frontend (alt calculator, în paralel)"]
        direction TB
        F1["install --frozen-lockfile"] --> F2["ESLint"] --> F3["next build"]
    end

    B5 --> RES{"ambele job-uri verzi?"}
    F3 --> RES
    RES -- da --> OK["✅ bifă verde lângă commit"]
    RES -- nu --> KO["❌ X roșu + email de la GitHub"]
```

Prima rulare reală (commit `2a565f0`): **ambele job-uri verzi**, toți pașii trecuți, de la pornirea Postgres până la oprirea lui.

**Cum se schimbă felul în care lucrez, de acum**

```mermaid
flowchart LR
    CODE["scriu cod<br/>(ex. Ziua 4: auth)"] --> TESTW["scriu testele<br/>pentru el"]
    TESTW --> LOCAL["bun run test<br/>local, ~1 secundă"]
    LOCAL -->|"pică"| CODE
    LOCAL -->|"trece"| COMMIT["commit + push"]
    COMMIT --> CI["CI pe GitHub"]
    CI -->|"❌ roșu"| CODE
    CI -->|"✅ verde"| NEXT["pasul următor"]
```

| Înainte de Ziua 3 | După Ziua 3 |
|---|---|
| Verificam de mână cu `curl`, după fiecare modificare | `bun run test` verifică 26 de cazuri într-o secundă |
| O modificare putea strica în tăcere ceva vechi | Testele vechi pică imediat și spun ce s-a stricat |
| „La mine merge" | CI confirmă pe un calculator curat, de la zero |
| Nimic nu verifica frontend-ul | Fiecare push trece prin ESLint și `next build` |

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
bun run db:seed                 # date demo: golește tabelele și le reumple (după Ziua 2)
bun test                        # teste
bun run typecheck

# Frontend (în frontend/)
bun install
bun run dev                     # http://localhost:3000

# Stripe (Ziua 12)
stripe listen --forward-to localhost:4000/api/payments/webhook
```
