# Grafana MCP Server

A comprehensive Model Context Protocol (MCP) server for Grafana, providing full API access for dashboards, datasources, alerting, annotations, and Prometheus metrics.

## Features

- **Dashboards** – get, create, update, delete dashboards; version history
- **Folders** – list, create, update, delete folders with nested folder support
- **Datasources** – list, get, create, update, delete datasources
- **Search** – search dashboards and folders by query, tags, type
- **Annotations** – list, create, update, delete annotation events
- **Alerting** – list/get/create/update/delete alert rules; contact points; notification policies; mute timings; alert instances
- **Prometheus** – instant and range PromQL queries; metric name and label discovery
- **Admin** – health check, stats, organizations, users, teams, playlists

## Quick Start

```bash
# Install and run via npx
GRAFANA_URL=http://localhost:3000 GRAFANA_TOKEN=your-token npx @tocharianou/grafana-mcp
```

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `GRAFANA_URL` | Yes | Grafana instance URL (e.g., `http://localhost:3000`) |
| `GRAFANA_TOKEN` | No* | Service Account Token (recommended) |
| `GRAFANA_USERNAME` | No* | Basic auth username |
| `GRAFANA_PASSWORD` | No* | Basic auth password |
| `GRAFANA_ORG_ID` | No | Organization ID (default: `1`) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | Set to `0` to skip TLS validation (dev only) |
| `MAX_TOKEN_CALL` | No | Max tokens per tool result (default: `20000`) |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `MCP_HTTP_PORT` | No | HTTP port when using HTTP transport (default: `3100`) |
| `MCP_HTTP_HOST` | No | HTTP host when using HTTP transport (default: `localhost`) |

*At least one authentication method is recommended. The server will start without credentials but API calls will fail with 401.

## Transport Modes

### Stdio (Default)

```json
{
  "mcpServers": {
    "grafana": {
      "command": "node",
      "args": ["/path/to/grafana-mcp/dist/index.js"],
      "env": {
        "GRAFANA_URL": "http://localhost:3000",
        "GRAFANA_TOKEN": "your-service-account-token"
      }
    }
  }
}
```

### HTTP Streamable

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3100 GRAFANA_URL=http://localhost:3000 GRAFANA_TOKEN=your-token node dist/index.js
```

## Tools Reference

### Dashboard Tools

| Tool | Description |
|------|-------------|
| `get_dashboard_by_uid` | Get full dashboard JSON by UID |
| `get_dashboard_summary` | Get compact dashboard overview (panel count, variables, time range) |
| `update_dashboard` | Create or update a dashboard |
| `delete_dashboard` | Delete a dashboard by UID |
| `get_dashboard_versions` | List dashboard version history |

### Folder Tools

| Tool | Description |
|------|-------------|
| `list_folders` | List all folders with pagination |
| `get_folder_by_uid` | Get folder details by UID |
| `create_folder` | Create a new folder |
| `update_folder` | Rename or modify a folder |
| `delete_folder` | Delete a folder and its contents |

### Datasource Tools

| Tool | Description |
|------|-------------|
| `list_datasources` | List all datasources, optionally filtered by type |
| `get_datasource` | Get datasource by UID or name |
| `create_datasource` | Create a new datasource |
| `update_datasource` | Update a datasource configuration |
| `delete_datasource` | Delete a datasource by UID |

### Search Tools

| Tool | Description |
|------|-------------|
| `search_dashboards` | Search dashboards and folders by query, tags, type, or folder |

### Annotation Tools

| Tool | Description |
|------|-------------|
| `list_annotations` | List annotation events with filtering |
| `create_annotation` | Create a new annotation event |
| `update_annotation` | Update an existing annotation |
| `delete_annotation` | Delete an annotation |

### Alerting Tools

| Tool | Description |
|------|-------------|
| `list_alert_rules` | List all alerting rules |
| `get_alert_rule` | Get alert rule by UID |
| `create_alert_rule` | Create a new alert rule |
| `update_alert_rule` | Update an existing alert rule |
| `delete_alert_rule` | Delete an alert rule |
| `list_contact_points` | List all notification contact points |
| `list_notification_policies` | Get the notification policy routing tree |
| `list_alert_instances` | List active alert instances by state |
| `list_mute_timings` | List all mute timing configurations |

### Prometheus Tools

| Tool | Description |
|------|-------------|
| `query_prometheus` | Execute an instant PromQL query |
| `query_prometheus_range` | Execute a range PromQL query |
| `list_prometheus_metric_names` | Discover available metric names |
| `get_prometheus_metric_labels` | Get label names for a metric |

### Admin Tools

| Tool | Description |
|------|-------------|
| `get_health` | Check Grafana health status |
| `get_grafana_stats` | Get server statistics (Admin role required) |
| `list_organizations` | List all organizations (Server Admin required) |
| `get_current_organization` | Get current organization info |
| `list_users` | List users in the current organization |
| `get_user_profile` | Get the current authenticated user's profile |
| `list_teams` | List teams in the organization |
| `list_playlists` | List all playlists |

## License

Apache-2.0
