<a id="top"></a>

<div align="center">
  <img src="public/brand/feronavi-icon.svg" alt="Feronavi" width="64" height="64" />
  <h1>Feronavi</h1>
  <h3>Your team and agents, moving projects forward together.</h3>
  <p><strong>An open-source workspace connecting requirements, knowledge and delivery.</strong><br />Write together, get answers from your documents, and let agents move work forward.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-526178?style=flat" alt="License: AGPL-3.0-only" /></a>
    <a href="#mcp"><img src="https://img.shields.io/badge/MCP-Server-4f6bed?style=flat" alt="Complete MCP server" /></a>
    <a href="#rag"><img src="https://img.shields.io/badge/RAG-Built--in-247a73?style=flat" alt="Built-in RAG assistant" /></a>
    <a href="#collaboration"><img src="https://img.shields.io/badge/CRDT-Collaboration-7861a8?style=flat" alt="CRDT document collaboration" /></a>
    <a href="#get-started"><img src="https://img.shields.io/badge/deploy-Self--hosted-526178?style=flat" alt="Self-hosted deployment" /></a>
  </p>
  <p>
    <a href="https://feronavi.com/en/">Website</a> ·
    <a href="https://feronavi.com/en/docs/overview/">Documentation</a> ·
    <a href="CHANGELOG.md">Changelog (Chinese)</a> ·
    <strong><a href="#get-started">Deploy Feronavi</a></strong> ·
    <a href="#overview">Highlights</a> ·
    <a href="#collaboration">Collaboration</a> ·
    <a href="#mcp">Connect an agent</a> ·
    <a href="#feedback">Feedback</a>
  </p>
  <p><a href="README.md">简体中文</a> / <strong>English</strong></p>
</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/01-workbench-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/10-workbench-light.png" />
  <img src="docs/screenshots/10-workbench-light.png" alt="Feronavi workbench with a custom narrow frame that matches the light or dark theme" width="100%" />
</picture>

<p align="center"><sub>Product preview · Demo data · Light / dark · <a href="#more-views">More views&nbsp;→</a></sub></p>

<a id="overview"></a>

## From the first idea to the next release.

From breaking down requirements and planning iterations to writing proposals and shipping releases, Feronavi brings project work into one workspace. Teams collaborate in the platform, agents act with real project context, and accumulated knowledge is ready to search and cite.

| Core capability | What it makes possible |
| --- | --- |
| **Complete MCP server** | Let agents read context, perform business operations and verify results |
| **Built-in RAG assistant** | Search across projects, answer with current business context and follow citations to the source |
| **Live collaboration** | Edit together, merge changes automatically and sync after a brief disconnection |
| **Your deployment** | Keep data in your environment and choose your models and identity systems |

<a id="mcp"></a>

## A complete MCP server. Put your agent in the delivery loop.

**Read context. Take action. Verify the outcome.** Agents can create work items, change assignments and states, maintain documents, and manage iterations and releases, then read the data back to confirm what happened.

For example, you can ask an agent to prepare a release:

> Review unfinished work in this iteration and identify release risks. Propose changes first. After my confirmation, update assignments and states, prepare the release documentation, and verify the results.

The server provides MCP **tools, resources and prompts**, with **Streamable HTTP and stdio** access. Codex, Claude Desktop, Cursor, VS Code and other MCP-compatible clients can connect through the standard protocol and dynamically discover the capabilities each task needs.

The platform UI, built-in assistant and MCP share business services, permissions and audit rules. Agent actions are bound by account permissions and token scopes, with idempotent execution and version conflict handling.

