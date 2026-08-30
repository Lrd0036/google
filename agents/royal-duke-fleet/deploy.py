"""Idempotently deploy and verify the Royal Duke ADK fleet on Agent Runtime."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
from pathlib import Path
from typing import Any

import vertexai
from vertexai import types
from vertexai.agent_engines import AdkApp

from agent import AGENT_SPECS, build_agent
from private_files import write_private_json


def resource_dict(resource: Any) -> dict[str, Any]:
    data = resource.to_dict() if hasattr(resource, "to_dict") else {}
    name = getattr(resource, "name", None) or data.get("name")
    spec = getattr(resource, "spec", None)
    identity = getattr(spec, "effective_identity", None) if spec else None
    return {
        "name": name,
        "display_name": getattr(resource, "display_name", None) or data.get("display_name") or data.get("displayName"),
        "update_time": str(getattr(resource, "update_time", None) or data.get("update_time") or data.get("updateTime") or ""),
        "effective_identity": identity or data.get("spec", {}).get("effectiveIdentity"),
    }


def existing_by_display_name(client: vertexai.Client) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for remote in client.agent_engines.list():
        record = resource_dict(remote.api_resource if hasattr(remote, "api_resource") else remote)
        if record["display_name"]:
            found[record["display_name"]] = remote
    return found


def deploy_one(project: str, location: str, bucket: str, gateway: str | None, key: str, update: bool, force_new: bool = False) -> dict[str, Any]:
    client = vertexai.Client(project=project, location=location, http_options={"api_version": "v1beta1"})
    display_name = AGENT_SPECS[key]["display_name"]
    existing = None if force_new else existing_by_display_name(client).get(display_name)
    if existing and not update:
        record = resource_dict(existing.api_resource)
        record.update({"key": key, "created": False})
        return record

    config: dict[str, Any] = {
        "display_name": display_name,
        "description": AGENT_SPECS[key]["instruction"],
        "identity_type": types.IdentityType.AGENT_IDENTITY,
        "requirements": [
            "google-cloud-aiplatform[agent_engines,adk]>=1.144.0",
            "cloudpickle==3.1.1",
            "pydantic==2.12.5",
        ],
        "staging_bucket": bucket,
        "gcs_dir_name": f"royal-duke-fleet/{key}",
        "min_instances": 0,
        "max_instances": 2,
        "resource_limits": {"cpu": "1", "memory": "2Gi"},
        "labels": {"application": "royal-duke", "fleet-role": key},
    }
    if gateway and key != "shadow-analyst":
        config["agent_gateway_config"] = {
            "agent_to_anywhere_config": {"agent_gateway": gateway},
        }
    elif key == "shadow-analyst":
        # The intentionally vulnerable shadow is the comparison case. It has
        # no tools or authority and must receive raw hostile text, so explicitly
        # clear any gateway retained by a previous revision.
        config["agent_gateway_config"] = None
    if existing:
        remote = client.agent_engines.update(
            name=existing.api_resource.name,
            agent=AdkApp(agent=build_agent(key, project)),
            config=config,
        )
    else:
        remote = client.agent_engines.create(agent=AdkApp(agent=build_agent(key, project)), config=config)
    record = resource_dict(remote.api_resource)
    record.update({"key": key, "created": not bool(existing), "updated": bool(existing)})
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=os.getenv("GCP_PROJECT"), required=os.getenv("GCP_PROJECT") is None)
    parser.add_argument("--location", default=os.getenv("GCP_REGION", "us-central1"))
    parser.add_argument("--bucket", default=os.getenv("AGENT_STAGING_BUCKET"))
    parser.add_argument("--gateway", default=os.getenv("AGENT_GATEWAY_RESOURCE"))
    parser.add_argument("--output", default=".local/royal-duke-agent-runtime.json")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--agent", choices=sorted(AGENT_SPECS), action="append", help="Deploy only the selected fleet role; may be repeated")
    parser.add_argument("--update", action="store_true")
    parser.add_argument("--force-new", action="store_true", help="Create a replacement resource instead of updating a matching display name")
    args = parser.parse_args()
    bucket = args.bucket or f"gs://{args.project}_cloudbuild"
    gateway = args.gateway or None

    selected_agents = args.agent or list(AGENT_SPECS)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, len(selected_agents)))) as pool:
        futures = {
            pool.submit(deploy_one, args.project, args.location, bucket, gateway, key, args.update, args.force_new): key
            for key in selected_agents
        }
        records = [future.result() for future in concurrent.futures.as_completed(futures)]
    records.sort(key=lambda item: item["key"])

    identities = [record.get("effective_identity") for record in records]
    if len(records) != len(selected_agents) or any(not identity for identity in identities) or len(set(identities)) != len(selected_agents):
        raise RuntimeError("Agent Runtime did not return distinct effective identities for every selected agent")

    result = {
        "project": args.project,
        "location": args.location,
        "gateway": gateway,
        "model": os.getenv("ROYAL_DUKE_MODEL", "gemini-3.5-flash"),
        "agents": records,
    }
    output = Path(args.output)
    write_private_json(output, result)
    print(json.dumps({"status": "ok", "agent_count": len(records), "output": str(output)}))


if __name__ == "__main__":
    main()
