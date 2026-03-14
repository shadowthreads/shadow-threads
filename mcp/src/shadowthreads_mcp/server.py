from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .tools import register_tools


def create_server() -> FastMCP:
    server = FastMCP(
        "Shadow Threads MCP",
        instructions="Expose validated Shadow Threads artifact, revision, execution, and replay tools.",
        json_response=True,
    )
    register_tools(server)
    return server


def main() -> None:
    create_server().run(transport="stdio")


if __name__ == "__main__":
    main()
