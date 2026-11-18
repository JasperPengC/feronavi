<a id="top"></a>

<div align="center">
  <img src="public/brand/feronavi-icon.svg" alt="Feronavi" width="64" height="64" />
  <h1>Feronavi</h1>
  <h3>Project collaboration. Built for the agent era.</h3>
  <p><strong>An open-source project workspace for people and agents.</strong><br />Connect your team, knowledge and execution—from requirements to release.</p>
  <p>Complete MCP server · Built-in RAG · End-to-end workflows · Self-hosted</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-526178?style=flat" alt="License: AGPL-3.0-only" /></a>
    <a href="#mcp"><img src="https://img.shields.io/badge/MCP-Server-4f6bed?style=flat" alt="Complete MCP server" /></a>
    <a href="#rag"><img src="https://img.shields.io/badge/RAG-Built--in-247a73?style=flat" alt="Built-in RAG assistant" /></a>
    <a href="#get-started"><img src="https://img.shields.io/badge/deploy-Self--hosted-526178?style=flat" alt="Self-hosted deployment" /></a>
  </p>
  <p>
    <strong><a href="#get-started">Deploy Feronavi</a></strong> ·
    <a href="#overview">Highlights</a> ·
    <a href="#mcp">MCP</a> ·
    <a href="#rag">RAG assistant</a> ·
    <a href="#more-views">More views</a> ·
    <a href="#documentation">Documentation</a> ·
    <a href="#feedback">Feedback</a>
  </p>
  <p><a href="README.md">简体中文</a> / <strong>English</strong></p>
</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/01-workbench-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/10-workbench-light.png" />
  <img src="docs/screenshots/10-workbench-light.png" alt="Feronavi workbench with an iMac frame that matches the light or dark theme" width="100%" />
</picture>

<p align="center"><sub>Actual product interface · Dedicated demo data · Adapts to light and dark themes</sub></p>

<a id="overview"></a>

## From the first idea to the next release.

Behind every requirement are plans, discussions, decisions and the actions that move it forward. Feronavi connects them into a complete workflow: teams collaborate in the platform, agents act through MCP, and built-in RAG brings project knowledge and sources into the conversation.

Move work forward yourself, or bring an agent in with the project context it needs.

| Core capability | What it makes possible |
| --- | --- |
| **Complete MCP server** | Give agents a path through the business workflow: discover context, perform actions and verify results |
| **Built-in RAG assistant** | Bring project knowledge into conversations, search across projects and ground analysis in cited sources |
| **Connected delivery** | Keep requirements, work items, documents, iterations and releases connected, with progress and decisions traceable |
| **Your deployment** | Open source, with your team managing data, identity, model providers and integrations |

<a id="mcp"></a>

## A complete MCP server. Put your agent in the delivery loop.

**Understand the task. Take action. Verify the outcome.** Feronavi gives agents a standard entry point for complete business workflows, making project work something they can actively participate in.

For example, you can ask an agent to prepare a release:

> Review unfinished work in this iteration and identify release risks. Propose changes first. After my confirmation, update assignments and states, prepare the release documentation, and verify the results.

| Stage | What the agent can do |
| --- | --- |
| **Understand context** | Discover tools, read projects, members, fields and workflows, and establish the task scope |
| **Move work forward** | Create and update work items, change states, maintain documents, and manage iterations and releases |
| **Verify results** | Read back persisted data, check outcomes, and handle version conflicts and safe retries |

The server provides MCP **tools, resources and prompts**, with **Streamable HTTP and stdio** access. Codex, Claude Desktop, Cursor, VS Code and other MCP-compatible clients can connect through the standard protocol and dynamically discover the capabilities each task needs.

The platform UI, built-in assistant and MCP share business services and permission rules. Account permissions, token scopes, idempotent writes and audit records govern execution. Identity steps such as sign-in and 2FA use dedicated screens.

[**Connect your MCP client →**](packages/feronavi-mcp/README.md)

<a id="rag"></a>

## Built-in RAG. Put your project knowledge to work.

**Turn the documents you've built up into answers you can use now.** The dedicated assistant works across projects or focuses on a selected project, combining document retrieval with current business information in one conversation.

