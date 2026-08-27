"""Benchmark-only Graphiti routes pinned by pin.json.

Copy this module into Graphiti's ``server/graph_service`` package and include
``router`` in the reference FastAPI app. The service must remain isolated on
loopback because the upstream graph-service has no authentication.
"""

from datetime import datetime
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from graphiti_core.edges import EntityEdge
from graphiti_core.errors import GroupsEdgesNotFoundError, NodeNotFoundError
from graphiti_core.nodes import EpisodeType, EpisodicNode
from graph_service.zep_graphiti import ZepGraphitiDep


PAGE_SIZE = 1000
router = APIRouter(prefix="/benchmark", tags=["benchmark-companion"])


class EpisodeCommit(BaseModel):
    committed: bool
    uuid: str | None = None


class BenchmarkMessage(BaseModel):
    uuid: str
    group_id: str
    name: str
    content: str
    timestamp: datetime
    source_description: str


class NativeFact(BaseModel):
    uuid: str
    fact: str


class CurrentFacts(BaseModel):
    facts: list[NativeFact]


class RuntimeIdentity(BaseModel):
    graphiti_core_version: str
    neo4j_driver_version: str
    provider_adapter_version: str
    llm_client_class: str
    llm_model: str
    embedding_client_class: str
    embedding_provider: str
    embedding_model: str
    embedding_dimensions: int
    server_lock_sha256: str
    deployed_sidecar_sha256: str


@router.get("/runtime-identity")
async def runtime_identity(graphiti: ZepGraphitiDep) -> RuntimeIdentity:
    """Describe the contacted process from its live client and deployed files."""
    sidecar_path = Path(__file__).resolve()
    lock_path = sidecar_path.parent.parent / "uv.lock"
    if not lock_path.is_file():
        raise RuntimeError(f"Graphiti server lockfile is missing: {lock_path}")

    llm_config = graphiti.llm_client.config
    embedder_config = graphiti.embedder.config
    embedding_dimensions = embedder_config.embedding_dim
    if not isinstance(embedding_dimensions, int) or embedding_dimensions < 1:
        raise RuntimeError("Graphiti embedder has no positive configured dimension")

    embedder_module = type(graphiti.embedder).__module__
    return RuntimeIdentity(
        graphiti_core_version=version("graphiti-core"),
        neo4j_driver_version=version("neo4j"),
        provider_adapter_version=f"google-genai@{version('google-genai')}",
        llm_client_class=_qualified_class_name(graphiti.llm_client),
        llm_model=llm_config.model,
        embedding_client_class=_qualified_class_name(graphiti.embedder),
        embedding_provider=embedder_module.rsplit(".", 1)[-1],
        embedding_model=embedder_config.embedding_model,
        embedding_dimensions=embedding_dimensions,
        server_lock_sha256=_sha256_file(lock_path),
        deployed_sidecar_sha256=_sha256_file(sidecar_path),
    )


@router.post("/messages")
async def add_message(
    message: BenchmarkMessage, graphiti: ZepGraphitiDep
) -> EpisodeCommit:
    """Commit one episode before acknowledging the benchmark operation."""
    result = await graphiti.add_episode(
        # graphiti-core 0.28.2 interprets a supplied UUID as an existing episode
        # lookup. Let the pinned core allocate its native identity instead.
        uuid=None,
        group_id=message.group_id,
        name=message.name,
        episode_body=f"benchmark-user(user): {message.content}",
        reference_time=message.timestamp,
        source=EpisodeType.message,
        source_description=message.source_description,
    )
    return EpisodeCommit(committed=True, uuid=result.episode.uuid)


@router.get("/episodes/{group_id}/{episode_uuid}")
async def has_episode(
    group_id: str, episode_uuid: str, graphiti: ZepGraphitiDep
) -> EpisodeCommit:
    try:
        episode = await EpisodicNode.get_by_uuid(graphiti.driver, episode_uuid)
    except NodeNotFoundError:
        return EpisodeCommit(committed=False)
    return EpisodeCommit(committed=episode.group_id == group_id)


@router.get("/current-facts/{group_id}")
async def current_facts(group_id: str, graphiti: ZepGraphitiDep) -> CurrentFacts:
    edges = await _group_edges(group_id, graphiti)
    return CurrentFacts(
        facts=[
            NativeFact(uuid=edge.uuid, fact=edge.fact)
            for edge in edges
            if edge.expired_at is None
        ]
    )


@router.get("/historical-facts/{group_id}")
async def historical_facts(group_id: str, graphiti: ZepGraphitiDep) -> CurrentFacts:
    """Return complete group history independently of query output."""
    edges = await _group_edges(group_id, graphiti)
    return CurrentFacts(
        facts=[NativeFact(uuid=edge.uuid, fact=edge.fact) for edge in edges]
    )


async def _group_edges(
    group_id: str, graphiti: ZepGraphitiDep
) -> list[EntityEdge]:
    edges: list[EntityEdge] = []
    cursor: str | None = None
    while True:
        try:
            page = await EntityEdge.get_by_group_ids(
                graphiti.driver,
                [group_id],
                limit=PAGE_SIZE,
                uuid_cursor=cursor,
            )
        except GroupsEdgesNotFoundError:
            break
        edges.extend(page)
        if len(page) < PAGE_SIZE:
            break
        cursor = page[-1].uuid

    return edges


def _qualified_class_name(value: object) -> str:
    value_type = type(value)
    return f"{value_type.__module__}.{value_type.__qualname__}"


def _sha256_file(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()