[**Connect your MCP client →**](https://feronavi.com/en/docs/mcp/)

<a id="rag"></a>

## Built-in RAG. Put your project knowledge to work.

**Turn the documents you've built up into answers you can use now.** The dedicated assistant works across projects or focuses on a selected project, combining document retrieval with current business information in one conversation.

> Why was this requirement designed this way? Use the design documents and current iteration to review the risks for this release, and include your sources.

- **Answers with sources.** Follow references to the original material, within project and document access rules.
- **Conversations that flow.** Streamed responses, Markdown, Mermaid diagrams and multiple conversations saved to your account on the server.
- **Analysis that leads to action.** Queries run directly; business changes are presented for your confirmation, then executed and verified.

Configure compatible chat and embedding models to use the assistant. Retrieval and Q&A are also available to external applications through MCP and public APIs.

<a id="rag-integration"></a>

<details>
<summary>Connect RAG: models, MCP and APIs</summary>

1. **Use it in the platform.** Follow the [knowledge assistant guide](https://feronavi.com/en/docs/assistant/) to configure chat and embedding models, publish the project documents you want to search, and confirm indexing is complete. Then select a project scope in the assistant and ask a question.
2. **Use it through an agent.** Follow the [MCP setup guide](https://feronavi.com/en/docs/mcp/), then use `rag.projects` to list accessible projects, `rag.search` to retrieve material and `rag.chat` for answers with citations.
3. **Connect your application.** Get the OpenAPI 3.1 description from your instance at `GET /api/v1/openapi.json`. Authenticate with a platform API token using Bearer authentication. Use `POST /api/v1/rag/search` for retrieval and `POST /api/v1/rag/chat` for Q&A; the description includes request and response schemas, conversations and streaming endpoints.

The OpenAPI description covers the public RAG API. Retrieval and citations respect the current identity, the token's project scope and document permissions.

</details>

<a id="collaboration"></a>

## Write together. Move the project forward together.

Refine a proposal, capture a discussion or prepare a delivery handbook together, while an agent organizes work items and moves the iteration forward.

- **Edit together.** Write in the same project document, merge changes automatically, and review or restore earlier revisions.
- **Keep writing through a disconnection.** Continue editing a document that has already loaded. Changes are saved in the current browser, then synced and merged when the connection returns.
- **Coordinate with agents.** Business changes follow shared permission and version rules. Conflicts are reported explicitly, so the person or agent making the change can check the latest state before retrying.
- **Stay up to date.** Business changes and in-app notifications update automatically across browser tabs and service instances.

<details>
<summary>How collaboration and offline recovery work</summary>

Document content uses Yjs CRDT to merge concurrent edits. Structured operations such as work items, scheduling and approvals use version checks, idempotent execution, transactions and events emitted after commit. Synchronization and notifications respect access permissions.

Opening a document for the first time requires a connection. Offline edits are saved in the current browser; recovery after closing the page requires local storage to be available. These records cannot be retained if the browser disables both IndexedDB and localStorage.

</details>

## Built for the full delivery cycle

From today's tasks to the next release, each step has a view that fits the work.

| Part of the work | Platform capabilities |
| --- | --- |
| **Capture and break down** | Product attribution, requirement revisions and change impact; tasks and subtasks with discussions and attachments |
| **Plan and deliver** | Milestones, iterations and releases; boards, tables, calendars and timelines |
| **Test and release** | Versioned test cases, test plans, failed runs linked to defects and retests; PR/CI/build evidence, release gates and feedback |
| **Document and hand over** | Collaborative document editing, offline recovery, navigation, revision history, permissions and rollback |
| **Coordinate and automate** | Custom workflows, approvals, automation, SLAs and in-app notifications |
| **Review and oversee** | Personal workbench, burndown, cumulative flow, portfolios and audit records |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/04-wiki-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/11-wiki-light.png" />
  <img src="docs/screenshots/11-wiki-light.png" alt="Feronavi project handbook with navigation, content and a table" width="100%" />
</picture>

## Capabilities backed by real execution

Concurrent editing and offline recovery, business operations through a real Codex client, and Docker deployment with backup and restore have all been exercised. The automation scripts ship with the source so you can repeat the checks in your environment.

<details>
<summary>See the validation scope</summary>

- **Collaboration checks:** Concurrent editing, offline recovery, synchronization across tabs and service instances, and permission isolation.
- **Agent checks:** MCP business workflows, action confirmation, idempotent execution and reading back persisted results, also exercised through a real Codex client.
- **Deployment checks:** Fresh Docker installations, service restarts, backup and restore, and matching build artifacts between source and container images.

These checks validate business behavior and data consistency. Task planning and interaction in each client depend on its MCP support and the model it uses.

</details>

## Open source. Your deployment.

Run it in your own environment, with your own model providers and identity systems. Roles and data scopes govern access; OIDC, LDAP / AD, 2FA and SCIM 2.0 connect to the way your team manages accounts.

Chinese and English interfaces, light and dark themes, and email, IM, webhooks and third-party integrations you can configure as needed.

<a id="get-started"></a>

## Get started

The installation target for this release is **0.3.0**. The Docker commands pin that version. Before installing, confirm that the [release page](https://github.com/JasperPengC/feronavi/releases/tag/v0.3.0) provides the official images, source archive, and companion MCP bridge package.

With Docker Compose installed, download the Compose file and start a new instance. No Node.js installation or source compilation is required:

```bash
mkdir feronavi && cd feronavi
curl -fL https://raw.githubusercontent.com/JasperPengC/feronavi/v0.3.0/compose.yaml -o compose.yaml

# First installation: create a local database password
(umask 077; test -e .env || echo "DB_PASSWORD=$(openssl rand -hex 24)" > .env)

docker compose pull
docker compose up -d --wait
docker compose ps
```

Once the services are ready, open [http://127.0.0.1:3000/setup](http://127.0.0.1:3000/setup) to create your organization and administrator.

These commands pull `ghcr.io/feronavi/feronavi-app:0.3.0` and `ghcr.io/feronavi/feronavi-db:16-0.2.0`. The companion MCP bridge is `feronavi-mcp@0.1.1`. Prebuilt images have been validated on **Linux x86-64 (amd64)**. Other architectures have not completed validation. See the [0.3.0 upgrade and recovery notes](UPGRADING.md), and confirm the target artifacts have been officially released before upgrading.

Before opening access to your team, follow the [production deployment guide](https://feronavi.com/en/docs/deployment/) to configure an HTTPS reverse proxy. Before upgrading an existing instance, follow the [backup and upgrade guide](https://feronavi.com/en/docs/operations/) to back up the database and data volume and review the database image's migration requirements. See [quick start](https://feronavi.com/en/docs/quick-start/) for first access to a remote server and startup troubleshooting.

<details>
<summary>Build from source</summary>

To try or modify the current source, clone the main branch into a separate directory and build it:

```bash
git clone --branch main --depth 1 https://github.com/JasperPengC/feronavi.git feronavi-source
cd feronavi-source
(umask 077; test -e .env || echo "DB_PASSWORD=$(openssl rand -hex 24)" > .env)
docker compose -f compose.yaml -f compose.source.yaml up -d --build --wait
```

The first build compiles database extensions and can take some time. For an existing instance, keep its directory, project name and data volumes. Set `FERONAVI_VERSION` and `FERONAVI_DB_VERSION` explicitly in `.env` when upgrading.

</details>

For your first project, start here:

1. Create a project, invite teammates and break your first requirement into work items.
2. Publish a project document, follow the [knowledge assistant guide](https://feronavi.com/en/docs/assistant/) to configure models and complete indexing, and ask the assistant a question that needs a cited source.
3. Create an API token, follow the [MCP setup guide](https://feronavi.com/en/docs/mcp/) to connect an agent, and ask it to review progress and suggest the next step.

<a id="documentation"></a>

## Integration and help

The [documentation](https://feronavi.com/en/docs/overview/) covers installation, everyday collaboration, agent access and operations. Start with the guide for your current task:

| I want to… | Start here |
| --- | --- |
| **Install a new instance** | [Quick start and first-run setup](https://feronavi.com/en/docs/quick-start/) |
| **Open access to my team** | [Production deployment and reverse proxies](https://feronavi.com/en/docs/deployment/) |
| **Manage projects and tasks** | [Projects and plans](https://feronavi.com/en/docs/projects/) · [Work items and views](https://feronavi.com/en/docs/work-items/) |
| **Write and collaborate on documents** | [Project documents](https://feronavi.com/en/docs/documents/) |
| **Connect an agent** | [MCP client configuration and access](https://feronavi.com/en/docs/mcp/) |
| **Use the knowledge assistant** | [Model setup, retrieval and conversations](https://feronavi.com/en/docs/assistant/) |
| **Manage members and permissions** | [Permissions and identity](https://feronavi.com/en/docs/permissions/) |
| **Back up or upgrade an instance** | [Backups, migration and upgrades](https://feronavi.com/en/docs/operations/) |
| **Troubleshoot a problem** | [Frequently asked questions](https://feronavi.com/en/docs/faq/) |
| **Report a security issue** | [Security reporting instructions](SECURITY.md) |

For application integrations, see [RAG tools and public APIs](#rag-integration) and the [MCP stdio bridge package reference](packages/feronavi-mcp/README.md).

<a id="more-views"></a>

## More views

<details>
<summary>Explore project overviews, delivery insights, timelines and themes</summary>

| Projects and delivery | Workspace and appearance |
| --- | --- |
| [Project board](docs/screenshots/03-board.png) | [Knowledge assistant](docs/screenshots/12-assistant.png) |
| [Project overview](docs/screenshots/02-project-overview.png) | [All projects](docs/screenshots/09-projects.png) |
| [Iteration insights](docs/screenshots/05-insights.png) | [Personal preferences](docs/screenshots/07-settings.png) |
| [Delivery timeline](docs/screenshots/08-timeline.png) | [Sign-in page](docs/screenshots/06-login.png) |
| [Dark workbench](docs/screenshots/01-workbench-dark.png) | [Dark document reader](docs/screenshots/04-wiki-dark.png) |

Screenshots use fictional teams and business data in a dedicated demo environment. Transparent backgrounds and custom, unbranded frames accompany the main screenshots, which follow your light or dark reading theme.

</details>

<a id="acknowledgments"></a>

## Acknowledgments

Thanks to the following supporters for providing model API access and usage credits during Feronavi's development.

### Sponsorship

- [Xlinks](https://api.xlinks.site/)

### LINUX DO community support

- [Agent Router](https://agentrouter.org/)
- [Any Router](https://anyrouter.top/)
- [千刀佬](https://linux.do/u/andrew-hh)

*Listed in no particular order.*

## Community

This project is shared in the [LINUX DO](https://linux.do) community.

<a id="feedback"></a>

## Feedback and license

Issues are welcome for bug reports and suggestions. The project is developed and maintained by its owner and does not currently accept Pull Requests. Please follow the [security reporting instructions](SECURITY.md) for vulnerabilities instead of disclosing details in a public issue.

Feronavi is licensed under [AGPL-3.0-only](LICENSE).

[Back to top ↑](#top)