> Why was this requirement designed this way? Use the design documents and current iteration to review the risks for this release, and include your sources.

- **Answers with sources.** Follow references to the original material, within project and document access rules.
- **Conversations that flow.** Streamed responses, Markdown, Mermaid diagrams and multiple conversations saved to your account on the server.
- **Analysis that leads to action.** Queries run directly; business changes are presented for your confirmation, then executed and verified.

Knowledge Q&A is also available through MCP tools and public APIs described with OpenAPI 3.1. The built-in assistant and external agents can use the same retrieval and business capabilities. Configure your own compatible model and embedding providers to get started.

[**Explore the RAG assistant and API →**](#rag)

## Built for the full delivery cycle

From what you need to do today to what your team needs to ship next, Feronavi keeps the views of your work connected.

| Part of the work | Platform capabilities |
| --- | --- |
| **Capture and break down** | Ideas, requirements, tasks, defects and subtasks, with discussions and attachments |
| **Plan and deliver** | Milestones, iterations and releases; boards, tables, calendars and timelines |
| **Document and hand over** | Project documents, navigation, revision history, permissions and rollback |
| **Coordinate and automate** | Custom workflows, approvals, automation, SLAs and in-app notifications |
| **Review and oversee** | Personal workbench, burndown, cumulative flow, portfolios and audit records |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/04-wiki-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/11-wiki-light.png" />
  <img src="docs/screenshots/11-wiki-light.png" alt="Feronavi project handbook with navigation, content and a table" width="100%" />
</picture>

## Capabilities backed by real execution

Both MCP and the built-in assistant have passed validation across **22 representative business workflows**, including delivery, planning, documents, workflows, collaboration, portfolios and organization management. Integration testing with a real Codex client completed **68 MCP calls and 18 business outcome checks**.

Validation covers business execution, permissions and persisted results. Task planning and interaction in each client depend on its MCP support and the model it uses.

## Open source. Your deployment.

Run it in your own environment, with your own model providers and identity systems. Roles and data scopes govern access; OIDC, LDAP / AD, 2FA and SCIM 2.0 connect to the way your team manages accounts.

Chinese and English interfaces, light and dark themes, and email, IM, webhooks and third-party integrations you can configure as needed.

<a id="get-started"></a>

## Get started

With Docker Compose installed, run these commands from the source root to build and start a new instance:

```bash
# First installation: create a local database password
(umask 077; test -e .env || echo "DB_PASSWORD=$(openssl rand -hex 24)" > .env)

docker compose -f compose.yaml -f compose.source.yaml up -d --build
docker compose -f compose.yaml -f compose.source.yaml ps
```

Once the services are ready, open [http://127.0.0.1:3000/setup](http://127.0.0.1:3000/setup) to create your organization and administrator. The first build compiles database extensions and can take some time.

For production, put the instance behind an HTTPS reverse proxy. Before upgrading an existing instance, back up the database and data volume and review the database image's migration requirements.

<a id="documentation"></a>

## Documentation

| I want to… | Start here |
| --- | --- |
| **Deploy and operate** | [Installation and first-run setup](#get-started) |
| **Connect an agent** | [MCP client configuration and access](packages/feronavi-mcp/README.md) |
| **Integrate knowledge and chat** | [RAG assistant and public API](#rag) |
| **Report a security issue** | [Security reporting instructions](SECURITY.md) |

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

Screenshots show fictional teams and business content in a dedicated demo environment. The interface is captured at 3840 × 2160; the complete image is 4400 × 3000 with a transparent background. The custom, unbranded frame has equally narrow bezels on all four sides and a simple stand. The main screenshots follow your reading theme, with a silver frame in light mode and a gray frame in dark mode.

</details>

<a id="feedback"></a>

## Feedback and license

Issues are welcome for bug reports and suggestions. The project is developed and maintained by its owner and does not currently accept Pull Requests. Please follow the [security reporting instructions](SECURITY.md) for vulnerabilities instead of disclosing details in a public issue.

Feronavi is licensed under [AGPL-3.0-only](LICENSE).

[Back to top ↑](#top)
