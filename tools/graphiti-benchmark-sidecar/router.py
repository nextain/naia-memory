"""Benchmark-only Graphiti routes pinned by pin.json.

Copy this module into Graphiti's ``server/graph_service`` package and include
``router`` in the reference FastAPI app. The service must remain isolated on
loopback because the upstream graph-service has no authentication.
"""

from datetime import datetime

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
